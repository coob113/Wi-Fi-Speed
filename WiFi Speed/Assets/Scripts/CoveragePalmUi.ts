import {ConnectionProbe} from "./ConnectionProbe"
import {CoverageGridManager} from "./CoverageGridManager"
import {
  bracketIndex,
  applyTextFillColor,
  colorForSessionPercent,
  defaultBracketLabels,
  DEFAULT_HEADER_TEXT_COLOR,
} from "./CoverageMetrics"
import TrackedHand from "SpectaclesInteractionKit.lspkg/Providers/HandInputData/TrackedHand"
import {SIK} from "SpectaclesInteractionKit.lspkg/SIK"

type GridRef = CoverageGridManager
type ProbeRef = ConnectionProbe

type HintType = "none" | "retry" | "stay" | "move"

@component
export class CoveragePalmUi extends BaseScriptComponent {
  @input
  @allowUndefined
  @hint("ConnectionProbe — download loop and last-run metrics")
  probe: ProbeRef

  @input
  @allowUndefined
  @hint("CoverageGridManager — session range, cell counts, arrow centroid")
  grid: GridRef

  @input
  @allowUndefined
  @hint("World position for grid cell + arrow origin (Camera / device tracking)")
  positionSource: SceneObject

  @input
  @allowUndefined
  @hint("Left palm center — PalmUI follows this each frame")
  palmAttachPoint: SceneObject

  @input
  @allowUndefined
  @hint("Root to scale on palm show/hide (defaults to PalmUI object — use to include Frame + Arrow)")
  scaleRoot: SceneObject

  @input
  @allowUndefined
  @hint("CurrentStatus text — probe state line")
  statusText: Text

  @input
  @allowUndefined
  @hint("Pivot To Scale — progress bar; local X scaled 0→1")
  progressBarPivot: SceneObject

  @input
  @allowUndefined
  @hint("Background of loading bar — shown while a scan is in flight")
  progressBarBackground: SceneObject

  @input
  @allowUndefined
  @hint("Header — bracket label from last successful probe")
  headerText: Text

  @input
  @allowUndefined
  @hint("Secondary — Mbps + % from last successful probe (multi-line)")
  secondaryText: Text

  @input
  @allowUndefined
  @hint("Hint — stay / move prompts (hide when empty)")
  hintText: Text

  @input
  @allowUndefined
  @hint("Optional pivot for hint scale / flip (defaults to hint Text object)")
  hintPivot: SceneObject

  @input
  @allowUndefined
  @hint("Arrow mesh — yaw toward best cluster")
  arrowObject: SceneObject

  @input
  @hint("One unique label per color bracket (same as Record prefab)")
  bracketLabels: string[] = []

  @input
  @hint("10 materials for bracket colors — same array as Record prefab bar")
  bracketMaterials: Material[] = []

  @input
  @hint("Lerp speed for palm attach follow")
  attachLerp: number = 0.35

  @input
  @hint("Scale lerp speed when palm shows / hides")
  scaleTransitionSpeed: number = 8

  @input
  @hint("Seconds palm must face camera before UI scales in")
  palmShowDelaySec: number = 0.15

  @input
  @hint("Seconds palm turned away before UI scales out")
  palmHideDelaySec: number = 0.25

  @input
  @hint("Arrow yaw slerp speed toward best cluster")
  arrowRotationLerp: number = 8

  @input
  @hint("Fallback estimated scan duration when no history yet")
  defaultProgressDurationSec: number = 8

  @input
  @hint("Progress rate multiplier after 90% while scan still running")
  progressSlowAfter90Factor: number = 0.25

  @input
  @hint("Rapid finish speed when scan completes before bar reaches 100%")
  progressRapidFinishSpeed: number = 4

  @input
  @hint("Min successes at this spot before suggesting move")
  moveAfterSamples: number = 3

  @input
  @hint("Min fraction of session max Mbps for arrow cluster cells")
  arrowMinFractionOfMax: number = 0.8

