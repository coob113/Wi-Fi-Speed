# Phase 0: Connection probe (1 Hz RTT + debug HUD)

**Audience:** Implementing agent (Cursor + Lens Studio MCP optional)  
**Project:** `InternetSpeed` — Snap Spectacles lens in Lens Studio 5.15.4+  
**Goal:** Every **1 second**, run one **HTTPS** request, measure **round-trip time (ms)**, show result on an on-lens **Text** debug HUD. No spatial features in this phase.

---

## Product context (read once)

Long-term **PingTest** vision:

1. Measure network latency while wearing Spectacles.
2. Optionally attach samples to **HMD/world position** (relative position is enough; no Spatial Anchors or world mesh required for phase 0).
3. Later: dual endpoints (LAN + remote), heatmaps, export.

**This document is only phase 0:** prove the measure → display loop works on device.

---

## Repository layout

```
PingTest/
├── InternetSpeed/                 ← Lens Studio project (implement here)
│   ├── InternetSpeed.esproj
│   ├── Assets/
│   │   └── Scene.scene
│   └── docs/
│       └── PHASE0_CONNECTION_PROBE.md   ← this file
├── Examples/                      ← reference samples (optional)
│   └── Fetch/                     ← InternetModule.fetch pattern
└── .cursor/mcp.json               ← Lens Studio MCP (optional for agent)
```

**Do not modify `Examples/`** unless explicitly asked. All new work goes under `InternetSpeed/`.

---

## Technical requirements

| Item | Requirement |
|------|-------------|
| Platform | **Spectacles only** (project already targets Spectacles) |
| API | `InternetModule` via `require("LensStudio:InternetModule")` |
| HTTP | **HTTPS only** for phase 0 (no Experimental APIs) |
| Interval | **1.0 s** between probe **starts** (skip tick if previous request still in flight) |
| RTT | `getTime()` before `fetch` → after response; `(t1 - t0) * 1000` ms |
| UI | One `Text` component, string like `RTT: 142 ms \| ok 200` |
| Logging | `print("[ConnectionProbe] ...")` for Lens Studio Logger panel |

**Out of scope for phase 0:**

- LAN / `http://192.168.x.x` probes
- Position logging, heatmaps, file export
- Spatial Persistence, world mesh, Device Tracking setup
- Dual endpoints, median filtering, grids

---

## Implementation steps

### 1. Create script asset

**Path:** `InternetSpeed/Assets/Scripts/ConnectionProbe.ts`  
(create `Assets/Scripts/` if missing)

**Full script:**

```typescript
@component
export class ConnectionProbe extends BaseScriptComponent {
  @input
  @hint("On-lens debug text")
  debugText: Text

  private internetModule: InternetModule = require("LensStudio:InternetModule")

  /** Minimal HTTPS endpoint; replace with your own /ping when ready */
  private pingUrl = "https://catfact.ninja/fact?max_length=1"

  private readonly intervalSec = 1.0
  private elapsed = 0.0
  private inFlight = false
  private lastRttMs = -1
  private lastStatus = "idle"

  onAwake() {
    this.createEvent("UpdateEvent").bind(this.onUpdate.bind(this))
    this.setDebug("starting...")
  }

  private onUpdate() {
    if (this.inFlight) {
      return
    }

    this.elapsed += getDeltaTime()
    if (this.elapsed < this.intervalSec) {
      return
    }
    this.elapsed = 0

    this.runPing()
  }

  private runPing() {
    this.inFlight = true
    this.lastStatus = "pinging..."
    this.setDebug(this.lastStatus)

    const t0 = getTime()

    this.internetModule
      .fetch(this.pingUrl, { method: "GET" })
      .then((response) => {
        this.lastRttMs = (getTime() - t0) * 1000
        this.lastStatus = response.ok ? `ok ${response.status}` : `fail ${response.status}`
      })
      .catch(() => {
        this.lastRttMs = -1
        this.lastStatus = "error"
      })
      .finally(() => {
        this.inFlight = false
        const line =
          this.lastRttMs >= 0
            ? `${this.lastRttMs.toFixed(0)} ms | ${this.lastStatus}`
            : `-- | ${this.lastStatus}`
        this.setDebug(line)
      })
  }

  private setDebug(msg: string) {
    const line = `RTT: ${msg}`
    if (this.debugText) {
      this.debugText.text = line
    }
    print(`[ConnectionProbe] ${line}`)
  }
}
```

