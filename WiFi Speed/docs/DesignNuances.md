# Design nuances

Product and UX decisions for coverage map labels, metrics, and how we talk to users about measurements.

## Per-point UI (planned)

Each grid marker shows three layers:

```
Download speed (median)
100 Mbps

Relatively
83% · Good

Records: 4  [expand]
```

When expanded, list every raw recording for that cell (newest or chronological order TBD).

**Lens (current):** pinch opens a **summary panel** only — Mbps, %, bracket label, test count. **No expand-to-list on device for now** (see [IMPLEMENTATION_ARCHITECTURE](./IMPLEMENTATION_ARCHITECTURE.md)); raw list remains a web / later feature.

| Line | Purpose |
|------|---------|
| **Download speed (Mbps)** | Absolute-ish answer: “how fast were downloads here?” Same mental model as phone speedtest apps. |
| **Relatively (% + label)** | Session context: “how good is this spot compared to the rest of *my* walk?” |
| **Records (expand)** | Trust and transparency: median is built from these values; user can inspect outliers. |

### Field definitions

| Field | Source |
|-------|--------|
| **Mbps headline** | Smoothed median for display (matches color, height, bar scale). Document once in onboarding that the stat is a **median**, not a mean. |
| **%** | `(cellMbps - sessionMin) / (sessionMax - sessionMin) × 100`, from smoothed values used for the map. |
| **Good / OK / Poor** | Buckets on **session % only** — not on absolute Mbps. Same Mbps can be “Good” in one environment and “Poor” in another. |
| **Record count** | Number of **successful** samples stored on the cell (`samples.length`). |
| **Expanded list** | Raw Mbps per probe (`samples[]`). Optionally show discarded runs (moved, fail) if we persist them later. |

### Neighbor-influenced cells

Cells created only via neighbor spread (no direct recording) should be visually distinct (smaller X/Z scale already) and labeled clearly, e.g. **Inferred · no direct recording**. Hide or dim expand until the user records at that cell.

---

## Mbps vs percentage

| Show | When |
|------|------|
| **Mbps** | Primary label — “download speedtest” wording |
| **%** | Secondary — relative coverage within the session |

Do **not** use % alone as the only user-facing metric; it rescales every walk and cannot be compared to Ookla or across days.

---

## What we can call it (copy)

**OK:**

- “Download speed (Mbps)”
- “Estimated download · 10 MB test”
- “Median download speed at this spot”

**Avoid:**

- “Official speedtest result”
- “Your internet speed is X Mbps” (implies ISP line rate)

Fair disclaimer: *Download speed measured on-device (10 MB HTTPS file); may differ from phone speedtest apps.*

---

## How this compares to other tools

### Ookla / commercial speedtest

Same **type** of metric (download throughput, Mbps). Different **method**:

| | This lens | Ookla |
|--|-----------|-------|
| Payload | 10 MB — **2 MB warmup + ~7.77 MB scored** (HTTP Range) | Larger, often parallel |
| Server | Snap Cloud storage | Nearest CDN node |
| Display on map | Median + session % | One-off absolute Mbps |

Numbers should be **same tier** (both fast / both slow) at one spot, not the same digit. Repeated samples in a cell **stabilize** the median; they do not fully match Ookla. Onboarding: **estimated download** — 10 MB test with 2 MB warmup discard; may differ from phone apps.

### SeeSignal (Quest, dBm)

SeeSignal shows **Wi‑Fi radio strength (RSSI, dBm)** — invisible field in the room. We show **experienced download Mbps** — end-to-end through Wi‑Fi, router, ISP, and server. Good dBm can still mean bad Mbps (congestion, distant server).

---

## Measurement behavior (affects labels)

- **Warmup window (v2)** — each probe discards first **2 MB** via Range, scores the rest only ([PHASE2](./PHASE2_MINI_SPEEDTEST.md)); avoids cold-start ~17 Mbps dips on first probe.
- **Median per cell** — not average; flukes matter less after several recordings.
- **Travel discard** — if start/end XZ distance > 25 units, sample is unsuccessful (no grid update); consider showing discarded runs in expand if stored.
- **Smoothing** — display Mbps/% use neighbor-smoothed values; expand list shows **raw** per-run values.
- **Experimental APIs** — not required for Snap Cloud HTTPS; only for LAN `http://` override.

---

## Out of coverage / dead zones

Users need two different signals: **“we never measured here”** vs **“we measured here and it’s bad.”**

