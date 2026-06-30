import {CoverageGridManager} from "./CoverageGridManager"
import {clampPercent, sessionPercent} from "./CoverageMetrics"
import {SnapCloudRequirements} from "./SnapCloudRequirements"

@component
export class ConnectionProbe extends BaseScriptComponent {
  @input
  @allowUndefined
  @hint("Snap Cloud config (assign SupabaseProject on this component)")
  snapCloud: SnapCloudRequirements

  @input
  @hint("Storage bucket name on Snap Cloud")
  storageBucket: string = "speedtest"

  @input
  @hint("Object path in bucket (e.g. 10mb.bin)")
  storageObjectPath: string = "10mb.bin"

  @input
  @hint("Override download URL (leave empty to use Snap Cloud storage URL)")
  downloadUrl: string = ""

  @input
  @hint("Expected download size in bytes (0 = use received body length)")
  expectedBytes: number = 10240000

  @input
  @allowUndefined
  @hint("Spawns/updates grid markers from successful samples")
  coverageGrid: CoverageGridManager

  @input
  @allowUndefined
  @hint("World position for grid cell (e.g. Camera or Device Tracking object)")
  positionSource: SceneObject

  @input
  @hint("Max XZ travel during probe; discard sample if exceeded")
  maxTravelDistance: number = 25

  @input
  @allowUndefined
  @hint("Plays on successful probe (recorded, not discarded)")
  successAudio: AudioComponent

  @input
  @allowUndefined
  @hint("Plays on failed probe (error, moved too far, bad size, etc.)")
  failAudio: AudioComponent

  @input
  @hint("Pause before next probe (lets Palm UI show OK + hints)")
  interProbeDelaySec: number = 0.5

  @input
  @hint("Download via HTTP Range (required for warmup window)")
  useByteRange: boolean = true

  @input
  @hint("Warmup then score: Range warmup bytes 0-(N-1), then timed measure range")
  useWarmupWindow: boolean = true

  @input
  @hint("Warmup bytes discarded before timed measure (default 2 MB)")
  warmupBytes: number = 2097152

  @input
  @hint("Minimum scored bytes; if measure window smaller, use full-file Range")
  minMeasureBytes: number = 4194304

  @input
  @hint("If Range fails, retry once with a normal full-file GET")
  rangeFallbackToBulk: boolean = true

  @input
  @hint("Log warmup / measure / bulk details to Logger (device tuning)")
  logMeasurementDetail: boolean = false

  @input
  @hint("Enable verbose probe/device debug logs")
  debugLogs: boolean = false

  private internetModule: InternetModule = require("LensStudio:InternetModule")

  private inFlight = false
  private lastMbps = -1
  private lastStatus = "idle"
  private scanStartTime = -1
  private recentScanDurations: number[] = []
  private resultSequence = 0
  private restartEvent: DelayedCallbackEvent | null = null
  private sessionOkMinMbps = Number.POSITIVE_INFINITY
  private sessionOkMaxMbps = Number.NEGATIVE_INFINITY
  private lastOkMbps = -1
  private sessionOkCount = 0
  private lastCoverageRecordStatus = "idle"
  private loggedRangeFallback = false
  private scanStartPosition: vec3 | null = null

  onAwake() {
    this.createEvent("OnStartEvent").bind(() => {
      this.onStart()
    })
    this.createEvent("OnDestroyEvent").bind(() => {
      this.onDestroy()
    })
  }

  private onDestroy() {
    if (this.restartEvent) {
      this.restartEvent.enabled = false
      this.restartEvent = null
    }
  }

  private onStart() {
    this.resolveCoverageGrid()
    const url = this.resolveDownloadUrl()
    if (url.length === 0) {
      this.logError("no download url (wire Snap Cloud or Download Url)")
      return
    }
    this.log(`L: -- ${url}`)
    this.runSpeedtest()
  }

  public isInFlight(): boolean {
    return this.inFlight
  }

  public getLastMbps(): number {
    return this.lastMbps
  }

  public getLastStatus(): string {
    return this.lastStatus
  }

  public getScanElapsedSec(): number {
    if (this.scanStartTime < 0) {
      return 0
    }
    return getTime() - this.scanStartTime
  }