**Notes for implementer:**

- `fetch` on Spectacles returns a Promise (same as official [Fetch sample](https://github.com/specs-devs/samples/tree/main/Fetch)).
- `inFlight` prevents overlapping requests if the network is slower than 1 s.
- `catfact.ninja` is a stand-in; swap to a minimal controlled endpoint when available.

---

### 2. Scene setup (Lens Studio UI)

1. Open `InternetSpeed/Assets/Scene.scene`.
2. Add **Text** object → rename **`DebugText`**.
   - Initial text: `RTT: -- ms`
   - Readable font size for AR HUD.
   - Parent to camera or screen-space rig so it stays visible (follow existing Specs Starter hierarchy if present).
3. Add empty **Scene Object** → rename **`ConnectionProbe`**.
4. **Add Component** → `ConnectionProbe` script.
5. In Inspector, assign **`debugText`** → `DebugText` Text component.
6. Save scene.

**Optional:** Add **Internet Module** asset from Asset Browser. Not required if using `require("LensStudio:InternetModule")` only.

---

### 3. Project / preview settings

- **Preview:** Device Type Override = **Spectacles** (required; otherwise `fetch` may return 404 in editor).
- **Do not enable Experimental APIs** for phase 0 (HTTPS only).
- Compile TypeScript (Lens Studio auto-compile or MCP `CompileWithLogsTool` if available).

---

### 4. Verify

#### Editor (Interactive Preview, Spectacles mode)

| Check | Expected |
|-------|----------|
| Logger every ~1 s | `[ConnectionProbe] RTT: …` |
| DebugText updates | Shows ms and `ok 200` or error |
| No spam | At most one request per second |

#### Spectacles device

| Check | Expected |
|-------|----------|
| Lens installs | Standard push-to-device flow |
| On Wi‑Fi | RTT values appear; not stuck on `error` |
| Logger (if connected) | Same lines as editor |

#### Failure modes

| Symptom | Likely cause |
|---------|----------------|
| Always `error` | No Wi‑Fi; wrong preview device; URL blocked |
| 404 in preview | Preview not set to Spectacles |
| Stuck `pinging...` | Request hung; check network; consider timeout later |
| No Text update | `debugText` not wired in Inspector |

---

## Acceptance criteria

- [ ] `Assets/Scripts/ConnectionProbe.ts` exists and compiles without errors
- [ ] Scene has `DebugText` + `ConnectionProbe` with wired `@input debugText`
- [ ] In Spectacles preview or device: **≥ 5 consecutive** successful probes showing numeric ms
- [ ] Probes run at **~1 Hz** (not faster when RTT is normal)
- [ ] Logger prints the same string as the HUD

---

## Reference material

| Resource | Use |
|----------|-----|
| `Examples/Fetch/Assets/Scripts/FetchCatFacts.ts` | Official `InternetModule.fetch` pattern |
| [Internet Access (Spectacles)](https://developers.snap.com/spectacles/about-spectacles-features/apis/internet-access) | HTTPS vs HTTP, Experimental APIs |
| Lens Studio MCP (`user-lens-studio`, 40 tools) | Create assets, compile — if connected in Cursor |

---

## Later phases (do not implement now)

Document for roadmap only:

1. **Dual endpoint** — `https://remote/ping` + `http://LAN/ping` (Experimental APIs for LAN).
2. **Position column** — `camera.getTransform().getWorldPosition()` per sample.
3. **Decomposition** — show `local`, `remote`, `remote - local`.
4. **Noise** — median per grid cell; multiple passes.
5. **HUD** — color thresholds; rolling average.
6. **Export** — POST log batch to dev machine or file.
7. **Controlled ping URL** — empty body, same region, connection reuse study.

---

## Agent checklist (copy-paste)

```
[ ] Read InternetSpeed.esproj — confirm Spectacles target
[ ] Create Assets/Scripts/ConnectionProbe.ts (code above)
[ ] Add DebugText + ConnectionProbe to Scene.scene, wire input
[ ] Compile — zero TS errors
[ ] Preview with Spectacles device override — HUD + Logger update ~1 Hz
[ ] Report sample RTT values and any errors
```

---

*Phase 0 spec — PingTest / InternetSpeed — 2026*