  @input
  @hint("Hint scale lerp speed when appearing / hiding")
  hintScaleTransitionSpeed: number = 10

  @input
  @hint("Hint 360° X-flip duration when text changes (swap at 180°)")
  hintSpinDurationSec: number = 0.35

  @input
  hintStayVariants: string[] = [
    "One more here",
    "Stay a sec",
    "Another test here",
    "Hold still — once more",
    "Quick retest here",
    "Same spot again",
    "Almost — one more",
    "Keep at it here",
  ]

  @input
  hintMoveVariants: string[] = [
    "Try somewhere new",
    "Head to a new spot",
    "Good here — move on",
    "Walk to another area",
    "Explore elsewhere",
    "Next spot?",
    "Map a new place",
    "You're good — wander",
  ]

  @input
  hintRetryVariants: string[] = [
    "Try again here",
    "Once more here",
    "Give it another go",
    "Retry this spot",
    "Run it again",
    "Same place — retry",
  ]

  private leftHand: TrackedHand | null = null
  private resolvedScaleRoot: SceneObject | null = null
  private progressBarBaseScale = new vec3(1, 1, 1)
  private uiScale = 0
  private targetUiScale = 0
  private progressVisual = 0
  private rapidFinish = false
  private prevInFlight = false
  private lastProcessedResultSequence = 0
  private okFlashActive = false
  private okFlashEvent: DelayedCallbackEvent | null = null
  private spotFailStreak = 0
  private lastResultCellKey = ""
  private cachedHintLine = ""
  private hintCellKey = ""
  private activeHintType: HintType = "none"
  private activeHintContextKey = ""
  private palmVisible = false
  private palmVisibilityTimer = 0
  private arrowRotation = quat.quatIdentity()
  private hasArrowRotation = false
  private hintPivotBaseScale = new vec3(1, 1, 1)
  private hintBaseRotation = quat.quatIdentity()
  private hintScaleVisual = 0
  private hintDisplayedLine = ""
  private hintSpinActive = false
  private hintSpinProgress = 0
  private hintSpinTargetLine = ""
  private hintSpinSwapped = false

  /** Palm UI scaled in (matches internal visibility threshold). */
  public isPalmUiVisible(): boolean {
    return this.uiScale > 0.5
  }

  onAwake() {
    this.createEvent("OnStartEvent").bind(() => {
      this.onStart()
    })
    this.createEvent("UpdateEvent").bind(() => {
      this.onUpdate()
    })
    this.createEvent("OnDestroyEvent").bind(() => {
      this.onDestroy()
    })
  }

  private onDestroy() {
    if (this.okFlashEvent) {
      this.okFlashEvent.enabled = false
      this.okFlashEvent = null
    }
  }

  private onStart() {
    try {
      this.leftHand = SIK.HandInputData.getHand("left")
    } catch (_e) {
      this.leftHand = null
    }

    this.resolvedScaleRoot = this.scaleRoot || this.getSceneObject()

    if (this.progressBarPivot) {
      this.progressBarBaseScale = this.progressBarPivot.getTransform().getLocalScale()
    }

    this.uiScale = this.shouldShowPalmUiRaw() ? 1 : 0
    this.targetUiScale = this.uiScale
    this.palmVisible = this.uiScale > 0.5
    this.applyUiScale()
    this.applyProgressBar(0)
    this.setProgressChromeVisible(false)
    this.initHintPivot()
    this.syncProbeState()
    this.refreshAll()
    this.updateHintAnimation()
  }

  private initHintPivot() {
    const pivot = this.getHintPivot()
    if (!pivot) {
      return
    }

    const tr = pivot.getTransform()
    this.hintPivotBaseScale = tr.getLocalScale()
    this.hintBaseRotation = tr.getLocalRotation()

    if (this.cachedHintLine.length > 0) {
      this.hintDisplayedLine = this.cachedHintLine
      if (this.hintText) {
        this.hintText.text = this.cachedHintLine
      }
      this.hintScaleVisual = 1
    } else {
      this.hintDisplayedLine = ""
      if (this.hintText) {
        this.hintText.text = ""
      }
      this.hintScaleVisual = 0
    }

    this.applyHintTransform(this.hintScaleVisual, 0)
  }

