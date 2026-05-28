import {RecordMarker} from "./RecordMarker"

type PendingSample = {
  mbps: number
  weight: number
  isDirect: boolean
}

type SpawnQueueEntry = {
  cellX: number
  cellZ: number
  samples: PendingSample[]
}

@component
export class CoverageGridManager extends BaseScriptComponent {
  @input
  @hint("Record prefab (root has RecordMarker + wired label Text)")
  recordPrefab: ObjectPrefab

  @input
  @hint("Parent for spawned record markers")
  recordsParent: SceneObject

  @input
  @hint("Camera or device tracking object — markers look at this")
  lookAtTarget: SceneObject

  @input
  @allowUndefined
  @hint("Camera for FOV culling; falls back to Camera on lookAtTarget")
  cullCamera: Camera

  @input
  @hint("World XZ grid cell size")
  gridSize: number = 10

  @input
  @hint("cm offset from user ref at best session % (fastest Mbps)")
  yAtMaxMbps: number = -10

  @input
  @hint("cm offset from user ref at worst session % (slowest Mbps)")
  yAtMinMbps: number = -40

  @input
  @hint("cm below user — bottom of height band (bars stay put while anchor is in band)")
  heightReferenceOffset: number = -30

  @input
  @hint("cm below user — top of height band (closest bars sit to user)")
  heightBandMaxOffset: number = -10

  @input
  @hint("How fast tracked height re-enters band when user Y moves (higher = faster)")
  heightBandCatchUpSmooth: number = 2

  @input
  @hint("Light filter on lookAtTarget Y (band edges only; bars use tracked anchor)")
  userHeightSmoothSec: number = 0.2

  @input
  @hint("Near-bar world-Y lerp speed (0 = snap; higher = faster catch-up)")
  barHeightMoveSmooth: number = 10

  @input
  @hint("Spread sample weight at ring 1 (full Mbps stored; weight falls off per ring)")
  neighborInfluence: number = 0.4

  @input
  @hint("How many grid rings beyond center receive spread samples (2 = center + 2 rings of neighbors)")
  neighborSpreadRings: number = 2

  @input
  @hint("Spread to diagonal neighbors as well as cardinals")
  neighborIncludeDiagonals: boolean = true

  @input
  @hint("Per-ring influence multiplier (ring 2 = neighborInfluence × this, ring 3 × this², …)")
  neighborRingFalloff: number = 0.5

  @input
  @hint("Weight for a direct probe at this cell (spread uses neighborInfluence × ring falloff)")
  directSampleWeight: number = 1

  @input
  @hint("Smoothing passes across grid cells (1 = light, 3+ = softer blends)")
  smoothPasses: number = 2

  @input
  @hint("Near tier distance (cm) — visual sync every frame when session range changes")
  perfNearDistance: number = 200

  @input
  @hint("Mid tier distance (cm) — visual sync every perfMidUpdateSec when session range changes")
  perfMidDistance: number = 400

  @input
  @hint("Mid-tier visual sync interval (seconds)")
  perfMidUpdateSec: number = 0.2

  @input
  @hint("Far-tier visual sync interval (seconds)")
  perfFarUpdateSec: number = 0.5

  @input
  @hint("Disable SIK Interactable beyond this distance (cm); also requires in FOV (live check)")
  interactableMaxDistance: number = 100

  @input
  @hint("Max distance (cm) before marker SceneObject is disabled")
  cullMaxDistance: number = 800

  @input
  @hint("When off, markers stay enabled by distance only (FOV ignored for visibility)")
  enableFovVisualCull: boolean = true

  @input
  @hint("Sphere radius (cm) for Camera.isSphereVisible FOV test — ~grid cell size")
  cullSphereRadius: number = 16

  @input
  @hint("FOV re-check interval (sec) for near bars (< perfNearDistance); 0 = every frame")
  cullFovCheckNearSec: number = 0

  @input
  @hint("FOV re-check interval (sec) for mid-distance bars")
  cullFovCheckMidSec: number = 0.15

  @input
  @hint("FOV re-check interval (sec) for far bars (>= perfMidDistance)")
  cullFovCheckFarSec: number = 0.33

