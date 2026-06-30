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

function render() {
  if (!app) {
    return
  }

  mapScene?.dispose()
  mapScene = null

  app.innerHTML = `
    <main class="shell">
      <header class="site-header">
        <a class="brand" href="/" aria-label="Wi-Fi Speed home">
          <span class="brand-mark"></span>
          <span>Wi-Fi Speed</span>
        </a>
        <nav aria-label="Primary">
          <a href="https://github.com/vova-lantsberg/Wi-Fi-Speed">GitHub</a>
          <a href="https://github.com/vova-lantsberg/Wi-Fi-Speed#web-viewer">Docs</a>
        </nav>
      </header>
      <section class="topbar">
        <div>
          <span class="eyebrow">Spectacles coverage telemetry</span>
          <h1>Inspect indoor Wi-Fi coverage as a spatial signal map.</h1>
          <p>${state.map ? mapSubtitle(state.map) : "Enter the six digit PIN from Spectacles to load the published coverage snapshot."}</p>
        </div>
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
      <input
        name="pin"
        inputmode="numeric"
        pattern="[0-9]*"
        maxlength="6"
        placeholder="000000"
        aria-label="Map PIN"
        ${state.loading ? "disabled" : ""}
      />
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
      <div class="empty-visual" aria-hidden="true">
        <div class="scanline"></div>
        <div class="empty-grid">
          ${[20, 44, 68, 52, 82, 36, 96, 58, 72].map((height, i) => `
            <span style="--h:${height}px; --c:${palette[Math.min(i + 1, palette.length - 1)]}"></span>
          `).join("")}
        </div>
        <div class="terminal">
          <span>probe.download /speedtest/10mb.bin</span>
          <strong>session.max ${state.map ? formatMbps(state.map.snapshot.sessionMaxMbps) : "pending"}</strong>
        </div>
      </div>
    </section>
  `
}

function renderMapView(map: PublishedMap): string {
  const cells = map.snapshot.cells.slice().sort((a, b) => {
    if (a.z !== b.z) {
      return a.z - b.z
    }
    return a.x - b.x
  })
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
        ${renderSummary(map)}
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
        ${selected ? renderDetails(selected, map) : "<p>No cells recorded.</p>"}
      </aside>
    </section>
  `
}

function renderSummary(map: PublishedMap): string {
  const snapshot = map.snapshot
  return `
    <div class="summary">
      <span><strong>${snapshot.directCellCount}</strong> recorded points</span>
      <span><strong>${snapshot.cellCount}</strong> rendered cells</span>
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
  return `PIN ${map.pin} · ${map.snapshot.directCellCount} recorded points · expires ${formatDate(map.expiresAt)}`
}

function mountMapScene(map: PublishedMap): {dispose: () => void} | null {
  const viewport = document.querySelector<HTMLDivElement>("[data-map-viewport]")
  const canvas = document.querySelector<HTMLCanvasElement>("[data-map-canvas]")
  if (!viewport || !canvas) {
    return null
  }
  const viewportEl = viewport

  const cells = map.snapshot.cells.slice().sort((a, b) => {
    if (a.z !== b.z) {
      return a.z - b.z
    }
    return a.x - b.x
  })

  const renderer = new THREE.WebGLRenderer({canvas, antialias: true, alpha: true})
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x070b12)

  const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 1000)
  camera.position.set(90, 90, 90)
  camera.lookAt(0, 0, 0)

  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.enablePan = true
  controls.screenSpacePanning = true
  controls.minZoom = 0.4
  controls.maxZoom = 6
  controls.target.set(0, 0, 0)

  function resetView() {
    camera.position.set(90, 90, 90)
    camera.zoom = 1
    controls.target.set(0, 0, 0)
    controls.update()
    camera.updateProjectionMatrix()
  }

  function setZoom(multiplier: number) {
    camera.zoom = Math.max(controls.minZoom, Math.min(controls.maxZoom, camera.zoom * multiplier))
    camera.updateProjectionMatrix()
  }

  const bars: THREE.Mesh[] = []
  const materials = palette.map((color) => new THREE.MeshStandardMaterial({
    color,
    emissive: new THREE.Color(color).multiplyScalar(0.18),
    roughness: 0.48,
    metalness: 0.08,
  }))
  const inferredMaterial = new THREE.MeshStandardMaterial({
    color: 0x64748b,
    transparent: true,
    opacity: 0.32,
    roughness: 0.72,
  })
  const selectedMaterial = new THREE.MeshBasicMaterial({color: 0xffde7b, transparent: true, opacity: 0.28})

  scene.add(new THREE.HemisphereLight(0xffffff, 0x0f172a, 2.6))
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.2)
  keyLight.position.set(80, 110, 60)
  scene.add(keyLight)

  const bounds = map.snapshot.bounds
  const gridWidth = Math.max(24, bounds.maxX - bounds.minX + map.snapshot.gridSize)
  const gridDepth = Math.max(24, bounds.maxZ - bounds.minZ + map.snapshot.gridSize)
  const centerX = (bounds.minX + bounds.maxX) / 2
  const centerZ = (bounds.minZ + bounds.maxZ) / 2
  const grid = new THREE.GridHelper(Math.max(gridWidth, gridDepth) + 28, 20, 0x334155, 0x1e293b)
  grid.position.y = -0.02
  scene.add(grid)

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(gridWidth + 18, gridDepth + 18),
    new THREE.MeshBasicMaterial({color: 0x0f172a, transparent: true, opacity: 0.7, side: THREE.DoubleSide}),
  )
  floor.rotation.x = -Math.PI / 2
  floor.position.y = -0.04
  scene.add(floor)

  for (const cell of cells) {
    const height = 2 + (Math.max(0, Math.min(100, cell.sessionPct)) / 100) * 24
    const footprint = cell.hasOwnRecording ? 3.7 : 2.8
    const material = cell.hasOwnRecording ? materials[Math.max(0, Math.min(9, cell.bracketIndex))] : inferredMaterial
    const bar = new THREE.Mesh(new THREE.BoxGeometry(footprint, height, footprint), material)
    bar.position.set(cell.x - centerX, height / 2, cell.z - centerZ)
    bar.userData.cellKey = cell.key
    bar.userData.baseMaterial = material
    bars.push(bar)
    scene.add(bar)

    if (cell.key === state.selectedKey) {
      const marker = new THREE.Mesh(new THREE.BoxGeometry(footprint + 1.2, 0.32, footprint + 1.2), selectedMaterial)
      marker.position.set(bar.position.x, 0.18, bar.position.z)
      scene.add(marker)
    }
  }

  controls.target.set(0, 0, 0)
  const sceneSpan = Math.max(gridWidth, gridDepth, 28)

  function resize() {
    const rect = viewportEl.getBoundingClientRect()
    const width = Math.max(1, rect.width)
    const height = Math.max(1, rect.height)
    renderer.setSize(width, height, false)
    const aspect = width / height
    const frustum = Math.max(sceneSpan * 0.82, 42)
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
    const hit = raycaster.intersectObjects(bars, false)[0]
    const key = hit?.object.userData.cellKey
    if (typeof key === "string" && key !== state.selectedKey) {
      state.selectedKey = key
      render()
    }
  }

  renderer.domElement.addEventListener("pointerdown", handlePointerDown)
  renderer.domElement.addEventListener("pointerup", handlePointerUp)
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