  private syncProbeState() {
    if (!this.probe) {
      return
    }

    this.prevInFlight = this.probe.isInFlight()
    this.lastProcessedResultSequence = this.probe.getResultSequence()

    if (this.lastProcessedResultSequence > 0) {
      const status = this.probe.getLastStatus()
      const mbps = this.probe.getLastMbps()
      const success = status === "ok" || status.indexOf("ok ") === 0
      if (success && mbps >= 0) {
        this.syncHintCellToPosition()
        this.updateHintIfNeeded()
      }
    }

    if (this.prevInFlight) {
      this.onProbeStarted()
    }
  }

  private onUpdate() {
    this.updatePalmVisibility()
    this.updateAttachPosition()
    this.pollProbeTransitions()
    this.updateProgressBar()
    this.updateArrow()
    this.refreshAll()
    this.updateHintAnimation()
  }

  private updatePalmVisibility() {
    const wantsVisible = this.shouldShowPalmUiRaw()

    if (wantsVisible === this.palmVisible) {
      this.palmVisibilityTimer = 0
    } else {
      this.palmVisibilityTimer += getDeltaTime()
      const delay = wantsVisible ? this.palmShowDelaySec : this.palmHideDelaySec
      if (this.palmVisibilityTimer >= delay) {
        this.palmVisible = wantsVisible
        this.palmVisibilityTimer = 0
      }
    }

    this.targetUiScale = this.palmVisible ? 1 : 0
    const dt = getDeltaTime()
    const t = Math.min(1, dt * this.scaleTransitionSpeed)
    this.uiScale = this.uiScale + (this.targetUiScale - this.uiScale) * t
    this.applyUiScale()
  }

  private shouldShowPalmUiRaw(): boolean {
    if (global.deviceInfoSystem.isEditor()) {
      return true
    }
    if (!this.leftHand) {
      return false
    }
    return this.leftHand.isTracked() && this.leftHand.isFacingCamera()
  }

  private applyUiScale() {
    if (!this.resolvedScaleRoot) {
      return
    }
    const s = Math.max(0, this.uiScale)
    this.resolvedScaleRoot.getTransform().setLocalScale(new vec3(s, s, s))
  }

  private updateAttachPosition() {
    if (!this.palmAttachPoint) {
      return
    }
    const target = this.palmAttachPoint.getTransform().getWorldPosition()
    const tr = this.getSceneObject().getTransform()
    const cur = tr.getWorldPosition()
    tr.setWorldPosition(vec3.lerp(cur, target, this.attachLerp))
  }

  private pollProbeTransitions() {
    if (!this.probe) {
      return
    }

    const inFlight = this.probe.isInFlight()
    const seq = this.probe.getResultSequence()

    if (!this.prevInFlight && inFlight) {
      this.onProbeStarted()
    }

    if (seq > this.lastProcessedResultSequence) {
      this.applyFinishedResult(
        this.probe.getLastStatus(),
        this.probe.getLastMbps(),
        true
      )
      this.lastProcessedResultSequence = seq
    }

    this.prevInFlight = inFlight
  }

  private onProbeStarted() {
    this.progressVisual = 0
    this.rapidFinish = false
    this.okFlashActive = false
    if (this.okFlashEvent) {
      this.okFlashEvent.enabled = false
      this.okFlashEvent = null
    }
    this.applyProgressBar(0)
    this.setProgressChromeVisible(true)
  }