  public getAverageScanDurationSec(): number {
    if (this.recentScanDurations.length === 0) {
      return -1
    }
    let sum = 0
    for (let i = 0; i < this.recentScanDurations.length; i++) {
      sum += this.recentScanDurations[i]
    }
    return sum / this.recentScanDurations.length
  }

  public getRecentScanDurations(): number[] {
    return this.recentScanDurations.slice()
  }

  public getResultSequence(): number {
    return this.resultSequence
  }

  public getSessionOkMinMax(): {min: number; max: number} {
    return {
      min: this.sessionOkMinMbps,
      max: this.sessionOkMaxMbps,
    }
  }

  public hasLastOk(): boolean {
    return this.lastOkMbps >= 0
  }

  public getLastOkMbps(): number {
    return this.lastOkMbps
  }

  public getLastOkSessionPercent(): number {
    if (this.lastOkMbps < 0) {
      return -1
    }
    const range = this.getSessionOkMinMax()
    return clampPercent(sessionPercent(this.lastOkMbps, range.min, range.max))
  }

  public getSessionOkCount(): number {
    return this.sessionOkCount
  }

  public getLastCoverageRecordStatus(): string {
    return this.lastCoverageRecordStatus
  }

  public getInterProbeDelaySec(): number {
    return Math.max(0, this.interProbeDelaySec)
  }

  public getMaxTravelDistance(): number {
    return Math.max(0, this.maxTravelDistance)
  }

  public getCurrentTravelDistance(): number {
    if (!this.inFlight || !this.scanStartPosition) {
      return -1
    }
    return this.horizontalDistance(this.scanStartPosition, this.getSampleWorldPosition())
  }

  public getCurrentTravelFraction(): number {
    const maxTravel = this.getMaxTravelDistance()
    if (maxTravel <= 0) {
      return -1
    }
    const travel = this.getCurrentTravelDistance()
    if (travel < 0) {
      return -1
    }
    return travel / maxTravel
  }

  public isLastResultOk(): boolean {
    return this.lastStatus === "ok" || this.lastStatus.indexOf("ok ") === 0
  }