| State | Meaning | UI |
|-------|---------|-----|
| **Unmapped** | No successful sample in this cell (or only neighbor-inferred) | No pin, or faint “inferred” pin — **not** `!` |
| **Dead zone** | Enough direct recordings; speed consistently terrible | `!` + short label instead of headline Mbps |
| **Live fail** | Current probe failing while user stands here | Fail sound + debug line; optional transient HUD |

Do **not** use `!` for neighbor-only cells — that would look like confirmed bad coverage when we never actually tested there.

### When to show `!` instead of “Download speed X Mbps”

Use a **confirmed dead zone** rule so one unlucky run doesn’t flash `!`:

**All required:**

- Cell has **own recording** (`hasOwnRecording`)
- **≥ 3** successful direct samples in that cell (tunable)

**Any one triggers dead zone:**

- Smoothed median **&lt; 10 Mbps**, or
- Session relative **&lt; 1%** of session max (only when session spread is meaningful — see below)

Optional later: last **2–3 probes in a row** failed (timeout / error / moved) while user is in or adjacent to the cell — for **live** “you’re leaving coverage” feedback, not only historical pins.

### Session % guardrails

Relative **&lt; 1%** only applies when:

- `sessionMax - sessionMin` ≥ a small floor (e.g. **5 Mbps**), so a flat walk doesn’t mark everything `!`
- At least **3** samples on the cell

Otherwise rely on **absolute &lt; 10 Mbps** only.

### What to show on a dead-zone pin

Replace the Mbps headline, keep transparency:

```
!
No coverage

Relatively
2% · Poor

Records: 4  [expand]
  2.1 · 1.8 · 3.0 · 2.5 Mbps
```

- **`!`** — quick scan while walking
- **“No coverage”** (or “Very poor download”) — plain language; not “0 Mbps” as if precise
- **Expand** — still lists raw runs so power users see it’s measured, not guessed

### Visual (besides text)

- Lowest color bracket / red material (already in 0–10% bucket)
- Minimum bar height (Y scale → 0 or small floor)
- Smaller pin optional for inferred; **full-size + `!`** for confirmed dead zones

### Live “you’re going out of coverage”

While walking, pins lag until a probe finishes. Complement cell `!` with HUD **probe state**:

- **2 consecutive fails** → probe state shows *“Weak or no download here”* (not a separate banner)
- **Edge of map** — empty grid vs painted cells is its own cue; no extra icon needed in void

### Thresholds (starting defaults)

| Input | Default | Notes |
|-------|---------|--------|
| `deadZoneMbps` | 10 | Absolute floor |
| `deadZoneSessionPct` | 1 | Relative floor (Inspector on Record prefab) |
| `deadZoneMinSamples` | 3 | Confidence before `!` |
| `sessionSpreadMinMbps` | 5 | Min max−min to trust session % |

Locked for v1 ship (2026-05-20).

---

## Palm UI (always-on while mapping)

Left-palm UI (`PalmUI`) shown when **`leftHand.isFacingCamera()`** — separate from per-pin detail. Goal: **feedback during the 10 MB test**, **last-run metrics**, and **nudge where to walk**.

