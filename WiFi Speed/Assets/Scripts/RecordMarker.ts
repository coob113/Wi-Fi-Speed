import {Interactable} from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable"
import {InteractorEvent} from "SpectaclesInteractionKit.lspkg/Core/Interactor/InteractorEvent"
import {unsubscribe} from "SpectaclesInteractionKit.lspkg/Utils/Event"
import {
  applyTextFillColor,
  bracketIndex,
  clampPercent,
  colorForSessionPercent,
  defaultBracketLabels,
  isDeadZone,
  qualityLabel,
  sessionPercent,
  weightedMedian,
  WeightedSample,
} from "./CoverageMetrics"

type CoverageGridRef = BaseScriptComponent & {
  getLookAtTarget(): SceneObject | null
  onMarkerUpdated(marker: RecordMarker): void
}

@component
export class RecordMarker extends BaseScriptComponent {
  @input
  @allowUndefined
  @hint("Legacy % label (optional; detail panel replaces when wired)")
  labelText: Text

  @input
  @allowUndefined
  @hint("Child with RenderMeshVisual — material swapped by median % bracket")
  colorTarget: SceneObject

  @input
  @hint("10 materials for 0-10%, 10-20%, … 90-100% relative speed")
  bracketMaterials: Material[]

  @input
  @allowUndefined
  @hint("Child scaled on local Y by median percentage")
  scaleTarget: SceneObject

  @input
  @hint("Local Y = median % × multiplier (e.g. 0.2 → 100% gives Y=20)")
  scaleMultiplier: number = 0.2

  @input
  @hint("Local X/Z scale when this cell has its own recording")
  directXZScale: number = 20

  @input
  @hint("Local X/Z scale for neighbor-influenced cells only")
  neighborXZScale: number = 10

  @input
  @hint("Billboard toward look-at target and show % on legacy labelText")
  enableLookAt: boolean = false

  @input
  @allowUndefined
  @hint("SIK Interactable on InteractableToPinch child")
  interactable: Interactable

  @input
  @allowUndefined
  @hint("VisualSphere — scales on hover / pinch")
  visualSphere: SceneObject

  @input
  @allowUndefined
  @hint("TextToEnable root — shown when user pinches the interactable")
  detailPanel: SceneObject

  @input
  @allowUndefined
  @hint("Header text — unique bracket label (Terrible … Perfect)")
  headerText: Text

  @input
  @allowUndefined
  @hint("Secondary text — Mbps, %, test count (multi-line)")
  secondaryText: Text

  @input
  @allowUndefined
  @hint("! Limit Icon — enabled on confirmed dead zone")
  limitIcon: SceneObject

  @input
  @hint("One unique label per color bracket (0–10% Terrible … 90–100% Perfect)")
  bracketLabels: string[]

  @input
  @hint("VisualSphere scale at rest")
  visualSphereDefaultScale: number = 1

  @input
  @hint("VisualSphere scale while hovered")
  visualSphereHoverScale: number = 2

  @input
  @hint("VisualSphere scale while pinching")
  visualSphereSelectScale: number = 1.5

  @input
  @hint("Min samples before ! dead zone (use 1 to test; production default 3)")
  deadZoneMinSamples: number = 1

  @input
  @hint("Session % floor for ! when spread is wide enough (e.g. 1 = bottom 1%)")
  deadZoneSessionPct: number = 1

  @input
  @hint("Header copy when dead zone confirmed")
  deadZoneHeadline: string = "No coverage"

  @input
  @hint("Max detail panels open at once; oldest auto-closes when exceeded")
  maxOpenDetailPanels: number = 20

  private static openDetailPanels: RecordMarker[] = []
  private static detailOpenedListeners: Array<() => void> = []

  public static subscribeDetailOpened(listener: () => void): unsubscribe {
    RecordMarker.detailOpenedListeners.push(listener)
    return () => {
      const idx = RecordMarker.detailOpenedListeners.indexOf(listener)
      if (idx >= 0) {
        RecordMarker.detailOpenedListeners.splice(idx, 1)
      }
    }
  }

  private static notifyDetailOpened() {
    for (let i = 0; i < RecordMarker.detailOpenedListeners.length; i++) {
      RecordMarker.detailOpenedListeners[i]()
    }
  }

  private samples: WeightedSample[] = []
  private manager: CoverageGridRef | null = null
  private cellX = 0
  private cellZ = 0
  private hasOwnRecording = false
  private lastDisplayMbps = -1
  private lastGlobalMinMbps = 0
  private lastGlobalMaxMbps = 0
  private lastPct = 100
  private isHovered = false
  private isSelected = false
  private detailVisible = false
  private interactableUnsubscribes: unsubscribe[] = []
  private targetWorldY = 0
  private currentWorldY = 0
  private heightInitialized = false

  onAwake() {
    this.hideDetailPanel()
    this.setLimitIconVisible(false)
    this.applyVisualSphereScale()
    this.createEvent("OnStartEvent").bind(() => this.onStart())
    this.createEvent("OnDestroyEvent").bind(() => {
      this.cleanupInteractable()
      this.removeFromOpenPanels()
    })
  }

