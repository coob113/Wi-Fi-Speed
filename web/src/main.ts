import "./styles.css"
import * as THREE from "three"
import {OrbitControls} from "three/examples/jsm/controls/OrbitControls.js"
import type {CoverageCell, PublishedMap} from "./types"

const app = document.querySelector<HTMLDivElement>("#app")

type AppState = {
  map: PublishedMap | null
  selectedKey: string
  loading: boolean
  error: string
}

const state: AppState = {
  map: null,
  selectedKey: "",
  loading: false,
  error: "",
}

let mapScene: {dispose: () => void} | null = null

const palette = [
  "#ff7b7b",
  "#ffac7b",
  "#ffde7b",
  "#f8ff7b",
  "#c8ff7b",
  "#93ff7b",
  "#7bffa3",
  "#7bffe7",
  "#7bd1ff",
  "#7b96ff",
]

const LENS_GRID_DEFAULT = 20
const LENS_DIRECT_RADIUS = 1
const LENS_NEIGHBOR_RADIUS = 0.5
const LENS_SCALE_MULTIPLIER = 0.2
const LENS_Y_AT_MAX_MBPS = -10
const LENS_Y_AT_MIN_MBPS = -40
const LENS_HEIGHT_BAND = Math.abs(LENS_Y_AT_MIN_MBPS - LENS_Y_AT_MAX_MBPS)
const NEIGHBOR_SPREAD_RINGS = 2

function render() {
  if (!app) {
    return
  }

  mapScene?.dispose()
  mapScene = null

  app.innerHTML = `
    <main class="shell ${state.map ? "shell-loaded" : ""}">
      <header class="site-header">
        <a class="brand" href="/" aria-label="Wi-Fi Speed home">
          <img class="brand-mark" src="/icon.png" alt="" />
          <span>Wi-Fi Speed</span>
        </a>
        <nav aria-label="Primary">
          <a href="https://github.com/vova-lantsberg/Wi-Fi-Speed">GitHub</a>
        </nav>
      </header>
      <section class="topbar ${state.map ? "topbar-loaded" : ""}">
        ${state.map ? "" : `
          <div>
            <span class="eyebrow">Spectacles coverage telemetry</span>
            <h1>Inspect indoor Wi-Fi coverage in 3D.</h1>
            <p>Enter the six digit PIN from Spectacles to load the published coverage snapshot.</p>
          </div>
        `}
        ${renderPinForm()}
      </section>
      ${state.error ? `<div class="notice">${escapeHtml(state.error)}</div>` : ""}
      ${state.map ? renderMapView(state.map) : renderEmptyState()}
    </main>
  `

  bindEvents()

  if (state.map) {
    mapScene = mountMapScene(state.map)
  }
}

function renderPinForm(): string {
  return `
    <form class="pin-form" data-pin-form>
      <label>
        <span>Map PIN</span>
        <input
          name="pin"
          inputmode="numeric"
          pattern="[0-9]*"
          maxlength="6"
          placeholder="123456"
          aria-label="Map PIN"
          ${state.loading ? "disabled" : ""}
        />
      </label>
      <button type="submit" ${state.loading ? "disabled" : ""}>
        ${state.loading ? "Loading" : "Open map"}
      </button>
    </form>
  `
}

function renderEmptyState(): string {
  return `
    <section class="empty">
      <div class="empty-copy">
        <span class="panel-label">Awaiting map PIN</span>
        <h2>Coverage probes become a 3D grid you can inspect from the browser.</h2>
        <p>Each Spectacles run publishes download probe samples, inferred cells, peak throughput, and expiration metadata.</p>
      </div>
      <div class="empty-visual">
        <div class="video-card">
          <iframe
            src="https://www.youtube-nocookie.com/embed/72Gr3HF7yRA?rel=0&modestbranding=1"
            title="Wi-Fi Speed demo video"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowfullscreen
          ></iframe>
        </div>
      </div>
    </section>
  `
}