**Scope:** Palm UI shows **last successful probe only** (Mbps, %, bracket label) via **`ConnectionProbe`** — not cell medians. Header + Secondary update live each frame from last ok probe; session % uses **ok-probe min/max** this walk (meaningful after ≥2 ok probes). See [IMPLEMENTATION_ARCHITECTURE — Completed stages](./IMPLEMENTATION_ARCHITECTURE.md#completed--stages-03) and `CoveragePalmUi.ts`.

**Visibility:** `isFacingCamera()` with show/hide delay (hysteresis); scale lerp on palm attach point.

### Core elements

| Element | Source | Notes |
|---------|--------|--------|
| **Probe state** | `ConnectionProbe` lifecycle | `CurrentStatus` + progress bar on `Pivot To Scale` |
| **Last quality (Header)** | Last **ok** probe via `ConnectionProbe` | Bracket label after ≥2 ok probes; *First reading* after first ok only |
| **Mbps + % (Secondary)** | Last ok vs **ok-probe** session min/max | Multi-line; live during next test |
| **Stay / move hints** | Grid sample count at current cell | Stable text per type+cell; **visible during download** |
| **Best speed → arrow** | Smoothed-median cluster centroid | Yaw slerp; hides when palm hidden / in cluster |

### Probe state (single line + loader)

One status channel — includes weak-streak messaging, not a separate banner.

| State | UI |
|-------|-----|
| **In progress** | Spinner / loader + *“Testing download…”* |
| **Success** | Brief *“OK”* for `interProbeDelaySec`; metrics already show last ok |
| **Failed** | *“Download failed”* (or specific error) |
| **Moved** | *“Too much movement — try again”* |
| **Weak streak** | After **2 consecutive fails** at this spot: *“Weak or no download here”* (same copy as dead-zone live UX) |

Weak streak is a **probe-state variant**, not extra HUD chrome.

### Best-speed arrow

Uses grid internally for direction only; user never sees cell medians on the HUD.

1. Cells with **own recording** and **smoothed** median Mbps.
2. Top tier: ≥ **80%** of session max (`arrowMinFractionOfMax`, default 0.8).
3. **Centroid** = average world X/Z of qualifying cells (Y ignored).
4. Arrow from user → centroid, **yaw slerp** (`arrowRotationLerp`).
5. Hide until **≥ 2** qualifying cells; hide if user inside cluster (&lt; one `gridSize`); hide when palm scaled down.

### Sampling prompts (stay / move)

**Not** a mapped-area counter — we don’t know how big the space is. Instead, nudge **efficient coverage** at the **current spot** (same small radius / same grid cell under the hood, but HUD copy stays about *here*, not “cell 4,2”):

| Condition | Prompt (example) | Intent |
|-----------|------------------|--------|
| **Too few** successful samples while user hasn’t moved much | *“Stay here for another measurement”* | Stabilize signal before leaving |
| **Enough** samples at this spot | *“Good — try another area”* | Avoid 10 redundant pins in one place |

**Thresholds (starting ideas — tune on device):**

| Parameter | Starting range | Notes |
|-----------|----------------|-------|
| `stayMinSamples` | **1** (first success still OK to leave) or **2** if we want median confidence | Prompt only after at least one attempt |
| `moveAfterSamples` | **3** (default) … **10** (large open plan) | After N successes within radius, suggest moving |

Optional: only show *stay* after a fail or high variance between last two runs; only show *move* after N **consecutive** successes without leaving the radius.

### Explicitly out of HUD scope

| Element | Decision |
|---------|----------|
| **Session best (Mbps)** | Not shown — % and arrow are enough |
| **This cell / cell median** | Pins only; HUD = last run |
| **Mapped spot count** | Not useful without knowing target area |
| **Session worst** | Skip |

### Skip or defer (usually clutter)

| Element | Why skip |
|---------|----------|
| Upload / ping / jitter | Not measured |
| Ookla-style “official” score | Different test |
| Compass to router | No router API on Spectacles |
| Constant dead-zone list | Map + `!` pins enough |
| Raw dBm | Not available |

### Suggested layout (compact)

```
┌─────────────────────────┐
│  ⟳ Testing download…    │  ← loader + probe state
│  Great                  │  ← bracket (or “First reading” after 1st ok)
│  42 Mbps                │
│  67% of session         │  ← after ≥2 ok probes
│  Stay for another test  │  ← hint (can show during download)
│      ↑                  │  ← arrow to best cluster
└─────────────────────────┘
```

After success, probe line can clear or show brief *“OK”* before next run. On fail / moved / weak streak, status line replaces or sits above metrics.

### HUD vs pins

| HUD | Pins |
|-----|------|
| **Last run** — Mbps, %, probe state | **This spot** — median, records, expand |
| Loader + stay/move hints | Historical samples per cell |
| Arrow to best coverage (orientation) | World-locked map |

Same session % formula; different aggregation — make that distinction in onboarding.

### Open Palm UI todos

See [IMPLEMENTATION_ARCHITECTURE — Completed stages](./IMPLEMENTATION_ARCHITECTURE.md#completed--stages-03).

- [x] Palm UI complete (Stage 3) — device tested

---

## Open UX todos (v1)

- [x] Pin summary panel on pinch — **Stage 2**
- [x] Palm UI (probe state, last ok metrics, hints, arrow) — **Stage 3**
- [x] Dead zone (`!`) — **Stage 2**; min samples **3** for v1
- [x] Good / OK / Poor % thresholds — **70 / 35** locked for v1
- [x] Tune `moveAfterSamples` — **3** on device
- [x] Onboarding (5 slides) — **Stage 5**

**Dropped:** expand pin panel to raw Mbps list on lens; Palm “here” marker; contextual one-time hints; Help screen.