  private onStart() {
    this.bindInteractable()
  }

  public setup(manager: BaseScriptComponent, cellX: number, cellZ: number) {
    this.manager = manager as CoverageGridRef
    this.cellX = cellX
    this.cellZ = cellZ
  }

  public addSample(mbps: number, weight: number, notify = true, isDirect = true) {
    if (mbps < 0) {
      return
    }
    if (isDirect) {
      this.hasOwnRecording = true
    }
    this.samples.push({
      mbps,
      weight: Math.max(0, weight),
    })
    if (notify && this.manager) {
      this.manager.onMarkerUpdated(this)
    }
  }

  public getMedian(): number {
    return weightedMedian(this.samples)
  }

  public getSampleCount(): number {
    return this.samples.length
  }

  public getHasOwnRecording(): boolean {
    return this.hasOwnRecording
  }

  public getSamples(): number[] {
    return this.samples.map((sample) => sample.mbps)
  }

  public getCellX(): number {
    return this.cellX
  }

  public getCellZ(): number {
    return this.cellZ
  }

  public getMarkerWorldPosition(): vec3 {
    const y = this.getSceneObject().getTransform().getWorldPosition().y
    return new vec3(this.cellX, y, this.cellZ)
  }

  public setMarkerSceneEnabled(enabled: boolean) {
    this.getSceneObject().enabled = enabled
  }

  public setInteractableEnabled(enabled: boolean) {
    if (this.interactable) {
      this.interactable.enabled = enabled
    }
  }

  public getDisplayMbps(): number {
    return this.lastDisplayMbps
  }

  public getSessionPercent(): number {
    return this.lastPct
  }

  public getQualityLabelText(): string {
    return this.resolveBracketLabel(this.lastPct)
  }

  public getIsDeadZone(): boolean {
    return this.computeDeadZone()
  }

  public getIsDetailVisible(): boolean {
    return this.detailVisible
  }

  public closeDetailPanel() {
    this.setDetailPanelVisible(false)
  }

  public applyHeight(worldY: number) {
    const tr = this.getSceneObject().getTransform()
    tr.setWorldPosition(new vec3(this.cellX, worldY, this.cellZ))
  }

  public setTargetWorldY(worldY: number) {
    this.targetWorldY = worldY
  }

  public snapWorldY(worldY: number) {
    this.targetWorldY = worldY
    this.currentWorldY = worldY
    this.heightInitialized = true
    this.applyHeight(worldY)
  }

  public stepWorldY(targetY: number, dtSec: number, smoothSpeed: number) {
    this.targetWorldY = targetY
    if (!this.heightInitialized) {
      this.snapWorldY(targetY)
      return
    }

    if (smoothSpeed <= 0 || dtSec <= 0) {
      this.currentWorldY = targetY
    } else {
      const alpha = 1 - Math.exp(-smoothSpeed * dtSec)
      this.currentWorldY += (targetY - this.currentWorldY) * alpha
    }

    this.applyHeight(this.currentWorldY)
  }

  public updateVisuals(displayMbps: number, globalMinMbps: number, globalMaxMbps: number) {
    if (displayMbps < 0) {
      return
    }

    this.lastDisplayMbps = displayMbps
    this.lastGlobalMinMbps = globalMinMbps
    this.lastGlobalMaxMbps = globalMaxMbps
    this.lastPct = clampPercent(sessionPercent(displayMbps, globalMinMbps, globalMaxMbps))

    if (this.enableLookAt && this.labelText) {
      this.labelText.text = `${this.lastPct.toFixed(0)}%`
    }

    this.applyBracketMaterial(this.lastPct)
    this.applyScaleBar(this.lastPct)
    this.refreshDeadZoneChrome()
    if (this.detailVisible) {
      this.refreshDetailLabels()
    }
  }

  private bindInteractable() {
    if (!this.interactable) {
      return
    }

    this.cleanupInteractable()

    const onHoverEnter = () => {
      this.isHovered = true
      this.applyVisualSphereScale()
    }
    const onHoverExit = () => {
      this.isHovered = false
      this.applyVisualSphereScale()
    }
    const onTriggerStart = (_event: InteractorEvent) => {
      this.isSelected = true
      this.applyVisualSphereScale()
    }
    const onTriggerEnd = (_event: InteractorEvent) => {
      this.isSelected = false
      this.applyVisualSphereScale()
      this.onPinchComplete()
    }

    this.interactableUnsubscribes.push(
      this.interactable.onHoverEnter.add(onHoverEnter),
      this.interactable.onHoverExit.add(onHoverExit)
    )
    this.interactable.onInteractorTriggerStart(onTriggerStart)
    this.interactable.onInteractorTriggerEnd(onTriggerEnd)
  }

  private cleanupInteractable() {
    this.interactableUnsubscribes.forEach((removeListener) => removeListener())
    this.interactableUnsubscribes = []
  }

  private onPinchComplete() {
    if (!this.detailPanel) {
      return
    }

    this.setDetailPanelVisible(!this.detailVisible)
  }