  private resolveDownloadUrl(): string {
    const override = (this.downloadUrl || "").trim()
    if (override.length > 0) {
      return override
    }

    const snapCloud = this.snapCloud as SnapCloudRequirements | null
    if (!snapCloud || typeof snapCloud.isConfigured !== "function") {
      return ""
    }
    if (!snapCloud.isConfigured()) {
      return ""
    }

    if (typeof snapCloud.getPublicStorageUrl === "function") {
      return snapCloud.getPublicStorageUrl(this.storageBucket, this.storageObjectPath)
    }

    const base = snapCloud.getStorageApiUrl()
    if (base.length === 0) {
      return ""
    }
    const cleanPath = (this.storageObjectPath || "").replace(/^\//, "")
    return `${base}${this.storageBucket}/${cleanPath}`
  }

  private runSpeedtest() {
    if (this.inFlight) {
      return
    }

    const url = this.resolveDownloadUrl()
    if (url.length === 0) {
      this.logError("no url")
      return
    }

    this.inFlight = true
    this.scanStartTime = getTime()
    const startPos = this.getSampleWorldPosition()
    this.scanStartPosition = startPos
    this.probeDownload(this.cacheBust(url), (mbps, status) => {
      const endPos = this.getSampleWorldPosition()
      let finalStatus = status
      const finalTravel = this.horizontalDistance(startPos, endPos)
      if (status.indexOf("ok") === 0 && this.exceededMaxTravelDistance(finalTravel)) {
        finalStatus = "moved"
        this.logMovementDiscard(finalTravel)
      }
      const scanDuration = getTime() - this.scanStartTime
      this.scanStartTime = -1
      this.scanStartPosition = null
      if (finalStatus.indexOf("ok") === 0 && scanDuration > 0) {
        this.pushScanDuration(scanDuration)
      }
      this.lastMbps = mbps
      this.lastStatus = finalStatus
      this.inFlight = false
      if (finalStatus.indexOf("ok") === 0 && mbps >= 0) {
        this.lastOkMbps = mbps
        this.sessionOkCount++
        this.recordSessionOkRange(mbps)
      }
      this.resultSequence++
      this.logResult()
      this.playFeedback(finalStatus)
      this.recordCoverageSample(mbps, finalStatus, startPos, endPos)
      this.logProbeSummary(scanDuration)
      this.scheduleNextSpeedtest()
    })
  }

  private scheduleNextSpeedtest() {
    const delay = Math.max(0, this.interProbeDelaySec)
    if (delay <= 0) {
      this.runSpeedtest()
      return
    }

    if (this.restartEvent) {
      this.restartEvent.enabled = false
    }

    this.restartEvent = this.createEvent("DelayedCallbackEvent")
    this.restartEvent.bind(() => {
      this.restartEvent = null
      this.runSpeedtest()
    })
    this.restartEvent.reset(delay)
  }

  private probeDownload(url: string, done: (mbps: number, status: string) => void) {
    if (this.useByteRange && this.expectedBytes > 0) {
      if (this.getWarmupConfig()) {
        this.probeDownloadWithWarmup(url, done)
        return
      }
      this.probeDownloadRange(url, 0, this.expectedBytes - 1, done)
      return
    }
    this.probeDownloadBulk(url, done)
  }

  private getWarmupConfig(): {
    warmupEnd: number
    measureStart: number
    measureEnd: number
    measureBytes: number
  } | null {
    if (!this.useWarmupWindow || !this.useByteRange || this.expectedBytes <= 0) {
      return null
    }

    const warmupEnd = Math.floor(this.warmupBytes) - 1
    if (warmupEnd < 0) {
      return null
    }

    const measureStart = warmupEnd + 1
    const measureEnd = Math.floor(this.expectedBytes) - 1
    const measureBytes = measureEnd - measureStart + 1
    const minMeasure = Math.max(1, Math.floor(this.minMeasureBytes))

    if (measureBytes < minMeasure || measureStart > measureEnd) {
      return null
    }

    return {
      warmupEnd,
      measureStart,
      measureEnd,
      measureBytes,
    }
  }

  private probeDownloadWithWarmup(
    url: string,
    done: (mbps: number, status: string) => void
  ) {
    const cfg = this.getWarmupConfig()
    if (!cfg) {
      this.probeDownloadRange(url, 0, this.expectedBytes - 1, done)
      return
    }

    this.fetchByteRange(url, 0, cfg.warmupEnd, (warmupBody, warmupErr, warmupHttp) => {
      const expectedWarmupLen = cfg.warmupEnd + 1
      if (!warmupBody || warmupBody.length !== expectedWarmupLen) {
        const reason =
          warmupErr ||
          (warmupBody ? `warmup size ${warmupBody.length}` : "warmup fail")
        if (this.rangeFallbackToBulk) {
          this.logRangeFallbackOnce(reason)
          this.probeDownloadBulk(url, done)
          return
        }
        done(-1, warmupErr || "warmup fail")
        return
      }

      if (this.logMeasurementDetail) {
        this.log(
          `warmup ok bytes=0-${cfg.warmupEnd} http=${warmupHttp} len=${warmupBody.length}`
        )
      }

      const t0 = getTime()
      this.fetchByteRange(
        url,
        cfg.measureStart,
        cfg.measureEnd,
        (measureBody, measureErr, measureHttp) => {
          if (!measureBody) {
            if (this.rangeFallbackToBulk) {
              this.logRangeFallbackOnce(measureErr)
              this.probeDownloadBulk(url, done)
              return
            }
            done(-1, measureErr)
            return
          }

          const elapsedSec = getTime() - t0
          const mbps = this.computeMbps(measureBody.length, elapsedSec)

          if (measureBody.length !== cfg.measureBytes) {
            if (this.rangeFallbackToBulk) {
              this.logRangeFallbackOnce(`measure size ${measureBody.length}`)
              this.probeDownloadBulk(url, done)
              return
            }
            done(mbps, `size ${measureBody.length}`)
            return
          }

          if (this.logMeasurementDetail) {
            this.log(
              `measure ok bytes=${cfg.measureStart}-${cfg.measureEnd} http=${measureHttp} len=${measureBody.length} ${mbps.toFixed(1)} Mbps (warmup ${expectedWarmupLen})`
            )
          }
          done(mbps, "ok")
        }
      )
    })
  }

  private probeDownloadRange(
    url: string,
    startByte: number,
    endByte: number,
    done: (mbps: number, status: string) => void
  ) {
    const expectedLen = endByte - startByte + 1
    if (expectedLen <= 0) {
      done(-1, "range invalid")
      return
    }

    const t0 = getTime()
    this.fetchByteRange(url, startByte, endByte, (bytes, errStatus, httpStatus) => {
      if (!bytes) {
        if (this.rangeFallbackToBulk) {
          this.logRangeFallbackOnce(errStatus)
          this.probeDownloadBulk(url, done)
          return
        }
        done(-1, errStatus)
        return
      }

      const elapsedSec = getTime() - t0
      const mbps = this.computeMbps(bytes.length, elapsedSec)

      if (bytes.length !== expectedLen) {
        if (this.rangeFallbackToBulk) {
          this.logRangeFallbackOnce(`size ${bytes.length}`)
          this.probeDownloadBulk(url, done)
          return
        }
        done(mbps, `size ${bytes.length}`)
        return
      }

      if (this.logMeasurementDetail) {
        this.log(
          `range ok bytes=${startByte}-${endByte} http=${httpStatus} len=${bytes.length} ${mbps.toFixed(1)} Mbps`
        )
      }
      done(mbps, "ok")
    })
  }

  private probeDownloadBulk(url: string, done: (mbps: number, status: string) => void) {
    const t0 = getTime()
    this.internetModule
      .fetch(url, {
        method: "GET",
        headers: { "Cache-Control": "no-cache" },
      })
      .then((response) => {
        if (!response.ok) {
          done(-1, `fail ${response.status}`)
          return
        }
        return response.bytes().then((bytes) => {
          const elapsedSec = getTime() - t0
          const mbps = this.computeMbps(bytes.length, elapsedSec)
          if (this.expectedBytes > 0 && bytes.length !== this.expectedBytes) {
            done(mbps, `size ${bytes.length}`)
            return
          }
          if (this.logMeasurementDetail) {
            this.log(
              `bulk ok http=${response.status} len=${bytes.length} ${mbps.toFixed(1)} Mbps`
            )
          }
          done(mbps, "ok")
        })
      })
      .catch(() => {
        done(-1, "error")
      })
  }

  private fetchByteRange(
    url: string,
    startByte: number,
    endByte: number,
    done: (bytes: Uint8Array | null, status: string, httpStatus: number) => void
  ) {
    const rangeHeader = `bytes=${Math.floor(startByte)}-${Math.floor(endByte)}`
    this.internetModule
      .fetch(url, {
        method: "GET",
        headers: {
          "Cache-Control": "no-cache",
          Range: rangeHeader,
        },
      })
      .then((response) => {
        const httpStatus = response.status
        if (!response.ok) {
          done(null, `fail ${httpStatus}`, httpStatus)
          return
        }
        return response.bytes().then((bytes) => {
          done(bytes, "ok", httpStatus)
        })
      })
      .catch(() => {
        done(null, "error", -1)
      })
  }

  private logRangeFallbackOnce(reason: string) {
    if (!this.loggedRangeFallback) {
      this.log(`Range unavailable (${reason}); using bulk GET`)
      this.loggedRangeFallback = true
    }
  }

  private computeMbps(byteCount: number, elapsedSec: number): number {
    if (elapsedSec <= 0 || byteCount <= 0) {
      return -1
    }
    return (byteCount * 8) / (elapsedSec * 1e6)
  }

  private cacheBust(url: string): string {
    const sep = url.indexOf("?") >= 0 ? "&" : "?"
    return `${url}${sep}_=${Date.now()}`
  }

  private logResult() {
    this.logDebug(`L:${this.formatLine()}`)
  }

  private logProbeSummary(scanDuration: number) {
    this.logDebug(
      `result=${this.formatLine()} raw=${this.lastStatus} duration=${scanDuration.toFixed(2)}s coverage=${this.lastCoverageRecordStatus}`
    )
  }

  private formatLine(): string {
    if (this.lastMbps >= 0) {
      return `${this.lastMbps.toFixed(1)} Mbps ${this.shortStatus(this.lastStatus)}`
    }
    return `-- ${this.shortStatus(this.lastStatus)}`
  }

  private shortStatus(status: string): string {
    if (status === "ok" || status.indexOf("ok ") === 0) {
      return "ok"
    }
    if (status === "moved") {
      return "fail"
    }
    if (status.indexOf("fail") === 0) {
      return "fail"
    }
    return status
  }

  private exceededMaxTravelDistance(travel: number): boolean {
    const maxTravel = this.getMaxTravelDistance()
    return maxTravel > 0 && travel > maxTravel
  }

  private horizontalDistance(startPos: vec3, endPos: vec3): number {
    const dx = endPos.x - startPos.x
    const dz = endPos.z - startPos.z
    return Math.sqrt(dx * dx + dz * dz)
  }

  private logMovementDiscard(travel: number) {
    this.warnDebug(
      `sample discarded: moved ${travel.toFixed(2)} > max ${this.getMaxTravelDistance().toFixed(2)}`
    )
  }

  private playFeedback(status: string) {
    const success = status === "ok" || status.indexOf("ok ") === 0
    if (success) {
      if (this.successAudio) {
        this.successAudio.play(1)
      }
      return
    }
    if (this.failAudio) {
      this.failAudio.play(1)
    }
  }

  private recordCoverageSample(
    mbps: number,
    status: string,
    startPos: vec3,
    endPos: vec3
  ) {
    if (mbps < 0) {
      this.setCoverageRecordStatus("skip bad mbps")
      return
    }
    if (status.indexOf("ok") !== 0) {
      this.setCoverageRecordStatus(`skip ${status}`)
      return
    }
    if (!this.coverageGrid) {
      this.resolveCoverageGrid()
    }
    if (!this.coverageGrid) {
      this.setCoverageRecordStatus("no grid")
      return
    }
    const worldPos = vec3.lerp(startPos, endPos, 0.5)
    const gridStatus = this.coverageGrid.recordSample(worldPos, mbps)
    this.setCoverageRecordStatus(gridStatus)
  }

  private getSampleWorldPosition(): vec3 {
    if (this.positionSource) {
      return this.positionSource.getTransform().getWorldPosition()
    }
    return this.getSceneObject().getTransform().getWorldPosition()
  }

  private pushScanDuration(durationSec: number) {
    this.recentScanDurations.push(durationSec)
    while (this.recentScanDurations.length > 3) {
      this.recentScanDurations.shift()
    }
  }

  private recordSessionOkRange(mbps: number) {
    if (mbps < 0) {
      return
    }
    if (mbps < this.sessionOkMinMbps) {
      this.sessionOkMinMbps = mbps
    }
    if (mbps > this.sessionOkMaxMbps) {
      this.sessionOkMaxMbps = mbps
    }
  }

  private resolveCoverageGrid() {
    if (this.coverageGrid) {
      return
    }

    const rootCount = global.scene.getRootObjectsCount()
    for (let i = 0; i < rootCount; i++) {
      const found = this.findCoverageGrid(global.scene.getRootObject(i))
      if (found) {
        this.coverageGrid = found
        this.setCoverageRecordStatus("grid auto-wired")
        return
      }
    }
  }

  private findCoverageGrid(obj: SceneObject): CoverageGridManager | null {
    const components = obj.getComponents("Component.ScriptComponent")
    for (let i = 0; i < components.length; i++) {
      const candidate = components[i] as any
      if (candidate && typeof candidate.recordSample === "function") {
        return candidate as CoverageGridManager
      }
    }

    const childCount = obj.getChildrenCount()
    for (let i = 0; i < childCount; i++) {
      const found = this.findCoverageGrid(obj.getChild(i))
      if (found) {
        return found
      }
    }
    return null
  }

  private setCoverageRecordStatus(status: string) {
    this.lastCoverageRecordStatus = status
    this.logDebug(`coverage ${status}`)
  }

  private log(msg: string) {
    this.logDebug(msg)
  }

  private logError(msg: string) {
    console.error(`[ConnectionProbe] ${msg}`)
  }

  private logDebug(msg: string) {
    if (this.debugLogs || this.logMeasurementDetail) {
      console.log(`[ConnectionProbe] ${msg}`)
    }
  }

  private warnDebug(msg: string) {
    if (this.debugLogs || this.logMeasurementDetail) {
      console.warn(`[ConnectionProbe] ${msg}`)
    }
  }
}
