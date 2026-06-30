import {CoverageGridManager, CoverageExportSnapshot} from "./CoverageGridManager"
import {RectangleButton} from "SpectaclesUIKit.lspkg/Scripts/Components/Button/RectangleButton"

type PublishResponse = {
  pin?: string
  expiresAt?: string
  error?: string
}

const DEFAULT_PUBLISH_URL = "https://wifi.familybusiness.studio/api/publish"

@component
export class CoveragePublishController extends BaseScriptComponent {
  @input
  @hint("CoverageGridManager to snapshot when publishing")
  grid: CoverageGridManager

  @input
  @hint("Cloudflare Pages/Worker endpoint, e.g. https://wifi-speed.pages.dev/api/publish")
  publishUrl: string = DEFAULT_PUBLISH_URL

  @input
  @hint("Days until the PIN expires; backend caps this at 30")
  expiresInDays: number = 30

  @input
  @hint("Minimum directly recorded cells before publishing is allowed; 0 means publish anytime")
  minDirectCells: number = 0

  @input
  @hint("UIKit button that triggers publish")
  publishButton: RectangleButton

  @input
  @hint("Status text for publish progress / errors")
  statusText: Text

  @input
  @hint("Root for status/hint text; hidden until publish returns a PIN")
  statusRoot: SceneObject

  @input
  @hint("Text where the six digit PIN is shown")
  pinText: Text

  @input
  @hint("Root for PIN text; hidden until publish returns a PIN")
  pinRoot: SceneObject

  private internetModule: InternetModule = require("LensStudio:InternetModule")
  private inFlight = false
  private lastPin = ""
  private isConfigured = false

  onAwake() {
    this.createEvent("OnStartEvent").bind(() => this.onStart())
  }

  private onStart() {
    this.isConfigured = this.validateRequiredInputs()
    if (!this.isConfigured) {
      return
    }
    this.bindButton()
    this.refreshIdleText()
  }

  public publishCurrentMap() {
    if (this.inFlight) {
      return
    }

    if (!this.isConfigured) {
      console.error("[CoveragePublishController] Cannot publish: controller is not fully wired")
      return
    }

    if (!this.grid) {
      this.setStatus("Map not wired")
      return
    }

    const snapshot = this.grid.exportSnapshot()
    const requiredCells = Math.max(0, Math.round(this.minDirectCells))
    if (requiredCells > 0 && snapshot.directCellCount < requiredCells) {
      this.setStatus("Scan more points first")
      return
    }

    const url = (this.publishUrl || DEFAULT_PUBLISH_URL).trim()
    if (url.length === 0) {
      this.setStatus("Publish URL missing")
      return
    }

    this.inFlight = true
    this.lastPin = ""
    this.setPin("")
    this.setStatus("Publishing...")

    const body = JSON.stringify({
      expiresInDays: Math.max(1, Math.min(30, Math.round(this.expiresInDays))),
      snapshot: this.prepareSnapshot(snapshot),
    })

    this.internetModule
      .fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body,
      })
      .then((response) => {
        return response.text().then((text) => {
          if (!response.ok) {
            this.finishFailure(text || `HTTP ${response.status}`)
            return
          }

          let parsed: PublishResponse | null = null
          try {
            parsed = JSON.parse(text) as PublishResponse
          } catch (_e) {
            parsed = null
          }

          if (!parsed || !parsed.pin) {
            this.finishFailure("Bad publish response")
            return
          }

          this.inFlight = false
          this.lastPin = parsed.pin
          this.setPin(parsed.pin)
          this.setStatus("Enter this PIN at wifi.familybusiness.studio")
        })
      })
      .catch(() => {
        this.finishFailure("Publish failed")
      })
  }

  public getLastPin(): string {
    return this.lastPin
  }

  public isPublishing(): boolean {
    return this.inFlight
  }

  private bindButton() {
    if (!this.publishButton) {
      console.error("[CoveragePublishController] publishButton is not assigned")
      return
    }

    this.publishButton.onInitialized.add(() => {
      this.publishButton.onTriggerUp.add(() => {
        this.publishCurrentMap()
      })
    })
  }

  private prepareSnapshot(snapshot: CoverageExportSnapshot): CoverageExportSnapshot {
    return snapshot
  }

  private finishFailure(message: string) {
    this.inFlight = false
    this.setStatus(message.length > 0 ? message : "Publish failed")
  }

  private refreshIdleText() {
    if (this.pinText) {
      this.pinText.text = ""
    }
    this.setStatus("")
    this.setPinVisible(false)
    this.setStatusVisible(false)
  }

  private setStatus(text: string) {
    if (this.statusText) {
      this.statusText.text = text
    }
    if (text.length > 0 && this.lastPin.length > 0) {
      this.setStatusVisible(true)
    }
  }

  private setPin(pin: string) {
    if (this.pinText) {
      this.pinText.text = pin
    }
    const hasPin = pin.length > 0
    this.setPinVisible(hasPin)
    this.setStatusVisible(hasPin)
  }

  private setPinVisible(visible: boolean) {
    this.pinRoot.enabled = visible
  }

  private setStatusVisible(visible: boolean) {
    this.statusRoot.enabled = visible
  }

  private validateRequiredInputs(): boolean {
    let ok = true
    if (!this.grid) {
      console.error("[CoveragePublishController] grid is not assigned")
      ok = false
    }
    if (!this.publishButton) {
      console.error("[CoveragePublishController] publishButton is not assigned")
      ok = false
    }
    if (!this.statusText) {
      console.error("[CoveragePublishController] statusText is not assigned")
      ok = false
    }
    if (!this.statusRoot) {
      console.error("[CoveragePublishController] statusRoot is not assigned")
      ok = false
    }
    if (!this.pinText) {
      console.error("[CoveragePublishController] pinText is not assigned")
      ok = false
    }
    if (!this.pinRoot) {
      console.error("[CoveragePublishController] pinRoot is not assigned")
      ok = false
    }
    return ok
  }
}