  private applyFinishedResult(status: string, mbps: number, flashOk: boolean) {
    const cellKey = this.getCurrentCellKey()
    const success = status === "ok" || status.indexOf("ok ") === 0

    if (success) {
      this.spotFailStreak = 0
      this.lastResultCellKey = cellKey
      this.syncHintCellToPosition()
      if (flashOk) {
        this.startOkFlash()
      }
      if (this.progressVisual < 1) {
        this.rapidFinish = true
      }
    } else {
      if (cellKey.length > 0 && cellKey === this.lastResultCellKey) {
        this.spotFailStreak++
      } else {
        this.spotFailStreak = 1
        this.lastResultCellKey = cellKey
      }
      this.logProbeFailure(status, mbps, cellKey)
      this.progressVisual = 0
      this.rapidFinish = false
      this.applyProgressBar(0)
    }

    this.updateHintIfNeeded()
  }

  private syncHintCellToPosition() {
    const cellKey = this.getCurrentCellKey()
    if (cellKey.length > 0) {
      this.hintCellKey = cellKey
    }
  }

  private getHintSampleCount(): number {
    if (!this.grid) {
      return 0
    }
    return this.grid.getSampleCountAtWorldPos(this.getUserWorldPosition())
  }

  private startOkFlash() {
    this.okFlashActive = true
    if (this.okFlashEvent) {
      this.okFlashEvent.enabled = false
    }
    const duration =
      this.probe && this.probe.getInterProbeDelaySec() > 0
        ? this.probe.getInterProbeDelaySec()
        : 0.5
    this.okFlashEvent = this.createEvent("DelayedCallbackEvent")
    this.okFlashEvent.bind(() => {
      this.okFlashActive = false
      this.okFlashEvent = null
    })
    this.okFlashEvent.reset(duration)
  }

  private updateProgressBar() {
    if (!this.probe) {
      return
    }

    const inFlight = this.probe.isInFlight()

    if (inFlight) {
      const avg = this.probe.getAverageScanDurationSec()
      const estimated =
        avg > 0 ? avg : Math.max(0.5, this.defaultProgressDurationSec)
      const elapsed = this.probe.getScanElapsedSec()
      const linear = elapsed / estimated

      if (linear >= 0.9) {
        const overshoot = elapsed - estimated * 0.9
        this.progressVisual =
          0.9 + (overshoot / estimated) * this.progressSlowAfter90Factor
        this.progressVisual = Math.min(0.99, this.progressVisual)
      } else {
        this.progressVisual = Math.min(0.99, linear)
      }
      this.rapidFinish = false
    } else if (this.rapidFinish) {
      this.progressVisual += getDeltaTime() * this.progressRapidFinishSpeed
      if (this.progressVisual >= 1) {
        this.progressVisual = 1
        this.rapidFinish = false
      }
    }

    this.applyProgressBar(this.progressVisual)
    this.setProgressChromeVisible(inFlight || this.rapidFinish)
  }

  private applyProgressBar(progress: number) {
    if (!this.progressBarPivot) {
      return
    }
    const p = Math.max(0, Math.min(1, progress))
    const base = this.progressBarBaseScale
    this.progressBarPivot
      .getTransform()
      .setLocalScale(new vec3(base.x * p, base.y, base.z))
  }

  private setProgressChromeVisible(visible: boolean) {
    if (this.progressBarBackground) {
      this.progressBarBackground.enabled = visible
    }
    if (this.progressBarPivot) {
      this.progressBarPivot.enabled = visible
    }
  }

