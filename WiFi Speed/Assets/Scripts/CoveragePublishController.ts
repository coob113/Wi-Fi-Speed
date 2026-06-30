import {CoverageGridManager, CoverageExportSnapshot} from "./CoverageGridManager"
import {RectangleButton} from "SpectaclesUIKit.lspkg/Scripts/Components/Button/RectangleButton"

type PublishResponse = {
  pin?: string
  expiresAt?: string
  error?: string
}

@component
export class CoveragePublishController extends BaseScriptComponent {
  @input
  @allowUndefined
  @hint("CoverageGridManager to snapshot when publishing")
  grid: CoverageGridManager

  @input
  @hint("Cloudflare Pages/Worker endpoint, e.g. https://wifi-speed.pages.dev/api/publish")
  publishUrl: string = ""

  @input
  @hint("Days until the PIN expires; backend caps this at 30")
  expiresInDays: number = 30

  @input
  @hint("Minimum directly recorded cells before publishing is allowed")
  minDirectCells: number = 1

  @input
  @allowUndefined
  @hint("Optional UIKit button that triggers publish")
  publishButton: RectangleButton

  @input
  @allowUndefined
  @hint("Optional status text for publish progress / errors")
  statusText: Text

  @input
  @allowUndefined
  @hint("Optional text where the six digit PIN is shown")
  pinText: Text

  private internetModule: InternetModule = require("LensStudio:InternetModule")
  private inFlight = false
  private lastPin = ""

  onAwake() {
    this.createEvent("OnStartEvent").bind(() => this.onStart())
  }

  private onStart() {
    this.bindButton()
    this.refreshIdleText()
  }

  public publishCurrentMap() {
    if (this.inFlight) {
      return
    }

    if (!this.grid) {
      this.setStatus("Map not wired")
      return
    }

    const snapshot = this.grid.exportSnapshot()
    if (snapshot.directCellCount < Math.max(1, Math.round(this.minDirectCells))) {
      this.setStatus("Scan more points first")
      return
    }

    const url = (this.publishUrl || "").trim()
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
          this.setStatus("PIN ready")
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
  }

  private setStatus(text: string) {
    if (this.statusText) {
      this.statusText.text = text
    }
  }

  private setPin(pin: string) {
    if (this.pinText) {
      this.pinText.text = pin
    }
  }
}
