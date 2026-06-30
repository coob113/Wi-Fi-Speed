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
  statusKind: "idle" | "loading" | "invalid" | "not-found" | "expired" | "network"
  pinInput: string
}

const state: AppState = {
  map: null,
  selectedKey: "",
  loading: false,
  error: "",
  statusKind: "idle",
  pinInput: "",
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
      ${renderLookupStatus()}
      ${state.map ? renderMapView(state.map) : renderEmptyState()}
    </main>
  `

  bindEvents()

  if (state.map && buildRenderedCells(state.map).length > 0) {
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
          autocomplete="one-time-code"
          value="${escapeAttr(state.pinInput)}"
          ${state.loading ? "disabled" : ""}
        />
      </label>
      <button type="submit" ${state.loading ? "disabled" : ""}>
        ${state.loading ? "Loading" : "Open map"}
      </button>
    </form>
  `
}

function renderLookupStatus(): string {
  if (!state.loading && !state.error) {
    return ""
  }

  const statusClass = state.loading ? "notice notice-loading" : `notice notice-${state.statusKind}`
  const title = state.loading ? "Loading map" : statusTitleForKind(state.statusKind)
  const message = state.loading ? "Looking up the published coverage snapshot." : state.error
  return `
    <div class="${statusClass}" role="status" aria-live="polite">
      <strong>${escapeHtml(title)}</strong>
      <span>${escapeHtml(message)}</span>
    </div>
  `
}