  private markers = new Map<string, RecordMarker>()
  private globalMinMbps = Number.POSITIVE_INFINITY
  private globalMaxMbps = Number.NEGATIVE_INFINITY
  private lastSmoothedMedians = new Map<string, number>()
  private dirtyKeys = new Set<string>()
  private pendingGlobalSyncKeys = new Set<string>()
  private markerLastVisualSyncSec = new Map<string, number>()
  private markerWasCulled = new Map<string, boolean>()
  private markerLastFovCheckSec = new Map<string, number>()
  private markerCachedInFov = new Map<string, boolean>()
  private spawnQueue: SpawnQueueEntry[] = []
  private resolvedCullCamera: Camera | null = null
  private smoothedUserY = 0
  private userYInitialized = false
  private trackedReferenceY = 0
  private trackedReferenceInitialized = false
  private lastFrameTimeSec = 0

  onAwake() {
    this.createEvent("UpdateEvent").bind(() => this.onUpdate())
  }

  public getLookAtTarget(): SceneObject | null {
    return this.lookAtTarget || null
  }

  public getSessionMinMax(): {min: number; max: number} {
    return {
      min: this.globalMinMbps,
      max: this.globalMaxMbps,
    }
  }

  public getSmoothedMedians(): Map<string, number> {
    return new Map(this.lastSmoothedMedians)
  }

  public getSmoothedMedianForCell(cellX: number, cellZ: number): number {
    return this.lastSmoothedMedians.get(this.cellKey(cellX, cellZ)) ?? -1
  }

  public getGridSize(): number {
    return this.gridSize > 0 ? this.gridSize : 10
  }

  public getMarkerCount(): number {
    return this.markers.size
  }

  public getSampleCountAtWorldPos(worldPos: vec3): number {
    const cellX = this.snapAxis(worldPos.x)
    const cellZ = this.snapAxis(worldPos.z)
    const marker = this.markers.get(this.cellKey(cellX, cellZ))
    if (!marker) {
      return 0
    }
    return marker.getSampleCount()
  }

  public getBestClusterCentroid(fromPos: vec3, minFractionOfMax: number): vec3 | null {
    if (!isFinite(this.globalMaxMbps) || this.globalMaxMbps <= 0) {
      return null
    }

    const threshold = this.globalMaxMbps * Math.max(0, Math.min(1, minFractionOfMax))
    const qualifying: vec3[] = []

    this.markers.forEach((marker, key) => {
      if (!marker.getHasOwnRecording()) {
        return
      }
      const cellMedian = this.lastSmoothedMedians.get(key) ?? marker.getMedian()
      if (cellMedian < 0 || cellMedian < threshold) {
        return
      }
      qualifying.push(new vec3(marker.getCellX(), fromPos.y, marker.getCellZ()))
    })

    if (qualifying.length < 2) {
      return null
    }

    let sumX = 0
    let sumZ = 0
    for (let i = 0; i < qualifying.length; i++) {
      sumX += qualifying[i].x
      sumZ += qualifying[i].z
    }

    return new vec3(sumX / qualifying.length, fromPos.y, sumZ / qualifying.length)
  }

  public recordSample(worldPos: vec3, mbps: number) {
    if (mbps < 0 || !this.recordPrefab || !this.recordsParent) {
      return
    }

    const cellX = this.snapAxis(worldPos.x)
    const cellZ = this.snapAxis(worldPos.z)
    const size = this.gridSize > 0 ? this.gridSize : 10

    this.addSampleToCell(cellX, cellZ, mbps, this.getDirectSampleWeight(), true)
    this.spreadNeighborSamples(cellX, cellZ, mbps, size)
    this.refreshAfterDataChange()
  }

  public onMarkerUpdated(_marker: RecordMarker) {
    this.refreshAfterDataChange()
  }

  private onUpdate() {
    const nowSec = getTime()
    const dtSec =
      this.lastFrameTimeSec > 0 ? Math.max(0, nowSec - this.lastFrameTimeSec) : 0
    this.lastFrameTimeSec = nowSec

    this.updateSmoothedUserY(dtSec)
    this.updateTrackedHeightReference(dtSec)
    this.processSpawnQueueOnePerFrame()
    this.updateMarkerWorldHeights(dtSec)
    this.updateCullingAndInteractables(nowSec)
    this.processTieredVisualSync(nowSec)
  }