  private updateArrow() {
    if (!this.arrowObject || !this.grid) {
      return
    }

    const palmVisible = this.uiScale > 0.05
    if (!palmVisible) {
      this.arrowObject.enabled = false
      this.hasArrowRotation = false
      return
    }

    const userPos = this.getUserWorldPosition()
    const centroid = this.grid.getBestClusterCentroid(
      userPos,
      this.arrowMinFractionOfMax
    )

    if (!centroid) {
      this.arrowObject.enabled = false
      this.hasArrowRotation = false
      return
    }

    const dx = userPos.x - centroid.x
    const dz = userPos.z - centroid.z
    const dist = Math.sqrt(dx * dx + dz * dz)
    const hideDistance = this.grid.getGridSize()

    if (dist < hideDistance) {
      this.arrowObject.enabled = false
      this.hasArrowRotation = false
      return
    }

    this.arrowObject.enabled = true
    const dir = new vec3(centroid.x - userPos.x, 0, centroid.z - userPos.z)
    if (dir.length < 0.001) {
      return
    }
    const forward = dir.normalize()
    const targetRotation = quat.lookAt(forward, vec3.up())
    if (!this.hasArrowRotation) {
      this.arrowRotation = targetRotation
      this.hasArrowRotation = true
    } else {
      this.arrowRotation = quat.slerp(
        this.arrowRotation,
        targetRotation,
        Math.min(1, getDeltaTime() * this.arrowRotationLerp)
      )
    }
    this.arrowObject.getTransform().setWorldRotation(this.arrowRotation)
  }

  private refreshAll() {
    this.refreshStatus()
    this.refreshHeaderSecondary()
    this.refreshHint()
  }

  private refreshStatus() {
    if (!this.statusText || !this.probe) {
      return
    }

    if (this.okFlashActive) {
      this.statusText.text = "OK"
      return
    }

    if (this.probe.isInFlight()) {
      this.statusText.text = "Testing download…"
      return
    }

    if (this.spotFailStreak >= 2) {
      this.statusText.text = "Weak or no download here"
      return
    }

    const status = this.probe.getLastStatus()
    if (status === "moved") {
      this.statusText.text = "Too much movement — try again"
      return
    }
    if (status.indexOf("fail") === 0 || status === "error" || status.indexOf("size") === 0) {
      this.statusText.text = "Download failed"
      return
    }

    this.statusText.text = ""
  }

  private refreshHeaderSecondary() {
    if (!this.probe) {
      return
    }

    if (this.isShowingFailureMetrics()) {
      if (this.headerText) {
        this.headerText.text = this.getFailureHeader()
        this.applyHeaderBracketColor(this.spotFailStreak >= 2 ? 0 : -1)
      }
      if (this.secondaryText) {
        this.secondaryText.text = ""
        this.secondaryText.enabled = false
      }
      return
    }

    if (this.secondaryText) {
      this.secondaryText.enabled = true
    }

    if (!this.probe.hasLastOk()) {
      if (this.headerText) {
        this.headerText.text = "—"
        this.applyHeaderBracketColor(-1)
      }
      if (this.secondaryText) {
        this.secondaryText.text = "No reading yet"
      }
      return
    }

    const mbps = this.probe.getLastOkMbps()
    const pct = this.probe.getLastOkSessionPercent()
    const hasSpread = this.probe.getSessionOkCount() >= 2

    if (this.headerText) {
      this.headerText.text = this.resolveBracketLabel(pct)
      this.applyHeaderBracketColor(pct)
    }

    if (this.secondaryText) {
      this.secondaryText.text = this.buildSecondaryLine(mbps, pct, hasSpread)
    }
  }

  /** After a failed probe (not while testing or OK flash) — override metrics row. */
  private isShowingFailureMetrics(): boolean {
    if (!this.probe || this.probe.isInFlight() || this.okFlashActive) {
      return false
    }

    if (this.spotFailStreak >= 2) {
      return true
    }

    const status = this.probe.getLastStatus()
    if (status === "idle" || status.length === 0) {
      return false
    }

    return !this.isSuccessStatus(status)
  }

  private getFailureHeader(): string {
    if (this.spotFailStreak >= 2) {
      return "Weak spot"
    }

    const status = this.probe.getLastStatus()
    if (status === "moved") {
      return "Move slower"
    }

    return "Try again"
  }

  private formatFailureStatus(): string {
    if (!this.probe) {
      return "unknown"
    }

    const status = this.probe.getLastStatus()
    if (status === "moved") {
      return "moved too far"
    }
    if (status.indexOf("size") === 0) {
      return status
    }
    if (status.indexOf("fail") === 0) {
      return status
    }
    if (status === "error") {
      return "fetch error"
    }
    return status.length > 0 ? status : "unknown"
  }

