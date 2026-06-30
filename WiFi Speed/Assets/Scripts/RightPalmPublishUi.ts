import TrackedHand from "SpectaclesInteractionKit.lspkg/Providers/HandInputData/TrackedHand"
import {SIK} from "SpectaclesInteractionKit.lspkg/SIK"

@component
export class RightPalmPublishUi extends BaseScriptComponent {
  @input
  @hint("Right palm center. RightPalmUI follows this each frame.")
  palmAttachPoint: SceneObject

  @input
  @hint("Root to scale on right palm show/hide.")
  scaleRoot: SceneObject

  @input
  @hint("Lerp speed for right palm attach follow")
  attachLerp: number = 0.35

  @input
  @hint("Scale lerp speed when right palm shows / hides")
  scaleTransitionSpeed: number = 8

  @input
  @hint("Seconds right palm must face camera before UI scales in")
  palmShowDelaySec: number = 0.15

  @input
  @hint("Seconds right palm turned away before UI scales out")
  palmHideDelaySec: number = 0.25

  private rightHand: TrackedHand | null = null
  private configured = false
  private uiScale = 0
  private targetUiScale = 0
  private palmVisible = false
  private palmVisibilityTimer = 0

  onAwake() {
    this.createEvent("OnStartEvent").bind(() => this.onStart())
    this.createEvent("UpdateEvent").bind(() => this.onUpdate())
  }

  private onStart() {
    this.configured = this.validateRequiredInputs()
    if (!this.configured) {
      return
    }

    try {
      this.rightHand = SIK.HandInputData.getHand("right")
    } catch (_e) {
      console.error("[RightPalmPublishUi] Could not access right hand tracking")
      this.configured = false
      return
    }

    this.uiScale = this.shouldShowPalmUiRaw() ? 1 : 0
    this.targetUiScale = this.uiScale
    this.palmVisible = this.uiScale > 0.5
    this.applyUiScale()
  }

  private onUpdate() {
    if (!this.configured) {
      return
    }

    this.updatePalmVisibility()
    this.updateAttachPosition()
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
    const t = Math.min(1, getDeltaTime() * this.scaleTransitionSpeed)
    this.uiScale = this.uiScale + (this.targetUiScale - this.uiScale) * t
    this.applyUiScale()
  }

  private shouldShowPalmUiRaw(): boolean {
    if (global.deviceInfoSystem.isEditor()) {
      return true
    }
    return !!this.rightHand && this.rightHand.isTracked() && this.rightHand.isFacingCamera()
  }

  private updateAttachPosition() {
    const target = this.palmAttachPoint.getTransform().getWorldPosition()
    const tr = this.getSceneObject().getTransform()
    const cur = tr.getWorldPosition()
    tr.setWorldPosition(vec3.lerp(cur, target, this.attachLerp))
  }

  private applyUiScale() {
    const s = Math.max(0, this.uiScale)
    this.scaleRoot.getTransform().setLocalScale(new vec3(s, s, s))
  }

  private validateRequiredInputs(): boolean {
    let ok = true
    if (!this.palmAttachPoint) {
      console.error("[RightPalmPublishUi] palmAttachPoint is not assigned")
      ok = false
    }
    if (!this.scaleRoot) {
      console.error("[RightPalmPublishUi] scaleRoot is not assigned")
      ok = false
    }
    return ok
  }
}
