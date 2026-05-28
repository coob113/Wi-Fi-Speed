# PingTest / InternetSpeed — Findings & next steps

**Status:** Research + Phase 0/1 prototype on device  
**Goal:** Measure **Wi‑Fi coverage** spatially while wearing Spectacles  
**Last updated:** 2026-05-20 (v1 ship)

---

## What we built so far

| Phase | Doc | Implemented |
|-------|-----|-------------|
| 0 | [PHASE0_CONNECTION_PROBE.md](./PHASE0_CONNECTION_PROBE.md) | HTTPS RTT loop, then simplified |
| 1 (partial) | [PHASE1_LOCAL_PROBE.md](./PHASE1_LOCAL_PROBE.md) | Local LAN HTTP RTT probe (superseded) |
| 2 | [PHASE2_MINI_SPEEDTEST.md](./PHASE2_MINI_SPEEDTEST.md) | LAN download Mbps mini speedtest |
| 3 | [PHASE3_COVERAGE_GRID.md](./PHASE3_COVERAGE_GRID.md) | XZ grid markers, median, height map |

**Current script:** `Assets/Scripts/ConnectionProbe.ts`

- **Probe target:** Snap Cloud or LAN `10mb.bin` (see [PHASE2](./PHASE2_MINI_SPEEDTEST.md))
- **Method (v2 — default):** two HTTP **Range** requests per probe:
  1. Warmup `bytes=0-(warmupBytes-1)` — 2 MB default, discarded  
  2. Measure `bytes=warmupBytes-(expectedBytes-1)` — timed; `Mbps = (measure_bytes × 8) / measure_seconds`
- **Timing:** `interProbeDelaySec` (0.5 s) between probes; wall-clock includes warmup + measure
- **Fallback:** bulk full-file GET if Range unsupported (`rangeFallbackToBulk`)
- **Display:** Palm UI + pin labels (no HUD debug Text); optional Logger detail with `logMeasurementDetail`
- **Device:** Steady-state from first probe (~42–47 Mbps); eliminates ~17–19 Mbps cold-start seen with bulk/full Range

**Removed after testing:**

- Remote HTTPS probe (`catfact.ninja`) — not useful for local coverage
- `net:+N` (remote − local) — measured internet leg, not Wi‑Fi
- Fixed 1 Hz timer — replaced with back-to-back probes

---

## Key findings

### 1. Remote RTT is the wrong metric for coverage

Probing a distant HTTPS API mostly reflects **CDN + ISP + server**, not “Wi‑Fi at this spot.”

Walking around rarely changed readings; values clustered around **~200–400 ms** with jitter.

**Conclusion:** Drop remote-only probes for coverage maps. Local LAN target is the right direction.

### 2. Router RTT (`L:17 ok` / `L:33 ok`) is also a weak coverage metric

On device, **most samples were exactly 17 ms or 33 ms**; other values appeared **&lt;1%** of the time when moving.

Likely causes:

| Factor | Effect |
|--------|--------|
| **`getTime()` resolution** | ~16.7 ms steps (60 Hz) → RTT quantizes to **17** and **33** ms |
| **Tiny HTTP to router** | Real LAN RTT may be a few ms; measurement sees frame ticks, not wire time |
| **Same AP + same router** | Path stable; movement in one area doesn’t change hop much |
| **Bad Wi‑Fi ≠ high RTT** | Weak spots often show **loss/timeouts**, not sustained high ms to router |

**User observation:** Almost never saw `error` / `fail` — link stayed “ok” while ms looked static.

**Conclusion:** Fine for “does LAN HTTP work?” Poor for “how good is Wi‑Fi here?”

### 3. `net:+N` was misleading

`net` = remote RTT − local RTT (estimated “internet leg”). User doesn’t care about server distance; metric removed.

### 4. Cannot read router IP from Spectacles

No documented API for default gateway / DHCP / router LAN IP. `localPingUrl` must be **configured manually** (e.g. from Mac: `route -n get default` → **192.168.50.1** for this user).

### 5. Lens Studio MCP scene automation was unreliable

Automated scene/script setup via MCP often left **broken script references** or **stale TypeScript cache** (`NewScript` stub vs real `ConnectionProbe`).

