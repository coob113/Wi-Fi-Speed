import {Frame} from "SpectaclesUIKit.lspkg/Scripts/Components/Frame/Frame"
import {unsubscribe} from "SpectaclesInteractionKit.lspkg/Utils/Event"
import {RectangleButton} from "SpectaclesUIKit.lspkg/Scripts/Components/Button/RectangleButton"
import {CoverageGridManager} from "./CoverageGridManager"
import {CoveragePalmUi} from "./CoveragePalmUi"
import {RecordMarker} from "./RecordMarker"

@component
export class OnboardingController extends BaseScriptComponent {
  @input
  @hint("Slide 1 … Slide 6 — enable one at a time")
  slides: SceneObject[] = []

  @input
  @allowUndefined
  @hint("UI/Step Text — updated from the slide count")
  stepText: Text

  @input
  @allowUndefined
  @hint("UI/Previous root — hidden on slide 1")
  prevButtonObject: SceneObject

  @input
  @allowUndefined
  @hint("Spectacles UIKit Frame on Onboarding (Close button)")
  frame: Frame

  @input
  @allowUndefined
  @hint("UIKit Previous button component")
  prevButton: RectangleButton

  @input
  @allowUndefined
  @hint("UIKit Next button — always shown; dismisses on last slide")
  nextButton: RectangleButton

  @input
  @allowUndefined
  grid: CoverageGridManager

  @input
  @allowUndefined
  palmUi: CoveragePalmUi

  @input
  @hint("Deprecated: onboarding now starts on every lens launch")
  forceShowOnboarding: boolean = true

  @input
  slide1AutoSec: number = 15

  @input
  slide2NewBars: number = 30

  @input
  finalSlideAutoSec: number = 5

  private currentSlide = 0
  private slideEnterTime = 0
  private baselineMarkerCount = 0
  private palmVisibleLastFrame = false
  private pinchTriggered = false
  private pendingDismiss = false
  private active = false
  private detailUnsub: unsubscribe | null = null

  onAwake() {
    this.disableAllSlides()
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
    if (this.detailUnsub) {
      this.detailUnsub()
      this.detailUnsub = null
    }
  }

  private onStart() {
    this.bindButtons()
    this.bindFrameClose()

    this.active = true
    this.getSceneObject().enabled = true
    this.detailUnsub = RecordMarker.subscribeDetailOpened(() => {
      this.onDetailOpened()
    })
    this.goToSlide(0)
  }

  private onUpdate() {
    if (this.pendingDismiss) {
      this.disableAllSlides()
      this.getSceneObject().enabled = false
      this.pendingDismiss = false
      this.active = false
      return
    }

    if (!this.active) {
      return
    }

    const elapsed = getTime() - this.slideEnterTime

    if (this.currentSlide === 0 && elapsed >= this.slide1AutoSec) {
      this.goToSlide(1)
      return
    }

    if (this.currentSlide === 1 && this.grid) {
      const newBars = this.grid.getMarkerCount() - this.baselineMarkerCount
      if (newBars >= this.slide2NewBars) {
        this.goToSlide(2)
        return
      }
    }

    if (this.currentSlide === 2 && this.palmUi) {
      const visible = this.palmUi.isPalmUiVisible()
      if (visible && !this.palmVisibleLastFrame) {
        this.goToSlide(3)
        return
      }
      this.palmVisibleLastFrame = visible
    }

    if (this.isFinalSlide() && elapsed >= this.finalSlideAutoSec) {
      this.scheduleDismiss()
    }
  }

  private bindButtons() {
    if (this.prevButton) {
      this.prevButton.onInitialized.add(() => {
        this.prevButton.onTriggerUp.add(() => {
          this.onPrevPressed()
        })
      })
    }

    if (this.nextButton) {
      this.nextButton.onInitialized.add(() => {
        this.nextButton.onTriggerUp.add(() => {
          this.onNextPressed()
        })
      })
    }
  }

  private bindFrameClose() {
    if (!this.frame || !this.frame.closeButton) {
      return
    }

    this.frame.closeButton.onInitialized.add(() => {
      this.frame.closeButton.onTriggerUp.add(() => {
        this.dismissNow()
      })
    })
  }

  private onPrevPressed() {
    if (!this.active || this.currentSlide <= 0) {
      return
    }
    this.goToSlide(this.currentSlide - 1)
  }

  private onNextPressed() {
    if (!this.active) {
      return
    }

    if (this.currentSlide >= this.slides.length - 1) {
      this.dismissNow()
      return
    }

    this.goToSlide(this.currentSlide + 1)
  }

  private onDetailOpened() {
    if (!this.active || this.currentSlide !== 3 || this.pinchTriggered) {
      return
    }

    this.pinchTriggered = true
    this.goToSlide(4)
  }

  private goToSlide(index: number) {
    if (!this.slides || this.slides.length === 0) {
      return
    }

    const clamped = Math.max(0, Math.min(index, this.slides.length - 1))
    this.currentSlide = clamped
    this.applySlideVisibility(clamped)

    this.refreshStepLabel()
    this.refreshNav()
    this.slideEnterTime = getTime()

    if (clamped === 1 && this.grid) {
      this.baselineMarkerCount = this.grid.getMarkerCount()
    }

    if (clamped === 2) {
      this.palmVisibleLastFrame = this.palmUi
        ? this.palmUi.isPalmUiVisible()
        : false
    }

    if (clamped === 3) {
      this.pinchTriggered = false
    }
  }

  private disableAllSlides() {
    if (!this.slides) {
      return
    }
    for (let i = 0; i < this.slides.length; i++) {
      const slide = this.slides[i]
      if (slide) {
        slide.enabled = false
      }
    }
  }

  /** Exactly one slide enabled; all others off. */
  private applySlideVisibility(activeIndex: number) {
    if (!this.slides) {
      return
    }
    for (let i = 0; i < this.slides.length; i++) {
      const slide = this.slides[i]
      if (slide) {
        slide.enabled = i === activeIndex
      }
    }
  }

  private refreshStepLabel() {
    if (!this.stepText) {
      return
    }
    this.stepText.text = `Step ${this.currentSlide + 1}/${this.slides.length}`
  }

  private refreshNav() {
    if (this.prevButtonObject) {
      this.prevButtonObject.enabled = this.currentSlide > 0
    }
  }

  private isFinalSlide(): boolean {
    return this.slides && this.slides.length > 0 && this.currentSlide >= this.slides.length - 1
  }

  private scheduleDismiss() {
    if (this.pendingDismiss) {
      return
    }
    this.pendingDismiss = true
  }

  private dismissNow() {
    this.disableAllSlides()
    this.getSceneObject().enabled = false
    this.active = false
  }
}