function renderMapView(map: PublishedMap): string {
  const cells = buildRenderedCells(map)
  const selected =
    cells.find((cell) => cell.key === state.selectedKey) ||
    cells.find((cell) => cell.hasOwnRecording) ||
    cells[0]
  if (selected && state.selectedKey !== selected.key) {
    state.selectedKey = selected.key
  }

  return `
    <section class="viewer">
      <div class="map-panel">
        <div class="panel-heading">
          <span class="panel-label">Coverage field</span>
          <strong>${map.pin}</strong>
        </div>
        ${renderSummary(map, cells.length)}
        <div class="map-viewport" data-map-viewport role="application" aria-label="Orthographic 3D Wi-Fi coverage model">
          <canvas data-map-canvas></canvas>
          <div class="viewport-controls">
            <button type="button" data-view-zoom-in aria-label="Zoom in">+</button>
            <button type="button" data-view-zoom-out aria-label="Zoom out">-</button>
            <button type="button" data-view-reset>Reset</button>
          </div>
        </div>
        ${renderLegend()}
      </div>
      <aside class="sidebar">
        <span class="panel-label">Selected cell</span>
        <div data-details>
          ${selected ? renderDetails(selected, map) : "<p>No cells recorded.</p>"}
        </div>
      </aside>
    </section>
  `
}

function renderSummary(map: PublishedMap, renderedCellCount: number = map.snapshot.cellCount): string {
  const snapshot = map.snapshot
  return `
    <div class="summary">
      <span><strong>${snapshot.directCellCount}</strong> direct</span>
      <span><strong>${renderedCellCount}</strong> cells</span>
      <span><strong>${formatMbps(snapshot.sessionMaxMbps)}</strong> peak</span>
      <span>Expires ${formatDate(map.expiresAt)}</span>
    </div>
  `
}

function renderLegend(): string {
  return `
    <div class="legend">
      <span>Poor</span>
      <div>${palette.map((color) => `<i style="background:${color}"></i>`).join("")}</div>
      <span>Strong</span>
    </div>
  `
}

function renderDetails(cell: CoverageCell, map: PublishedMap): string {
  const directSamples = cell.directSamples.length
    ? cell.directSamples.map((sample, index) => `
        <li><span>Test ${index + 1}</span><strong>${formatMbps(sample)}</strong></li>
      `).join("")
    : `<li><span>Direct tests</span><strong>None</strong></li>`

  return `
    <div class="detail-header">
      <span class="badge ${cell.hasOwnRecording ? "badge-direct" : "badge-inferred"}">
        ${cell.hasOwnRecording ? "Recorded" : "Inferred"}
      </span>
      <h2>${escapeHtml(cell.isDeadZone ? "No coverage" : cell.label)}</h2>
      <p>${formatCellPosition(cell)}</p>
    </div>
    <dl class="metrics">
      <div><dt>Speed</dt><dd>${formatMbps(cell.displayMbps)}</dd></div>
      <div><dt>Session</dt><dd>${cell.sessionPct.toFixed(0)}%</dd></div>
      <div><dt>Samples</dt><dd>${cell.sampleCount}</dd></div>
      <div><dt>Direct</dt><dd>${cell.directSampleCount}</dd></div>
      <div><dt>PIN</dt><dd>${map.pin}</dd></div>
      <div><dt>Created</dt><dd>${formatDate(map.createdAt)}</dd></div>
    </dl>
    <h3>Direct probe history</h3>
    <ul class="samples">${directSamples}</ul>
  `
}

function updateDetailsPanel(map: PublishedMap) {
  const details = document.querySelector<HTMLDivElement>("[data-details]")
  if (!details) {
    return
  }
  const selected = buildRenderedCells(map).find((cell) => cell.key === state.selectedKey)
  details.innerHTML = selected ? renderDetails(selected, map) : "<p>No cells recorded.</p>"
}

function bindEvents() {
  document.querySelector<HTMLFormElement>("[data-pin-form]")?.addEventListener("submit", (event) => {
    event.preventDefault()
    const form = event.currentTarget as HTMLFormElement
    const data = new FormData(form)
    const pin = String(data.get("pin") || "").replace(/\D/g, "").slice(0, 6)
    void loadMap(pin)
  })

}