**Working pattern:** Agent writes TypeScript; **user wires** scripts in Inspector. No direct `Scene.scene` YAML edits.

### 6. How commercial speedtests differ

Speedtests (Ookla, fast.com, etc.) primarily measure:

1. **Download throughput** — large file(s), many MB, parallel streams → **Mbps**
2. **Upload throughput** — same, upstream
3. Sometimes **ping / jitter** to a **nearby internet** server

They do **not** ping the home router with 1 KB requests. Throughput tests stress the link; weak Wi‑Fi usually shows as **lower Mbps** or **failures**, not a steady 17 ms to the router.

**Conclusion:** For coverage, next metric should be closer to **throughput (mini speedtest)** and/or **failure rate**, not finer router RTT.

---

## Metric comparison (what to use when)

| Metric | What it measures | Coverage sensitivity | On Specs today |
|--------|------------------|----------------------|----------------|
| RTT to router (current) | LAN + router HTTP | **Low** (quantized, stable) | Yes (`fetch` + Experimental) |
| RTT to internet | Full path latency | Low–medium | Yes (HTTPS `fetch`) |
| **Download Mbps** | Capacity | **High** (speedtest-style) | Yes, need sized payload + full body read |
| Upload Mbps | Upstream capacity | High | Same, heavier |
| **Fail / timeout %** | Drops | **High** | Partially (`error` rare so far) |
| Position per sample | Where | Required for map | Not implemented (deferred) |

---

## Open questions (resolved or parked)

| Question | Answer |
|----------|--------|
| Get router IP from Specs? | **No** — manual `localPingUrl` |
| Send more data per probe? | **Yes for coverage** — mini speedtest, not bigger ping |
| Log position now? | **Deferred** — user: outliers aren’t the focus; find metric first |
| Enable Experimental APIs? | **Yes** for LAN `http://` |

---

## Next steps (recommended order)

### Step 1 — Mini speedtest ✅ implemented

See [PHASE2_MINI_SPEEDTEST.md](./PHASE2_MINI_SPEEDTEST.md). Test file: `testdata/10mb.bin` (100× `100kb.bin`).

### Step 2 — Failure / timeout tracking

Even with Mbps, track over a sliding window:

- `ok` count / `error` count / timeout (if we add max wait)

Weak zones may show **failures** before Mbps drops in a quantized RTT test.

### Step 3 — Position logging ✅ implemented

See [PHASE3_COVERAGE_GRID.md](./PHASE3_COVERAGE_GRID.md) — grid snap, median per cell, Y height map, billboards.

### Step 4 — Export

Batch log to file or POST to dev machine for analysis outside the lens.

### Step 5 — Controlled infrastructure

- Dedicated ping/speedtest endpoint on laptop (empty or fixed body, same region).  
- Optional dual endpoint (LAN + remote) only if needed to separate Wi‑Fi vs ISP.

---

## Not planned (unless requirements change)

- Spatial anchors / world mesh for phase 1  
- Publishing lens with Experimental APIs (LAN `http://` is dev-only)  
- Full Ookla-style multi-stream test (too heavy for continuous wear)  
- Auto-discover router IP on device  

---

## User environment notes

| Item | Value |
|------|--------|
| Router LAN IP (from Mac gateway) | `192.168.50.1` |
| Suggested `localPingUrl` | `http://192.168.50.1/` |
| Platform | Spectacles, Lens Studio 5.15.4+ |
| Wiring | User assigns `ConnectionProbe` + `debugText` in Inspector |

---

## References

- [PHASE0_CONNECTION_PROBE.md](./PHASE0_CONNECTION_PROBE.md) — original RTT spec  
- [PHASE1_LOCAL_PROBE.md](./PHASE1_LOCAL_PROBE.md) — LAN setup  
- [Internet Access (Spectacles)](https://developers.snap.com/spectacles/about-spectacles-features/apis/internet-access) — `fetch`, `http` + Experimental APIs  
- `Examples/Fetch/` — `InternetModule.fetch` pattern  

---

*Document findings before implementing Phase 2 mini speedtest.*
