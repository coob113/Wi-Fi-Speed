import {CoverageGridManager, CoverageExportSnapshot} from "./CoverageGridManager"
import {RectangleButton} from "SpectaclesUIKit.lspkg/Scripts/Components/Button/RectangleButton"

type PublishResponse = {
  pin?: string
  expiresAt?: string
  error?: string
}

const DEFAULT_PUBLISH_URL = "https://webview.wi-fi-speed.pages.dev/api/publish"
const PUBLISH_BUTTON_NAME = "PublishButton"
const PIN_OBJECT_NAME = "PinCode"
const HINT_OBJECT_NAME = "Hint"

@component
export class CoveragePublishController extends BaseScriptComponent {
  @input
  @allowUndefined
  @hint("CoverageGridManager to snapshot when publishing")
  grid: CoverageGridManager

  @input
  @hint("Cloudflare Pages/Worker endpoint, e.g. https://wifi-speed.pages.dev/api/publish")
  publishUrl: string = DEFAULT_PUBLISH_URL

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
  @hint("Optional root for status/hint text; hidden until publish returns a PIN")
  statusRoot: SceneObject

  @input
  @allowUndefined
  @hint("Optional text where the six digit PIN is shown")
  pinText: Text

  @input
  @allowUndefined
  @hint("Optional root for PIN text; hidden until publish returns a PIN")
  pinRoot: SceneObject

  private internetModule: InternetModule = require("LensStudio:InternetModule")
  private inFlight = false
  private lastPin = ""

  onAwake() {
    this.createEvent("OnStartEvent").bind(() => this.onStart())
  }

  private onStart() {
    this.resolveSceneReferences()
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
          this.setStatus("Enter this PIN at webview.wi-fi-speed.pages.dev")
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

  private resolveSceneReferences() {
    if (!this.grid) {
      this.grid = this.findGridManager()
    }

    if (!this.publishButton) {
      const buttonObject = this.findChildByName(this.getSceneObject(), PUBLISH_BUTTON_NAME)
      if (buttonObject) {
        this.publishButton = this.findRectangleButton(buttonObject)
      }
    }

    if (!this.pinRoot || !this.pinText) {
      const pinObject = this.findChildByName(this.getSceneObject(), PIN_OBJECT_NAME)
      if (pinObject) {
        this.pinRoot = this.pinRoot || pinObject
        this.pinText = this.pinText || (pinObject.getComponent("Component.Text") as Text)
      }
    }

    if (!this.statusRoot || !this.statusText) {
      const hintObject = this.findChildByName(this.getSceneObject(), HINT_OBJECT_NAME)
      if (hintObject) {
        this.statusRoot = this.statusRoot || hintObject
        this.statusText = this.statusText || (hintObject.getComponent("Component.Text") as Text)
      }
    }
  }

  private findGridManager(): CoverageGridManager | null {
    const rootCount = global.scene.getRootObjectsCount()
    for (let i = 0; i < rootCount; i++) {
      const found = this.findGridManagerInObject(global.scene.getRootObject(i))
      if (found) {
        return found
      }
    }
    return null
  }

  private findGridManagerInObject(obj: SceneObject): CoverageGridManager | null {
    const components = obj.getComponents("Component.ScriptComponent")
    for (let i = 0; i < components.length; i++) {
      const candidate = components[i] as any
      if (candidate && typeof candidate.exportSnapshot === "function") {
        return candidate as CoverageGridManager
      }
    }

    const childCount = obj.getChildrenCount()
    for (let i = 0; i < childCount; i++) {
      const found = this.findGridManagerInObject(obj.getChild(i))
      if (found) {
        return found
      }
    }
    return null
  }

  private findChildByName(parent: SceneObject, name: string): SceneObject | null {
    if (parent.name === name) {
      return parent
    }

    const childCount = parent.getChildrenCount()
    for (let i = 0; i < childCount; i++) {
      const found = this.findChildByName(parent.getChild(i), name)
      if (found) {
        return found
      }
    }
    return null
  }

  private findRectangleButton(obj: SceneObject): RectangleButton | null {
    const components = obj.getComponents("Component.ScriptComponent")
    for (let i = 0; i < components.length; i++) {
      const candidate = components[i] as any
      if (candidate && candidate.onInitialized && candidate.onTriggerUp) {
        return candidate as RectangleButton
      }
    }
    return null
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
    const root = this.pinRoot || (this.pinText ? this.pinText.getSceneObject() : null)
    if (root) {
      root.enabled = visible
    }
  }

  private setStatusVisible(visible: boolean) {
    const root = this.statusRoot || (this.statusText ? this.statusText.getSceneObject() : null)
    if (root) {
      root.enabled = visible
    }
  }
}