  private setDetailPanelVisible(visible: boolean) {
    if (visible) {
      this.evictOldestOpenPanelsIfNeeded()
      this.detailVisible = true
      this.addToOpenPanels()
      if (this.detailPanel) {
        this.detailPanel.enabled = true
      }
      this.refreshDetailLabels()
      RecordMarker.notifyDetailOpened()
      return
    }

    this.detailVisible = false
    this.removeFromOpenPanels()
    if (this.detailPanel) {
      this.detailPanel.enabled = false
    }
  }

  private evictOldestOpenPanelsIfNeeded() {
    const limit = Math.max(1, Math.round(this.maxOpenDetailPanels))
    while (
      RecordMarker.openDetailPanels.length >= limit &&
      RecordMarker.openDetailPanels.length > 0
    ) {
      const oldest = RecordMarker.openDetailPanels[0]
      if (!oldest || oldest === this) {
        break
      }
      oldest.setDetailPanelVisible(false)
    }
  }

  private addToOpenPanels() {
    this.removeFromOpenPanels()
    RecordMarker.openDetailPanels.push(this)
  }

  private removeFromOpenPanels() {
    const idx = RecordMarker.openDetailPanels.indexOf(this)
    if (idx >= 0) {
      RecordMarker.openDetailPanels.splice(idx, 1)
    }
  }

  private hideDetailPanel() {
    this.setDetailPanelVisible(false)
  }

  private refreshDetailLabels() {
    if (!this.detailVisible || this.lastDisplayMbps < 0) {
      return
    }

    const deadZone = this.computeDeadZone()

    if (this.headerText) {
      if (deadZone) {
        this.headerText.text = this.deadZoneHeadline
        applyTextFillColor(
          this.headerText,
          colorForSessionPercent(this.bracketMaterials, 0)
        )
      } else {
        this.headerText.text = this.resolveBracketLabel(this.lastPct)
        applyTextFillColor(
          this.headerText,
          colorForSessionPercent(this.bracketMaterials, this.lastPct)
        )
      }
    }

    if (this.secondaryText) {
      this.secondaryText.text = this.buildSecondaryLine(deadZone)
    }
  }

  private buildSecondaryLine(deadZone: boolean): string {
    const count = this.samples.length
    const testsLabel = count === 1 ? "1 Test" : `${count} Tests`
    const lines: string[] = []

    if (!deadZone) {
      lines.push(`${this.lastDisplayMbps.toFixed(0)} Mbps`)
    }
    lines.push(`${this.lastPct.toFixed(0)}% of session`)
    lines.push(testsLabel)

    return lines.join("\n")
  }

  private resolveBracketLabel(pct: number): string {
    const idx = bracketIndex(pct)
    const labels =
      this.bracketLabels && this.bracketLabels.length >= 10
        ? this.bracketLabels
        : defaultBracketLabels()
    const label = labels[idx]
    if (label && label.length > 0) {
      return label
    }
    return qualityLabel(pct)
  }

  private computeDeadZone(): boolean {
    if (this.lastDisplayMbps < 0) {
      return false
    }

    const sessionSpreadMbps = this.lastGlobalMaxMbps - this.lastGlobalMinMbps
    return isDeadZone({
      sampleCount: this.samples.length,
      displayMbps: this.lastDisplayMbps,
      sessionPct: this.lastPct,
      sessionSpreadMbps,
      deadZoneMinSamples: this.deadZoneMinSamples,
      deadZoneSessionPct: this.deadZoneSessionPct,
    })
  }

  private refreshDeadZoneChrome() {
    this.setLimitIconVisible(this.computeDeadZone())
  }

  private setLimitIconVisible(visible: boolean) {
    if (this.limitIcon) {
      this.limitIcon.enabled = visible
    }
  }

  private applyVisualSphereScale() {
    if (!this.visualSphere) {
      return
    }

    let scale = this.visualSphereDefaultScale
    if (this.isSelected) {
      scale = this.visualSphereSelectScale
    } else if (this.isHovered) {
      scale = this.visualSphereHoverScale
    }

    const tr = this.visualSphere.getTransform()
    tr.setLocalScale(new vec3(scale, scale, scale))
  }

  private applyBracketMaterial(pct: number) {
    if (!this.colorTarget || !this.bracketMaterials || this.bracketMaterials.length === 0) {
      return
    }

    const material = this.bracketMaterials[bracketIndex(pct)]
    if (!material) {
      return
    }

    const renderMesh = this.colorTarget.getComponent(
      "Component.RenderMeshVisual"
    ) as RenderMeshVisual
    if (renderMesh) {
      renderMesh.mainMaterial = material
      return
    }

    const materialMesh = this.colorTarget.getComponent(
      "Component.MaterialMeshVisual"
    ) as MaterialMeshVisual
    if (materialMesh) {
      materialMesh.mainMaterial = material
    }
  }

  private applyScaleBar(pct: number) {
    if (!this.scaleTarget) {
      return
    }

    const xz = this.hasOwnRecording ? this.directXZScale : this.neighborXZScale
    const yScale = this.computeDeadZone() ? 0 : pct * this.scaleMultiplier
    const tr = this.scaleTarget.getTransform()
    tr.setLocalScale(new vec3(xz, yScale, xz))
  }
}