  private updateSmoothedUserY(dtSec: number) {
    const userY = this.getUserWorldPosition().y
    if (!this.userYInitialized) {
      this.smoothedUserY = userY
      this.userYInitialized = true
      return
    }

    if (dtSec <= 0) {
      return
    }

    const smoothSec = Math.max(0.01, this.userHeightSmoothSec)
    const alpha = 1 - Math.exp(-dtSec / smoothSec)
    this.smoothedUserY += (userY - this.smoothedUserY) * alpha
  }

  private updateTrackedHeightReference(dtSec: number) {
    const bandMin = this.getHeightBandMinY()
    const bandMax = this.getHeightBandMaxY()

    if (!this.trackedReferenceInitialized) {
      this.trackedReferenceY = bandMin
      this.trackedReferenceInitialized = true
      return
    }

    if (dtSec <= 0) {
      return
    }

    if (this.trackedReferenceY >= bandMin && this.trackedReferenceY <= bandMax) {
      return
    }

    let target = this.trackedReferenceY
    if (this.trackedReferenceY < bandMin) {
      target = bandMin
    } else if (this.trackedReferenceY > bandMax) {
      target = bandMax
    }

    const smooth = Math.max(0.01, this.heightBandCatchUpSmooth)
    const alpha = 1 - Math.exp(-smooth * dtSec)
    this.trackedReferenceY += (target - this.trackedReferenceY) * alpha
  }

  private getHeightBandMinY(): number {
    return this.getUserWorldPosition().y + this.heightReferenceOffset
  }

  private getHeightBandMaxY(): number {
    const topOffset = Math.max(this.heightReferenceOffset, this.heightBandMaxOffset)
    return this.getUserWorldPosition().y + topOffset
  }

  private getHeightReferenceY(): number {
    return this.trackedReferenceY
  }

  private updateMarkerWorldHeights(dtSec: number) {
    const userPos = this.getUserWorldPosition()
    const nearDist = Math.max(0, this.perfNearDistance)
    const moveSmooth = this.barHeightMoveSmooth
    const defaultY = this.getHeightReferenceY() + this.yAtMaxMbps

    this.markers.forEach((marker, key) => {
      if (!marker.getSceneObject().enabled) {
        return
      }

      const median = this.lastSmoothedMedians.get(key)
      const targetY = median !== undefined ? this.medianToWorldY(median) : defaultY
      const dist = this.xzDistance(userPos, marker.getMarkerWorldPosition())
      const lerpSpeed = moveSmooth > 0 && dist < nearDist ? moveSmooth : 0
      marker.stepWorldY(targetY, dtSec, lerpSpeed)
    })
  }

  private spreadNeighborSamples(originX: number, originZ: number, mbps: number, size: number) {
    const baseInfluence = Math.max(0, Math.min(1, this.neighborInfluence))
    const falloff = Math.max(0, Math.min(1, this.neighborRingFalloff))
    const maxRing = Math.max(0, Math.round(this.neighborSpreadRings))

    for (let ring = 1; ring <= maxRing; ring++) {
      const weight = baseInfluence * Math.pow(falloff, ring - 1)
      if (weight <= 0) {
        continue
      }

      const cells = this.collectRingCells(originX, originZ, size, ring, this.neighborIncludeDiagonals)
      for (let i = 0; i < cells.length; i++) {
        this.addSampleToCell(cells[i][0], cells[i][1], mbps, weight, false)
      }
    }
  }

  private collectRingCells(
    originX: number,
    originZ: number,
    size: number,
    ring: number,
    includeDiagonals: boolean
  ): number[][] {
    const cells: number[][] = []
    if (ring <= 0) {
      return cells
    }

    for (let dx = -ring; dx <= ring; dx++) {
      for (let dz = -ring; dz <= ring; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) {
          continue
        }
        if (!includeDiagonals && dx !== 0 && dz !== 0) {
          continue
        }
        cells.push([originX + dx * size, originZ + dz * size])
      }
    }

