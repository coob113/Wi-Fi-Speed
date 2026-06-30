import "./styles.css"
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

const palette = [
  "#f04438",
  "#f97066",
  "#fb923c",
  "#facc15",
  "#a3e635",
  "#4ade80",
  "#22c55e",
  "#14b8a6",
  "#38bdf8",
  "#2563eb",
]

function render() {
  if (!app) {
    return
  }

  app.innerHTML = `
    <main class="shell">
      <section class="topbar">
        <div>
          <h1>Wi-Fi Speed Map</h1>
          <p>${state.map ? mapSubtitle(state.map) : "Enter a six digit PIN from Spectacles."}</p>
        </div>
        ${renderPinForm()}
      </section>
      ${state.error ? `<div class="notice">${escapeHtml(state.error)}</div>` : ""}
      ${state.map ? renderMapView(state.map) : renderEmptyState()}
    </main>
  `

  bindEvents()
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
        ${state.loading ? "Loading" : "Open"}
      </button>
    </form>
  `
}

function renderEmptyState(): string {
  return `
    <section class="empty">
      <div class="empty-grid" aria-hidden="true">
        ${[20, 44, 68, 52, 82, 36].map((height, i) => `
          <span style="--h:${height}px; --c:${palette[i + 2]}"></span>
        `).join("")}
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
        ${renderSummary(map)}
        <svg class="map-svg" viewBox="0 0 920 620" role="img" aria-label="Axonometric Wi-Fi coverage map">
          ${renderGridBase(cells)}
          ${cells.map((cell) => renderCell(cell, selected?.key === cell.key)).join("")}
        </svg>
        ${renderLegend()}
      </div>
      <aside class="sidebar">
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

function renderGridBase(cells: CoverageCell[]): string {
  if (cells.length === 0) {
    return ""
  }
  const points = cells.map((cell) => project(cell.x, cell.z, 0))
  const minX = Math.min(...points.map((point) => point.x)) - 38
  const maxX = Math.max(...points.map((point) => point.x)) + 38
  const minY = Math.min(...points.map((point) => point.y)) - 24
  const maxY = Math.max(...points.map((point) => point.y)) + 24
  return `<rect class="map-base" x="${minX}" y="${minY}" width="${maxX - minX}" height="${maxY - minY}" rx="6" />`
}

function renderCell(cell: CoverageCell, selected: boolean): string {
  const height = 18 + (Math.max(0, Math.min(100, cell.sessionPct)) / 100) * 150
  const p = project(cell.x, cell.z, height)
  const base = project(cell.x, cell.z, 0)
  const color = palette[Math.max(0, Math.min(9, cell.bracketIndex))]
  const className = [
    "bar",
    selected ? "selected" : "",
    cell.hasOwnRecording ? "direct" : "inferred",
    cell.isDeadZone ? "dead" : "",
  ].filter(Boolean).join(" ")

  return `
    <g class="${className}" data-cell-key="${escapeAttr(cell.key)}" tabindex="0" role="button" aria-label="${escapeAttr(cell.label)} ${formatMbps(cell.displayMbps)}">
      <line class="bar-stem" x1="${base.x}" y1="${base.y}" x2="${p.x}" y2="${p.y}" />
      <circle class="bar-base" cx="${base.x}" cy="${base.y}" r="${cell.hasOwnRecording ? 8 : 5}" />
      <rect class="bar-head" x="${p.x - 15}" y="${p.y - 10}" width="30" height="20" rx="5" fill="${color}" />
      ${selected ? `<circle class="selection-ring" cx="${p.x}" cy="${p.y}" r="22" />` : ""}
    </g>
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

  document.querySelectorAll<SVGGElement>("[data-cell-key]").forEach((node) => {
    const select = () => {
      state.selectedKey = node.dataset.cellKey || ""
      render()
    }
    node.addEventListener("click", select)
    node.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault()
        select()
      }
    })
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

function project(x: number, z: number, height: number): {x: number; y: number} {
  const scale = 8
  const originX = 460
  const originY = 370
  return {
    x: originX + (x - z) * scale,
    y: originY + (x + z) * scale * 0.5 - height,
  }
}

function mapSubtitle(map: PublishedMap): string {
  return `PIN ${map.pin} · ${map.snapshot.directCellCount} recorded points · expires ${formatDate(map.expiresAt)}`
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