  private logProbeFailure(status: string, mbps: number, cellKey: string) {
    const mapStatus = this.probe ? this.probe.getLastCoverageRecordStatus() : "unknown"
    console.warn(
      `[CoveragePalmUi] probe failed status=${this.formatFailureStatus()} raw=${status} mbps=${mbps.toFixed(1)} cell=${cellKey || "unknown"} streak=${this.spotFailStreak} map=${mapStatus}`
    )
  }

  private isSuccessStatus(status: string): boolean {
    return status === "ok" || status.indexOf("ok ") === 0
  }

  private buildSecondaryLine(
    mbps: number,
    pct: number,
    hasSpread: boolean
  ): string {
    const mbpsLine = `${mbps.toFixed(1)} Mbps`
    const mapLine = `Map: ${this.probe.getLastCoverageRecordStatus()}`
    if (!hasSpread) {
      return `${mbpsLine}\nFirst reading\n${mapLine}`
    }
    return `${mbpsLine}\n${pct.toFixed(0)}% of session\n${mapLine}`
  }

  private refreshHint() {
    if (!this.hintText || !this.probe) {
      return
    }

    if (this.spotFailStreak >= 2) {
      this.clearHint()
    } else if (!this.probe.isInFlight()) {
      this.syncHintCellToPosition()
      this.updateHintIfNeeded()
    }
  }

  private updateHintAnimation() {
    const pivot = this.getHintPivot()
    if (!pivot || !this.hintText) {
      return
    }

    const target = this.cachedHintLine
    const wantsShow = target.length > 0
    const dt = getDeltaTime()

    if (this.hintSpinActive && !wantsShow) {
      this.hintSpinActive = false
      this.hintSpinProgress = 0
      this.hintSpinSwapped = false
    }

    if (this.hintSpinActive) {
      this.hintSpinProgress += dt / Math.max(0.05, this.hintSpinDurationSec)

      if (this.hintSpinProgress >= 0.5 && !this.hintSpinSwapped) {
        this.hintDisplayedLine = this.hintSpinTargetLine
        this.hintText.text = this.hintDisplayedLine
        this.hintSpinSwapped = true
      }

      if (this.hintSpinProgress >= 1) {
        this.hintSpinActive = false
        this.hintSpinProgress = 0
        this.hintSpinSwapped = false
        this.applyHintTransform(1, 0)
        return
      }

      const angle = this.hintSpinProgress * Math.PI * 2
      this.applyHintTransform(1, angle)
      return
    }

    const scaleTarget = wantsShow ? 1 : 0
    const scaleT = Math.min(1, dt * this.hintScaleTransitionSpeed)
    this.hintScaleVisual =
      this.hintScaleVisual + (scaleTarget - this.hintScaleVisual) * scaleT

    if (
      wantsShow &&
      this.hintScaleVisual > 0.9 &&
      this.hintDisplayedLine.length > 0 &&
      target !== this.hintDisplayedLine
    ) {
      this.hintSpinActive = true
      this.hintSpinTargetLine = target
      this.hintSpinProgress = 0
      this.hintSpinSwapped = false
      this.applyHintTransform(1, 0)
      return
    }

    if (wantsShow && this.hintDisplayedLine !== target) {
      this.hintDisplayedLine = target
      this.hintText.text = target
    }

    if (!wantsShow && this.hintScaleVisual <= 0.01) {
      this.hintScaleVisual = 0
      this.hintDisplayedLine = ""
      this.hintText.text = ""
    }

    this.applyHintTransform(this.hintScaleVisual, 0)
  }

  private applyHintTransform(scale: number, xAngleRad: number) {
    const pivot = this.getHintPivot()
    if (!pivot) {
      return
    }

    const s = Math.max(0, scale)
    const base = this.hintPivotBaseScale
    pivot
      .getTransform()
      .setLocalScale(new vec3(base.x * s, base.y * s, base.z * s))

    const spin = quat.fromEulerVec(new vec3(xAngleRad, 0, 0))
    pivot.getTransform().setLocalRotation(this.hintBaseRotation.multiply(spin))
  }