async function loadMap(pin: string) {
  if (!/^\d{6}$/.test(pin)) {
    state.error = "Enter a six digit PIN."
    render()
    return
  }

  state.loading = true
  state.error = ""
  render()

  try {
    const response = await fetch(`/api/maps/${pin}`)
    const data = (await response.json()) as Partial<PublishedMap> & {error?: string}
    if (!response.ok) {
      state.error = data.error || "Map not found."
      state.map = null
      state.selectedKey = ""
    } else {
      state.map = data as PublishedMap
      state.selectedKey = ""
      window.history.replaceState(null, "", `?pin=${pin}`)
    }
  } catch (_e) {
    state.error = "Could not load this map."
  } finally {
    state.loading = false
    render()
  }
}

function mapSubtitle(map: PublishedMap): string {
  return `${map.snapshot.directCellCount} recorded points · ${buildRenderedCells(map).length} rendered cells · expires ${formatDate(map.expiresAt)}`
}

function buildRenderedCells(map: PublishedMap): CoverageCell[] {
  const gridSize = map.snapshot.gridSize > 0 ? map.snapshot.gridSize : LENS_GRID_DEFAULT
  const byKey = new Map<string, CoverageCell>()
  const inferred = new Map<string, CoverageCell & {weightSum?: number}>()

  for (const cell of map.snapshot.cells) {
    byKey.set(cell.key, {...cell})
  }

  for (const cell of map.snapshot.cells) {
    if (!cell.hasOwnRecording) {
      continue
    }
    for (let ring = 1; ring <= NEIGHBOR_SPREAD_RINGS; ring++) {
      const weight = Math.pow(0.5, ring - 1)
      for (let dx = -ring; dx <= ring; dx++) {
        for (let dz = -ring; dz <= ring; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) {
            continue
          }
          const x = cell.x + dx * gridSize
          const z = cell.z + dz * gridSize
          const key = `${x},${z}`
          if (byKey.has(key)) {
            continue
          }

          const existing = inferred.get(key)
          if (existing) {
            const total = (existing.weightSum || 0) + weight
            existing.displayMbps = (existing.displayMbps * (existing.weightSum || 0) + cell.displayMbps * weight) / total
            existing.sessionPct = (existing.sessionPct * (existing.weightSum || 0) + cell.sessionPct * weight) / total
            existing.weightSum = total
            existing.bracketIndex = bracketIndexForPercent(existing.sessionPct)
            existing.label = labelForBracket(existing.bracketIndex)
            continue
          }

          inferred.set(key, {
            key,
            x,
            z,
            displayMbps: cell.displayMbps,
            sessionPct: cell.sessionPct,
            bracketIndex: cell.bracketIndex,
            label: cell.label || labelForBracket(cell.bracketIndex),
            sampleCount: 1,
            directSampleCount: 0,
            hasOwnRecording: false,
            isDeadZone: false,
            directSamples: [],
            weightSum: weight,
          })
        }
      }
    }
  }

  for (const [key, cell] of inferred) {
    byKey.set(key, cell)
  }

  return Array.from(byKey.values()).sort((a, b) => {
    if (a.z !== b.z) {
      return a.z - b.z
    }
    return a.x - b.x
  })
}

function bracketIndexForPercent(pct: number): number {
  return Math.min(9, Math.max(0, Math.floor(Math.max(0, Math.min(100, pct)) / 10)))
}

function labelForBracket(index: number): string {
  return [
    "Terrible",
    "Very Poor",
    "Poor",
    "Weak",
    "Fair",
    "OK",
    "Good",
    "Great",
    "Excellent",
    "Perfect",
  ][Math.max(0, Math.min(9, index))] || "Inferred"
}