    return cells
  }

  private addSampleToCell(
    cellX: number,
    cellZ: number,
    mbps: number,
    weight: number,
    isDirect: boolean
  ) {
    const key = this.cellKey(cellX, cellZ)
    this.dirtyKeys.add(key)

    const marker = this.markers.get(key)
    if (marker) {
      marker.addSample(mbps, weight, false, isDirect)
      return
    }

    this.enqueueSpawnSample(cellX, cellZ, mbps, weight, isDirect)
  }

  private enqueueSpawnSample(
    cellX: number,
    cellZ: number,
    mbps: number,
    weight: number,
    isDirect: boolean
  ) {
    for (let i = 0; i < this.spawnQueue.length; i++) {
      const entry = this.spawnQueue[i]
      if (entry.cellX === cellX && entry.cellZ === cellZ) {
        entry.samples.push({mbps, weight, isDirect})
        return
      }
    }

    this.spawnQueue.push({
      cellX,
      cellZ,
      samples: [{mbps, weight, isDirect}],
    })
  }

  private processSpawnQueueOnePerFrame() {
    if (this.spawnQueue.length === 0) {
      return
    }

    const entry = this.spawnQueue.shift()
    if (!entry) {
      return
    }

    const key = this.cellKey(entry.cellX, entry.cellZ)
    if (this.markers.has(key)) {
      const existing = this.markers.get(key)
      if (existing) {
        for (let i = 0; i < entry.samples.length; i++) {
          const sample = entry.samples[i]
          existing.addSample(sample.mbps, sample.weight, false, sample.isDirect)
        }
      }
      this.refreshAfterDataChange()
      return
    }

    const marker = this.spawnMarker(entry.cellX, entry.cellZ)
    if (!marker) {
      return
    }

    this.markers.set(key, marker)
    for (let i = 0; i < entry.samples.length; i++) {
      const sample = entry.samples[i]
      marker.addSample(sample.mbps, sample.weight, false, sample.isDirect)
    }

    this.dirtyKeys.add(key)
    this.refreshAfterDataChange()
  }

  private refreshAfterDataChange() {
    const prevMin = this.globalMinMbps
    const prevMax = this.globalMaxMbps

    const rawMedians = this.buildRawMedianMap()
    const smoothedMedians = this.buildSmoothedMedianMap(rawMedians)
    this.lastSmoothedMedians = smoothedMedians
    this.recomputeGlobalRange(smoothedMedians)

    const globalRangeChanged =
      this.globalMinMbps !== prevMin ||
      this.globalMaxMbps !== prevMax ||
      !isFinite(prevMin) ||
      !isFinite(prevMax)

    const probeDirtyKeys = new Set<string>()
    this.dirtyKeys.forEach((key) => probeDirtyKeys.add(key))

    probeDirtyKeys.forEach((key) => {
      this.syncMarkerVisual(key)
      this.pendingGlobalSyncKeys.delete(key)
    })

    if (globalRangeChanged) {
      this.markers.forEach((_marker, key) => {
        if (!probeDirtyKeys.has(key)) {
          this.pendingGlobalSyncKeys.add(key)
        }
      })
    } else {
      this.pendingGlobalSyncKeys.clear()
    }

    this.dirtyKeys.clear()
  }

  private processTieredVisualSync(nowSec: number) {
    if (this.pendingGlobalSyncKeys.size === 0) {
      return
    }

    const userPos = this.getUserWorldPosition()
    const nearDist = Math.max(0, this.perfNearDistance)
    const midDist = Math.max(nearDist, this.perfMidDistance)
    const midInterval = Math.max(0, this.perfMidUpdateSec)
    const farInterval = Math.max(0, this.perfFarUpdateSec)

    const readyKeys: string[] = []
    this.pendingGlobalSyncKeys.forEach((key) => {
      const marker = this.markers.get(key)
      if (!marker || !marker.getSceneObject().enabled) {
        return
      }

      const dist = this.xzDistance(userPos, marker.getMarkerWorldPosition())
      let interval = farInterval
      if (dist < nearDist) {
        interval = 0
      } else if (dist < midDist) {
        interval = midInterval
      }

      const lastSync = this.markerLastVisualSyncSec.get(key) ?? 0
      if (nowSec - lastSync >= interval) {
        readyKeys.push(key)
      }
    })

    for (let i = 0; i < readyKeys.length; i++) {
      const key = readyKeys[i]
      this.syncMarkerVisual(key)
      this.pendingGlobalSyncKeys.delete(key)
    }
  }

  private updateCullingAndInteractables(nowSec: number) {
    const userPos = this.getUserWorldPosition()
    const camera = this.getCullCamera()
    const maxDist = Math.max(0, this.cullMaxDistance)
    const interactableDist = Math.max(0, this.interactableMaxDistance)
    const sphereRadius = Math.max(0.1, this.cullSphereRadius)
    const nearDist = Math.max(0, this.perfNearDistance)
    const midDist = Math.max(nearDist, this.perfMidDistance)

    this.markers.forEach((marker, key) => {
      if (marker.getIsDetailVisible()) {
        marker.setMarkerSceneEnabled(true)
        marker.setInteractableEnabled(true)
        this.markerWasCulled.set(key, false)
        return
      }

      const markerPos = marker.getMarkerWorldPosition()
      const dist = this.xzDistance(userPos, markerPos)
      const inRange = dist <= maxDist
      let inFovForVisual = true

      if (this.enableFovVisualCull) {
        if (inRange && camera) {
          inFovForVisual = this.queryMarkerInFov(
            key,
            markerPos,
            camera,
            sphereRadius,
            dist,
            nowSec,
            nearDist,
            midDist
          )
        } else if (!camera) {
          inFovForVisual = true
        } else {
          inFovForVisual = false
        }
      }

      const isVisible = inRange && inFovForVisual
      const wasCulled = this.markerWasCulled.get(key) ?? false

      marker.setMarkerSceneEnabled(isVisible)

      const interactableOn =
        inRange &&
        dist <= interactableDist &&
        this.queryMarkerInFovForInteractable(markerPos, camera, sphereRadius)
      marker.setInteractableEnabled(interactableOn)

      if (isVisible && wasCulled) {
        this.syncMarkerVisual(key)
        this.pendingGlobalSyncKeys.delete(key)
      }

      this.markerWasCulled.set(key, !isVisible)
    })
  }

  private queryMarkerInFov(
    key: string,
    markerPos: vec3,
    camera: Camera,
    sphereRadius: number,
    dist: number,
    nowSec: number,
    nearDist: number,
    midDist: number
  ): boolean {
    let interval = Math.max(0, this.cullFovCheckFarSec)
    if (dist < nearDist) {
      interval = Math.max(0, this.cullFovCheckNearSec)
    } else if (dist < midDist) {
      interval = Math.max(0, this.cullFovCheckMidSec)
    }

    const lastCheck = this.markerLastFovCheckSec.get(key) ?? -1
    const cached = this.markerCachedInFov.get(key)
    if (cached !== undefined && nowSec - lastCheck < interval) {
      return cached
    }

    const inFov = camera.isSphereVisible(markerPos, sphereRadius)
    this.markerCachedInFov.set(key, inFov)
    this.markerLastFovCheckSec.set(key, nowSec)
    return inFov
  }

  /** Pinch range: live FOV every frame (same sphere as cull); no stale cache. */
  private queryMarkerInFovForInteractable(
    markerPos: vec3,
    camera: Camera | null,
    sphereRadius: number
  ): boolean {
    if (!camera) {
      return true
    }
    return camera.isSphereVisible(markerPos, sphereRadius)
  }

  private syncMarkerVisual(key: string) {
    const marker = this.markers.get(key)
    const smoothed = this.lastSmoothedMedians.get(key)
    if (!marker || smoothed === undefined) {
      return
    }

    const targetY = this.medianToWorldY(smoothed)
    marker.setTargetWorldY(targetY)
    marker.snapWorldY(targetY)
    marker.updateVisuals(smoothed, this.globalMinMbps, this.globalMaxMbps)
    this.markerLastVisualSyncSec.set(key, getTime())
  }

  private getDirectSampleWeight(): number {
    return Math.max(0, this.directSampleWeight)
  }

  private getUserWorldPosition(): vec3 {
    if (!this.lookAtTarget) {
      return vec3.zero()
    }
    return this.lookAtTarget.getTransform().getWorldPosition()
  }

  private xzDistance(a: vec3, b: vec3): number {
    const dx = a.x - b.x
    const dz = a.z - b.z
    return Math.sqrt(dx * dx + dz * dz)
  }

  private getCullCamera(): Camera | null {
    if (this.cullCamera) {
      return this.cullCamera
    }

    if (this.resolvedCullCamera) {
      return this.resolvedCullCamera
    }

    if (!this.lookAtTarget) {
      return null
    }

    const camera = this.lookAtTarget.getComponent("Component.Camera") as Camera
    if (camera) {
      this.resolvedCullCamera = camera
    }
    return this.resolvedCullCamera
  }

  private spawnMarker(cellX: number, cellZ: number): RecordMarker | null {
    const obj = this.recordPrefab.instantiate(this.recordsParent)
    const marker = this.findRecordMarker(obj)
    if (!marker) {
      print("[CoverageGrid] Record prefab missing RecordMarker script")
      obj.destroy()
      return null
    }
    marker.setup(this, cellX, cellZ)
    const initialY = this.getHeightReferenceY() + this.yAtMaxMbps
    marker.snapWorldY(initialY)
    return marker
  }

  private findRecordMarker(obj: SceneObject): RecordMarker | null {
    const components = obj.getComponents("Component.ScriptComponent")
    for (let i = 0; i < components.length; i++) {
      const comp = components[i] as RecordMarker
      if (comp && typeof (comp as RecordMarker).addSample === "function") {
        return comp as RecordMarker
      }
    }
    return null
  }

  private snapAxis(value: number): number {
    const size = this.gridSize > 0 ? this.gridSize : 10
    return Math.round(value / size) * size
  }

  private cellKey(cellX: number, cellZ: number): string {
    return `${cellX},${cellZ}`
  }

  private buildRawMedianMap(): Map<string, number> {
    const raw = new Map<string, number>()
    this.markers.forEach((marker, key) => {
      const median = marker.getMedian()
      if (median >= 0) {
        raw.set(key, median)
      }
    })
    return raw
  }

  private buildSmoothedMedianMap(rawMedians: Map<string, number>): Map<string, number> {
    let current = rawMedians
    const passes = Math.max(1, Math.round(this.smoothPasses))

    for (let pass = 0; pass < passes; pass++) {
      current = this.smoothMedianPass(current)
    }

    return current
  }

  private smoothMedianPass(source: Map<string, number>): Map<string, number> {
    const smoothed = new Map<string, number>()
    const size = this.gridSize > 0 ? this.gridSize : 10

    source.forEach((selfMedian, key) => {
      const parts = key.split(",")
      const cellX = parseFloat(parts[0])
      const cellZ = parseFloat(parts[1])

      let sum = selfMedian * 4
      let weight = 4

      const cardinals = [
        [cellX + size, cellZ],
        [cellX - size, cellZ],
        [cellX, cellZ + size],
        [cellX, cellZ - size],
      ]
      const diagonals = [
        [cellX + size, cellZ + size],
        [cellX + size, cellZ - size],
        [cellX - size, cellZ + size],
        [cellX - size, cellZ - size],
      ]

      for (let i = 0; i < cardinals.length; i++) {
        const neighborMedian = source.get(this.cellKey(cardinals[i][0], cardinals[i][1]))
        if (neighborMedian !== undefined) {
          sum += neighborMedian * 2
          weight += 2
        }
      }

      for (let i = 0; i < diagonals.length; i++) {
        const neighborMedian = source.get(this.cellKey(diagonals[i][0], diagonals[i][1]))
        if (neighborMedian !== undefined) {
          sum += neighborMedian
          weight += 1
        }
      }

      smoothed.set(key, sum / weight)
    })

    return smoothed
  }

  private recomputeGlobalRange(smoothedMedians: Map<string, number>) {
    this.globalMinMbps = Number.POSITIVE_INFINITY
    this.globalMaxMbps = Number.NEGATIVE_INFINITY

    smoothedMedians.forEach((median) => {
      if (median < this.globalMinMbps) {
        this.globalMinMbps = median
      }
      if (median > this.globalMaxMbps) {
        this.globalMaxMbps = median
      }
    })
  }

  private medianToWorldY(median: number): number {
    const refY = this.getHeightReferenceY()
    if (
      !isFinite(this.globalMinMbps) ||
      !isFinite(this.globalMaxMbps) ||
      this.globalMaxMbps <= this.globalMinMbps
    ) {
      return refY + this.yAtMaxMbps
    }
    const t = (this.globalMaxMbps - median) / (this.globalMaxMbps - this.globalMinMbps)
    return refY + this.yAtMaxMbps + t * (this.yAtMinMbps - this.yAtMaxMbps)
  }
}