function statusTitleForKind(kind: AppState["statusKind"]): string {
  switch (kind) {
    case "invalid":
      return "Check the PIN"
    case "not-found":
      return "Map not found"
    case "expired":
      return "Map expired"
    case "network":
      return "Connection failed"
    default:
      return "Could not load map"
  }
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
  const isEmpty = cells.length === 0
  const isLowData = !isEmpty && map.snapshot.directCellCount < 2
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
          <div>
            <span class="panel-label">Coverage field</span>
            <strong>${map.pin}</strong>
          </div>
          ${renderShareControl(map)}
        </div>
        ${renderSummary(map, cells.length)}
        ${renderPublishMetadata(map)}
        ${isEmpty ? renderNoMapDataState(map) : `
          ${isLowData ? renderLowDataNotice(map) : ""}
          <div class="map-viewport" data-map-viewport role="application" aria-label="Orthographic 3D Wi-Fi coverage model">
            <canvas data-map-canvas></canvas>
            <div class="viewport-controls">
              <button type="button" data-view-zoom-in aria-label="Zoom in">+</button>
              <button type="button" data-view-zoom-out aria-label="Zoom out">-</button>
              <button type="button" data-view-reset>Reset</button>
            </div>
          </div>
        `}
        ${renderLegend()}
      </div>
      <aside class="sidebar">
        <span class="panel-label">Selected cell</span>
        <div data-details>
          ${selected ? renderDetails(selected, map) : renderNoSelectionDetails(map)}
        </div>
      </aside>
    </section>
  `
}

function renderShareControl(map: PublishedMap): string {
  return `
    <div class="share-control">
      <button type="button" data-copy-link="${escapeAttr(map.pin)}">Copy link</button>
      <span data-copy-feedback aria-live="polite"></span>
    </div>
  `
}

function renderNoMapDataState(map: PublishedMap): string {
  return `
    <div class="map-empty-state">
      <span class="panel-label">No points yet</span>
      <h2>This map published before any scan points were recorded.</h2>
      <p>PIN ${escapeHtml(map.pin)} is valid, but the snapshot has no cells to draw yet. Scan a few positions in Spectacles and publish again.</p>
    </div>
  `
}

function renderLowDataNotice(map: PublishedMap): string {
  return `
    <div class="low-data-notice" role="status">
      <strong>Low scan coverage</strong>
      <span>${map.snapshot.directCellCount} recorded point${map.snapshot.directCellCount === 1 ? "" : "s"} so far. Add more scan positions for a more reliable field.</span>
    </div>
  `
}

function renderSummary(map: PublishedMap, renderedCellCount: number = map.snapshot.cellCount): string {
  const snapshot = map.snapshot
  return `
    <div class="summary">
      <span><strong>${snapshot.directCellCount}</strong> direct</span>
      <span><strong>${renderedCellCount}</strong> cells</span>
      <span><strong>${formatMbps(snapshot.sessionMaxMbps)}</strong> peak</span>
    </div>
  `
}

function renderPublishMetadata(map: PublishedMap): string {
  return `
    <dl class="publish-meta" aria-label="Publication details">
      <div>
        <dt>Published</dt>
        <dd>${formatDateTime(map.createdAt)}</dd>
      </div>
      <div>
        <dt>Captured</dt>
        <dd>${formatTimestampMs(map.snapshot.createdAtMs)}</dd>
      </div>
      <div>
        <dt>Expires</dt>
        <dd>${formatDateTime(map.expiresAt)}</dd>
      </div>
    </dl>
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
  const weakReasons = weakReasonsForCell(cell)
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
    ${weakReasons.length ? `
      <div class="weak-reason">
        <strong>Weak because</strong>
        <span>${escapeHtml(weakReasons.join(" and "))}</span>
      </div>
    ` : ""}
    <section class="detail-section">
      <h3>Scan summary</h3>
      <dl class="metrics">
        <div><dt>Speed</dt><dd>${formatMbps(cell.displayMbps)}</dd></div>
        <div><dt>Session</dt><dd>${cell.sessionPct.toFixed(0)}%</dd></div>
        <div><dt>Samples</dt><dd>${cell.sampleCount}</dd></div>
        <div><dt>Direct</dt><dd>${cell.directSampleCount}</dd></div>
      </dl>
    </section>
    <section class="detail-section">
      <h3>Speed samples</h3>
      <ul class="samples">${directSamples}</ul>
    </section>
    <section class="detail-section">
      <h3>Map position</h3>
      <dl class="metrics metrics-single">
        <div><dt>Position</dt><dd>${formatCellPosition(cell)}</dd></div>
        <div><dt>PIN</dt><dd>${map.pin}</dd></div>
        <div><dt>Published</dt><dd>${formatDateTime(map.createdAt)}</dd></div>
        <div><dt>Expires</dt><dd>${formatDateTime(map.expiresAt)}</dd></div>
      </dl>
    </section>
  `
}

function renderNoSelectionDetails(map: PublishedMap): string {
  return `
    <div class="sidebar-empty">
      <h2>No points recorded</h2>
      <p>PIN ${escapeHtml(map.pin)} loaded, but there are no cells to inspect yet.</p>
    </div>
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
  const pinForm = document.querySelector<HTMLFormElement>("[data-pin-form]")
  const pinInput = pinForm?.querySelector<HTMLInputElement>('input[name="pin"]')

  pinInput?.addEventListener("input", () => {
    const sanitized = sanitizePin(pinInput.value)
    if (pinInput.value !== sanitized) {
      pinInput.value = sanitized
    }
    state.pinInput = sanitized
    if (sanitized.length === 6 && !state.loading) {
      void loadMap(sanitized)
    }
  })

  pinInput?.addEventListener("paste", (event) => {
    event.preventDefault()
    const text = event.clipboardData?.getData("text") || ""
    const sanitized = sanitizePin(text)
    pinInput.value = sanitized
    state.pinInput = sanitized
    if (sanitized.length === 6 && !state.loading) {
      void loadMap(sanitized)
    }
  })

  pinForm?.addEventListener("submit", (event) => {
    event.preventDefault()
    const pin = sanitizePin(pinInput?.value || "")
    void loadMap(pin)
  })

  document.querySelector<HTMLButtonElement>("[data-copy-link]")?.addEventListener("click", (event) => {
    const button = event.currentTarget as HTMLButtonElement
    const pin = button.dataset.copyLink || state.map?.pin || ""
    void copyMapLink(pin)
  })
}

async function loadMap(pin: string) {
  state.pinInput = sanitizePin(pin)
  pin = state.pinInput
  if (!/^\d{6}$/.test(pin)) {
    state.statusKind = "invalid"
    state.error = pin.length === 0 ? "Enter a six digit PIN." : "PINs use exactly six digits."
    render()
    return
  }

  state.loading = true
  state.error = ""
  state.statusKind = "loading"
  render()

  try {
    const response = await fetch(`/api/maps/${pin}`)
    const data = (await response.json().catch(() => ({}))) as Partial<PublishedMap> & {error?: string}
    if (!response.ok) {
      state.statusKind = statusKindForResponse(response.status)
      state.error = messageForLookupFailure(response.status, data.error)
      state.map = null
      state.selectedKey = ""
    } else if (!isPublishedMap(data)) {
      state.statusKind = "network"
      state.error = "The map service returned an unexpected response."
      state.map = null
      state.selectedKey = ""
    } else {
      state.map = data
      state.selectedKey = ""
      state.statusKind = "idle"
      window.history.replaceState(null, "", `?pin=${pin}`)
    }
  } catch (_e) {
    state.statusKind = "network"
    state.error = "Check your connection and try the PIN again."
  } finally {
    state.loading = false
    render()
  }
}