function mountMapScene(map: PublishedMap): {dispose: () => void} | null {
  const viewport = document.querySelector<HTMLDivElement>("[data-map-viewport]")
  const canvas = document.querySelector<HTMLCanvasElement>("[data-map-canvas]")
  if (!viewport || !canvas) {
    return null
  }
  const viewportEl = viewport

  const cells = buildRenderedCells(map)

  const renderer = new THREE.WebGLRenderer({canvas, antialias: true, alpha: true})
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x070b12)

  const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 1000)
  camera.position.set(28, 30, 34)
  camera.lookAt(0, 8, 0)

  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.enablePan = true
  controls.screenSpacePanning = true
  controls.minZoom = 0.4
  controls.maxZoom = 6
  controls.target.set(0, 8, 0)

  function resetView() {
    camera.position.set(28, 30, 34)
    camera.zoom = 1
    controls.target.set(0, 8, 0)
    controls.update()
    camera.updateProjectionMatrix()
  }

  function setZoom(multiplier: number) {
    camera.zoom = Math.max(controls.minZoom, Math.min(controls.maxZoom, camera.zoom * multiplier))
    camera.updateProjectionMatrix()
  }

  const bars: THREE.Mesh[] = []
  const pickTargets: THREE.Mesh[] = []
  const materials = palette.map((color) => new THREE.MeshStandardMaterial({
    color,
    emissive: new THREE.Color(color).multiplyScalar(0.18),
    roughness: 0.48,
    metalness: 0.08,
  }))
  const selectedMaterial = new THREE.MeshBasicMaterial({color: 0xffde7b, transparent: true, opacity: 0.28})
  const hoverMaterial = new THREE.MeshBasicMaterial({color: 0xffffff, transparent: true, opacity: 0.2})
  const baseMaterial = new THREE.MeshBasicMaterial({color: 0xcbd5e1, transparent: true, opacity: 0.34})
  const pickMaterial = new THREE.MeshBasicMaterial({color: 0xffffff, transparent: true, opacity: 0, depthWrite: false})
  const directGeometry = new THREE.CylinderGeometry(LENS_DIRECT_RADIUS, LENS_DIRECT_RADIUS, 1, 20)
  const inferredGeometry = new THREE.CylinderGeometry(LENS_NEIGHBOR_RADIUS, LENS_NEIGHBOR_RADIUS, 1, 16)
  const pickGeometry = new THREE.CylinderGeometry(2.4, 2.4, 1, 12)
  const baseGeometry = new THREE.SphereGeometry(1, 16, 10)
  const selectedGeometry = new THREE.TorusGeometry(2.25, 0.08, 8, 36)
  const hoverGeometry = new THREE.TorusGeometry(1.85, 0.06, 8, 32)
  const barsByKey = new Map<string, THREE.Mesh>()
  const markerPositions = new Map<string, THREE.Vector3>()
  let hoveredKey = ""
  let selectedRing: THREE.Mesh | null = null
  let hoverRing: THREE.Mesh | null = null

  scene.add(new THREE.HemisphereLight(0xffffff, 0x0f172a, 2.6))
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.2)
  keyLight.position.set(80, 110, 60)
  scene.add(keyLight)

  const bounds = map.snapshot.bounds
  const gridSize = map.snapshot.gridSize > 0 ? map.snapshot.gridSize : LENS_GRID_DEFAULT
  const gridWidth = Math.max(gridSize * 2, bounds.maxX - bounds.minX + gridSize)
  const gridDepth = Math.max(gridSize * 2, bounds.maxZ - bounds.minZ + gridSize)
  const centerX = (bounds.minX + bounds.maxX) / 2
  const centerZ = (bounds.minZ + bounds.maxZ) / 2
  const sceneScale = gridSize >= 15 ? 0.32 : 1
  const grid = new THREE.GridHelper((Math.max(gridWidth, gridDepth) + gridSize) * sceneScale, 16, 0x334155, 0x1e293b)
  grid.position.y = -0.05
  scene.add(grid)

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry((gridWidth + gridSize) * sceneScale, (gridDepth + gridSize) * sceneScale),
    new THREE.MeshBasicMaterial({color: 0x0f172a, transparent: true, opacity: 0.7, side: THREE.DoubleSide}),
  )
  floor.rotation.x = -Math.PI / 2
  floor.position.y = -0.08
  scene.add(floor)

  for (const cell of cells) {
    const pct = Math.max(0, Math.min(100, cell.sessionPct))
    const height = Math.max(0.18, pct * LENS_SCALE_MULTIPLIER) * sceneScale
    const yOffset = ((pct / 100) * LENS_HEIGHT_BAND) * sceneScale
    const radius = (cell.hasOwnRecording ? LENS_DIRECT_RADIUS : LENS_NEIGHBOR_RADIUS) * sceneScale
    const geometry = cell.hasOwnRecording ? directGeometry : inferredGeometry
    const material = cell.hasOwnRecording
      ? materials[Math.max(0, Math.min(9, cell.bracketIndex))]
      : new THREE.MeshStandardMaterial({
        color: palette[Math.max(0, Math.min(9, cell.bracketIndex))],
        emissive: new THREE.Color(palette[Math.max(0, Math.min(9, cell.bracketIndex))]).multiplyScalar(0.1),
        transparent: true,
        opacity: 0.5,
        roughness: 0.68,
        metalness: 0.02,
      })
    const bar = new THREE.Mesh(geometry, material)
    bar.scale.set(sceneScale, height, sceneScale)
    bar.position.set((cell.x - centerX) * sceneScale, yOffset + height / 2, (cell.z - centerZ) * sceneScale)
    bar.userData.cellKey = cell.key
    bar.userData.baseMaterial = material
    bar.userData.restScaleY = height
    bars.push(bar)
    barsByKey.set(cell.key, bar)
    scene.add(bar)

    const pickTarget = new THREE.Mesh(pickGeometry, pickMaterial)
    pickTarget.scale.set(sceneScale, Math.max(height, 4 * sceneScale), sceneScale)
    pickTarget.position.copy(bar.position)
    pickTarget.userData.cellKey = cell.key
    pickTargets.push(pickTarget)
    scene.add(pickTarget)

    const base = new THREE.Mesh(baseGeometry, baseMaterial)
    base.scale.set(radius * 1.35, radius * 1.35, radius * 1.35)
    base.position.set(bar.position.x, yOffset - radius * 0.55, bar.position.z)
    scene.add(base)

    markerPositions.set(cell.key, new THREE.Vector3(bar.position.x, yOffset + 0.1, bar.position.z))
  }

  controls.target.set(0, 8, 0)
  const sceneSpan = Math.max(gridWidth, gridDepth, gridSize * 2) * sceneScale

  function setRingPosition(ring: THREE.Mesh, key: string) {
    const position = markerPositions.get(key)
    if (!position) {
      ring.visible = false
      return
    }
    ring.position.copy(position)
    ring.visible = true
  }

  function updateSelectedVisual() {
    if (!selectedRing) {
      selectedRing = new THREE.Mesh(selectedGeometry, selectedMaterial)
      selectedRing.rotation.x = Math.PI / 2
      selectedRing.scale.set(sceneScale, sceneScale, sceneScale)
      scene.add(selectedRing)
    }
    setRingPosition(selectedRing, state.selectedKey)

    barsByKey.forEach((bar, key) => {
      const restScaleY = Number(bar.userData.restScaleY) || bar.scale.y
      const isSelected = key === state.selectedKey
      const isHovered = key === hoveredKey
      bar.scale.y = restScaleY * (isSelected ? 1.12 : isHovered ? 1.06 : 1)
    })
  }

  function updateHoverVisual(key: string) {
    hoveredKey = key
    viewportEl.classList.toggle("is-hovering-record", hoveredKey.length > 0)
    if (!hoverRing) {
      hoverRing = new THREE.Mesh(hoverGeometry, hoverMaterial)
      hoverRing.rotation.x = Math.PI / 2
      hoverRing.scale.set(sceneScale, sceneScale, sceneScale)
      scene.add(hoverRing)
    }
    if (hoveredKey.length === 0 || hoveredKey === state.selectedKey) {
      hoverRing.visible = false
    } else {
      setRingPosition(hoverRing, hoveredKey)
    }
    updateSelectedVisual()
  }

  function selectRecord(key: string) {
    if (key === state.selectedKey) {
      return
    }
    state.selectedKey = key
    updateDetailsPanel(map)
    updateSelectedVisual()
    updateHoverVisual(hoveredKey)
  }

  updateSelectedVisual()

  function resize() {
    const rect = viewportEl.getBoundingClientRect()
    const width = Math.max(1, rect.width)
    const height = Math.max(1, rect.height)
    renderer.setSize(width, height, false)
    const aspect = width / height
    const frustum = Math.max(sceneSpan * 0.78, 24)
    camera.left = (-frustum * aspect) / 2
    camera.right = (frustum * aspect) / 2
    camera.top = frustum / 2
    camera.bottom = -frustum / 2
    camera.updateProjectionMatrix()
  }

  const observer = new ResizeObserver(resize)
  observer.observe(viewportEl)
  resize()

  const raycaster = new THREE.Raycaster()
  const pointer = new THREE.Vector2()
  let pointerDownX = 0
  let pointerDownY = 0

  function setPointer(event: PointerEvent) {
    const rect = renderer.domElement.getBoundingClientRect()
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
  }

  function handlePointerDown(event: PointerEvent) {
    pointerDownX = event.clientX
    pointerDownY = event.clientY
  }

  function handlePointerUp(event: PointerEvent) {
    const moved = Math.hypot(event.clientX - pointerDownX, event.clientY - pointerDownY)
    if (moved > 5) {
      return
    }
    setPointer(event)
    raycaster.setFromCamera(pointer, camera)
    const hit = raycaster.intersectObjects(pickTargets, false)[0]
    const key = hit?.object.userData.cellKey
    if (typeof key === "string" && key !== state.selectedKey) {
      selectRecord(key)
    }
  }

  function handlePointerMove(event: PointerEvent) {
    setPointer(event)
    raycaster.setFromCamera(pointer, camera)
    const hit = raycaster.intersectObjects(pickTargets, false)[0]
    const key = typeof hit?.object.userData.cellKey === "string" ? hit.object.userData.cellKey : ""
    if (key !== hoveredKey) {
      updateHoverVisual(key)
    }
  }

  function handlePointerLeave() {
    updateHoverVisual("")
  }

  renderer.domElement.addEventListener("pointerdown", handlePointerDown)
  renderer.domElement.addEventListener("pointerup", handlePointerUp)
  renderer.domElement.addEventListener("pointermove", handlePointerMove)
  renderer.domElement.addEventListener("pointerleave", handlePointerLeave)
  const zoomInButton = viewportEl.querySelector<HTMLButtonElement>("[data-view-zoom-in]")
  const zoomOutButton = viewportEl.querySelector<HTMLButtonElement>("[data-view-zoom-out]")
  const resetButton = viewportEl.querySelector<HTMLButtonElement>("[data-view-reset]")
  zoomInButton?.addEventListener("click", () => setZoom(1.25))
  zoomOutButton?.addEventListener("click", () => setZoom(0.8))
  resetButton?.addEventListener("click", resetView)

  let animationFrame = 0
  function animate() {
    controls.update()
    renderer.render(scene, camera)
    animationFrame = window.requestAnimationFrame(animate)
  }
  animate()

  return {
    dispose() {
      window.cancelAnimationFrame(animationFrame)
      observer.disconnect()
      renderer.domElement.removeEventListener("pointerdown", handlePointerDown)
      renderer.domElement.removeEventListener("pointerup", handlePointerUp)
      renderer.domElement.removeEventListener("pointermove", handlePointerMove)
      renderer.domElement.removeEventListener("pointerleave", handlePointerLeave)
      controls.dispose()
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose()
          const material = object.material
          if (Array.isArray(material)) {
            material.forEach((item) => item.dispose())
          } else {
            material.dispose()
          }
        }
      })
      renderer.dispose()
    },
  }
}

function formatCellPosition(cell: CoverageCell): string {
  return `x ${cell.x.toFixed(0)} · z ${cell.z.toFixed(0)}`
}

function formatMbps(value: number): string {
  if (!Number.isFinite(value) || value < 0) {
    return "-- Mbps"
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} Mbps`
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) {
    return "--"
  }
  return date.toLocaleDateString(undefined, {month: "short", day: "numeric", year: "numeric"})
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }
    return entities[char] || char
  })
}

function escapeAttr(value: string): string {
  return escapeHtml(value)
}

const initialPin = new URLSearchParams(window.location.search).get("pin")
if (initialPin && /^\d{6}$/.test(initialPin)) {
  void loadMap(initialPin)
} else {
  render()
}