  private getHintPivot(): SceneObject | null {
    if (this.hintPivot) {
      return this.hintPivot
    }
    if (this.hintText) {
      return this.hintText.getSceneObject()
    }
    return null
  }

  private clearHint() {
    this.cachedHintLine = ""
    this.activeHintType = "none"
    this.activeHintContextKey = ""
  }

  private updateHintIfNeeded() {
    const hintType = this.resolveHintType()
    const contextKey = this.buildHintContextKey(hintType)

    if (hintType === "none") {
      this.clearHint()
      return
    }

    if (hintType === this.activeHintType && contextKey === this.activeHintContextKey) {
      return
    }

    this.activeHintType = hintType
    this.activeHintContextKey = contextKey
    this.cachedHintLine = this.pickVariantForType(hintType, contextKey)
  }

  private resolveHintType(): HintType {
    if (!this.probe || this.spotFailStreak >= 2) {
      return "none"
    }

    const count = this.getHintSampleCount()
    const status = this.probe.getLastStatus()
    const lastFailed =
      status !== "ok" &&
      status.indexOf("ok ") !== 0 &&
      status !== "idle"

    if (lastFailed && this.spotFailStreak === 1) {
      return "retry"
    }

    if (count >= this.moveAfterSamples) {
      return "move"
    }

    if (count > 0 && count < this.moveAfterSamples) {
      return "stay"
    }

    return "none"
  }

  private buildHintContextKey(hintType: HintType): string {
    if (hintType === "none") {
      return ""
    }
    return `${this.hintCellKey}:${hintType}`
  }

  private pickVariantForType(hintType: HintType, contextKey: string): string {
    let variants: string[] = []
    if (hintType === "retry") {
      variants = this.hintRetryVariants
    } else if (hintType === "move") {
      variants = this.hintMoveVariants
    } else if (hintType === "stay") {
      variants = this.hintStayVariants
    }
    return this.pickVariant(variants, this.stableHintSeed(contextKey))
  }

  private stableHintSeed(key: string): number {
    let hash = 0
    for (let i = 0; i < key.length; i++) {
      hash = (hash * 31 + key.charCodeAt(i)) | 0
    }
    return Math.abs(hash)
  }

  private pickVariant(variants: string[], seed: number): string {
    if (!variants || variants.length === 0) {
      return ""
    }
    const idx = Math.abs(seed) % variants.length
    const line = variants[idx]
    return line && line.length > 0 ? line : ""
  }

  private resolveBracketLabel(pct: number): string {
    const idx = bracketIndex(pct)
    const labels =
      this.bracketLabels && this.bracketLabels.length >= 10
        ? this.bracketLabels
        : defaultBracketLabels()
    const label = labels[idx]
    return label && label.length > 0 ? label : `${pct.toFixed(0)}%`
  }

  /** Always uses bracket color when pct >= 0. */
  private applyHeaderBracketColor(pct: number) {
    if (!this.headerText) {
      return
    }
    if (pct < 0) {
      applyTextFillColor(this.headerText, DEFAULT_HEADER_TEXT_COLOR)
      return
    }
    applyTextFillColor(
      this.headerText,
      colorForSessionPercent(this.bracketMaterials, pct)
    )
  }

  private getUserWorldPosition(): vec3 {
    if (this.positionSource) {
      return this.positionSource.getTransform().getWorldPosition()
    }
    return this.getSceneObject().getTransform().getWorldPosition()
  }

  private getCurrentCellKey(): string {
    if (!this.grid) {
      return ""
    }
    const pos = this.getUserWorldPosition()
    const size = this.grid.getGridSize()
    const cellX = Math.round(pos.x / size) * size
    const cellZ = Math.round(pos.z / size) * size
    return `${cellX},${cellZ}`
  }
}