function sanitizePin(value: string): string {
  return value.replace(/\D/g, "").slice(0, 6)
}

function statusKindForResponse(status: number): AppState["statusKind"] {
  if (status === 400) {
    return "invalid"
  }
  if (status === 404) {
    return "not-found"
  }
  if (status === 410) {
    return "expired"
  }
  return "network"
}

function messageForLookupFailure(status: number, fallback?: string): string {
  if (status === 400) {
    return "PINs use exactly six digits."
  }
  if (status === 404) {
    return "No published map exists for that PIN."
  }
  if (status === 410) {
    return "This published map has expired. Publish a fresh scan from Spectacles."
  }
  return fallback || "The map service did not return a usable response."
}

async function copyMapLink(pin: string) {
  const feedback = document.querySelector<HTMLSpanElement>("[data-copy-feedback]")
  const url = new URL(window.location.href)
  url.search = `?pin=${sanitizePin(pin)}`
  try {
    await copyText(url.toString())
    setCopyFeedback(feedback, "Copied")
  } catch (_e) {
    setCopyFeedback(feedback, "Copy failed")
  }
}

async function copyText(value: string): Promise<void> {
  if (copyTextWithTextarea(value)) {
    return
  }

  const clipboard = navigator.clipboard
  if (clipboard?.writeText) {
    await Promise.race([
      clipboard.writeText(value),
      new Promise<never>((_, reject) => {
        window.setTimeout(() => reject(new Error("Clipboard timed out")), 900)
      }),
    ])
    return
  }

  throw new Error("Copy command failed")
}

function copyTextWithTextarea(value: string): boolean {
  const textarea = document.createElement("textarea")
  textarea.value = value
  textarea.setAttribute("readonly", "")
  textarea.style.position = "fixed"
  textarea.style.left = "-9999px"
  document.body.appendChild(textarea)
  textarea.select()
  const copied = document.execCommand("copy")
  textarea.remove()
  return copied
}

function setCopyFeedback(feedback: HTMLSpanElement | null, text: string) {
  if (!feedback) {
    return
  }
  feedback.textContent = text
  window.setTimeout(() => {
    if (feedback.textContent === text) {
      feedback.textContent = ""
    }
  }, 1800)
}

function weakReasonsForCell(cell: CoverageCell): string[] {
  const reasons: string[] = []
  if (cell.displayMbps < 1) {
    reasons.push("under 1 Mbps")
  }
  if (cell.sessionPct <= 1) {
    reasons.push("bottom 1 percent of session range")
  }
  return reasons
}

function isPublishedMap(value: Partial<PublishedMap>): value is PublishedMap {
  return typeof value.pin === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.expiresAt === "string" &&
    typeof value.snapshot === "object" &&
    value.snapshot !== null &&
    Array.isArray(value.snapshot.cells)
}

