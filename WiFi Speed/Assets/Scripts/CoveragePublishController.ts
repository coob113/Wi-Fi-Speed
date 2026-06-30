import {CoverageGridManager, CoverageExportSnapshot} from "./CoverageGridManager"
import {RectangleButton} from "SpectaclesUIKit.lspkg/Scripts/Components/Button/RectangleButton"

type PublishResponse = {
  pin?: string
  expiresAt?: string
  error?: string
}

const DEFAULT_PUBLISH_URL = "https://wifi.familybusiness.studio/api/publish"
const PENDING_PIN_TEXT = "------"
const PENDING_STATUS_TEXT = "Generating PIN"
const SUCCESS_STATUS_TEXT = "Enter this PIN at wifi.familybusiness.studio"
const INITIAL_BUTTON_TEXT = "PUBLISH"
const UPDATED_BUTTON_TEXT = "UPDATE"

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
  @allowUndefined
  @hint("Text label on the publish button")
  publishButtonText: Text

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

  @input
  @hint("Enable verbose publish/device debug logs")
  debugLogs: boolean = false

  private internetModule: InternetModule = require("LensStudio:InternetModule")
  private inFlight = false
  private lastPin = ""
  private hasPublished = false
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

    this.logDebug("publish button pressed")

    if (!this.isConfigured) {
      console.error("[CoveragePublishController] Cannot publish: controller is not fully wired")
      return
    }

    if (!this.grid) {
      this.setStatus("Map not wired", true)
      return
    }

    const snapshot = this.grid.exportSnapshot()
    this.logDebug(
      "snapshot cell counts: cells=" +
        snapshot.cellCount +
        ", direct=" +
        snapshot.directCellCount +
        ", exported=" +
        snapshot.cells.length
    )

    const requiredCells = Math.max(0, Math.round(this.minDirectCells))
    if (requiredCells > 0 && snapshot.directCellCount < requiredCells) {
      this.setStatus("Scan more points first", true)
      return
    }

    const url = (this.publishUrl || DEFAULT_PUBLISH_URL).trim()
    if (url.length === 0) {
      this.setStatus("Publish URL missing", true)
      return
    }

    this.inFlight = true
    this.showPendingState()
    this.logDebug("POST URL: " + url)

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
        this.logDebug("response status: " + response.status)
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
          this.logDebug("generated PIN received: " + parsed.pin)
          this.showSuccessState(parsed.pin)
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
    this.showFailureState(message.length > 0 ? message : "Publish failed")
  }

  private showPendingState() {
    this.lastPin = ""
    this.setPin(PENDING_PIN_TEXT, true)
    this.setStatus(PENDING_STATUS_TEXT, true)
  }

  private showSuccessState(pin: string) {
    this.hasPublished = true
    this.lastPin = pin
    this.setPin(pin, true)
    this.setStatus(SUCCESS_STATUS_TEXT, true)
    this.setPublishButtonText(UPDATED_BUTTON_TEXT)
  }

  private showFailureState(message: string) {
    this.lastPin = ""
    this.setPin("", false)
    this.setStatus(message, true)
  }

  private refreshIdleText() {
    if (this.pinText) {
      this.pinText.text = ""
    }
    this.setPublishButtonText(this.hasPublished ? UPDATED_BUTTON_TEXT : INITIAL_BUTTON_TEXT)
    this.setPin("", false)
    this.setStatus("", false)
  }

  private setStatus(text: string, visible = text.length > 0 && this.lastPin.length > 0) {
    if (this.statusText) {
      this.statusText.text = text
    }
    this.setStatusVisible(visible)
  }

  private setPin(pin: string, visible = pin.length > 0) {
    if (this.pinText) {
      this.pinText.text = pin
    }
    this.setPinVisible(visible)
  }

  private setPinVisible(visible: boolean) {
    this.pinRoot.enabled = visible
  }

  private setStatusVisible(visible: boolean) {
    this.statusRoot.enabled = visible
  }

  private setPublishButtonText(text: string) {
    if (this.publishButtonText) {
      this.publishButtonText.text = text
    }
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
    if (!this.publishButtonText) {
      console.error("[CoveragePublishController] publishButtonText is not assigned")
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

  private logDebug(message: string) {
    if (this.debugLogs) {
      console.log("[CoveragePublishController] " + message)
    }
  }
}