function mapSubtitle(map: PublishedMap): string {
  return `${map.snapshot.directCellCount} recorded points · ${buildRenderedCells(map).length} rendered cells · expires ${formatDateTime(map.expiresAt)}`
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
  const selectedMaterial = new THREE.MeshBasicMaterial({
    color: 0xffde7b,
    transparent: true,
    opacity: 0.58,
    depthWrite: false,
  })
  const hoverMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.34,
    depthWrite: false,
  })
  const selectedColumnMaterial = new THREE.MeshBasicMaterial({
    color: 0xffde7b,
    transparent: true,
    opacity: 0.2,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const hoverColumnMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.12,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const baseMaterial = new THREE.MeshBasicMaterial({color: 0xcbd5e1, transparent: true, opacity: 0.34})
  const pickMaterial = new THREE.MeshBasicMaterial({color: 0xffffff, transparent: true, opacity: 0, depthWrite: false})
  const directGeometry = new THREE.CylinderGeometry(LENS_DIRECT_RADIUS, LENS_DIRECT_RADIUS, 1, 20)
  const inferredGeometry = new THREE.CylinderGeometry(LENS_NEIGHBOR_RADIUS, LENS_NEIGHBOR_RADIUS, 1, 16)
  const pickGeometry = new THREE.CylinderGeometry(2.4, 2.4, 1, 12)
  const baseGeometry = new THREE.SphereGeometry(1, 16, 10)
  const selectedGeometry = new THREE.TorusGeometry(2.75, 0.14, 10, 44)
  const hoverGeometry = new THREE.TorusGeometry(2.25, 0.1, 8, 36)
  const highlightColumnGeometry = new THREE.CylinderGeometry(1, 1, 1, 24)
  const barsByKey = new Map<string, THREE.Mesh>()
  const markerPositions = new Map<string, THREE.Vector3>()
  let hoveredKey = ""
  let selectedRing: THREE.Mesh | null = null
  let hoverRing: THREE.Mesh | null = null
  let selectedColumn: THREE.Mesh | null = null
  let hoverColumn: THREE.Mesh | null = null

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
    bar.userData.restScaleXZ = sceneScale
    bar.userData.highlightRadius = (cell.hasOwnRecording ? 2.95 : 2.15) * sceneScale
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

  function setColumnPosition(column: THREE.Mesh, key: string, heightMultiplier: number) {
    const bar = barsByKey.get(key)
    if (!bar) {
      column.visible = false
      return
    }
    const restScaleY = Number(bar.userData.restScaleY) || bar.scale.y
    const radius = Number(bar.userData.highlightRadius) || sceneScale
    column.position.copy(bar.position)
    column.scale.set(radius, restScaleY * heightMultiplier, radius)
    column.visible = true
  }

  function updateSelectedVisual() {
    if (!selectedRing) {
      selectedRing = new THREE.Mesh(selectedGeometry, selectedMaterial)
      selectedRing.rotation.x = Math.PI / 2
      selectedRing.scale.set(sceneScale, sceneScale, sceneScale)
      selectedRing.renderOrder = 3
      scene.add(selectedRing)
    }
    if (!selectedColumn) {
      selectedColumn = new THREE.Mesh(highlightColumnGeometry, selectedColumnMaterial)
      selectedColumn.renderOrder = 2
      scene.add(selectedColumn)
    }
    setRingPosition(selectedRing, state.selectedKey)
    setColumnPosition(selectedColumn, state.selectedKey, 1.18)

    barsByKey.forEach((bar, key) => {
      const restScaleY = Number(bar.userData.restScaleY) || bar.scale.y
      const restScaleXZ = Number(bar.userData.restScaleXZ) || sceneScale
      const isSelected = key === state.selectedKey
      const isHovered = key === hoveredKey
      bar.scale.y = restScaleY * (isSelected ? 1.22 : isHovered ? 1.12 : 1)
      const xzMultiplier = isSelected ? 1.18 : isHovered ? 1.1 : 1
      bar.scale.x = restScaleXZ * xzMultiplier
      bar.scale.z = restScaleXZ * xzMultiplier
    })
  }

  function updateHoverVisual(key: string) {
    hoveredKey = key
    viewportEl.classList.toggle("is-hovering-record", hoveredKey.length > 0)
    if (!hoverRing) {
      hoverRing = new THREE.Mesh(hoverGeometry, hoverMaterial)
      hoverRing.rotation.x = Math.PI / 2
      hoverRing.scale.set(sceneScale, sceneScale, sceneScale)
      hoverRing.renderOrder = 3
      scene.add(hoverRing)
    }
    if (!hoverColumn) {
      hoverColumn = new THREE.Mesh(highlightColumnGeometry, hoverColumnMaterial)
      hoverColumn.renderOrder = 2
      scene.add(hoverColumn)
    }
    if (hoveredKey.length === 0 || hoveredKey === state.selectedKey) {
      hoverRing.visible = false
      hoverColumn.visible = false
    } else {
      setRingPosition(hoverRing, hoveredKey)
      setColumnPosition(hoverColumn, hoveredKey, 1.08)
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

function formatDateTime(value: string): string {
  const date = new Date(value)
  return formatDateObject(date)
}

function formatTimestampMs(value: number): string {
  const date = new Date(value)
  return formatDateObject(date)
}

function formatDateObject(date: Date): string {
  if (!Number.isFinite(date.getTime())) {
    return "--"
  }
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
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
} else if (initialPin) {
  state.pinInput = sanitizePin(initialPin)
  state.statusKind = "invalid"
  state.error = "PINs use exactly six digits."
  render()
} else {
  render()
}
