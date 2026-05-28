# Phase 2: Mini speedtest (LAN download Mbps)

**Requires:** Experimental APIs enabled (Project Settings) for `http://` LAN.

## What it measures

**Default (Stage B — warmup window):** two Range requests per probe:

1. **Warmup** — `bytes=0-(warmupBytes-1)` (default first **2 MB**), discarded, not timed  
2. **Measure** — `bytes=warmupBytes-(expectedBytes-1)` (default **~7.77 MB** on `10mb.bin`), timed  

`Mbps = (measure_bytes × 8) / (measure_seconds × 1e6)`

Wall-clock per probe includes warmup + measure (+ `interProbeDelaySec` before the next probe). Palm UI progress bar uses total wall time.

**Legacy modes:** `useWarmupWindow=false` → single full-file Range (Stage A). `useByteRange=false` → bulk GET.

Displayed as `L:12.4 Mbps ok` on Logger (+ optional detail lines).

## Script

`Assets/Scripts/ConnectionProbe.ts`

| Inspector input | Default | Purpose |
|-----------------|---------|---------|
| `downloadUrl` | `http://192.168.50.1/10mb.bin` | Fixed-size file on LAN |
| `expectedBytes` | `10240000` | Size for Mbps calc (`0` = use received length) |
| `useByteRange` | `true` | HTTP Range downloads (required for warmup) |
| `useWarmupWindow` | `true` | Stage B: warmup Range then timed measure Range |
| `warmupBytes` | `2097152` (2 MB) | Discarded prefix before timed window |
| `minMeasureBytes` | `4194304` (4 MB) | If measure window smaller, fall back to full-file Range |
| `rangeFallbackToBulk` | `true` | Retry with normal GET if Range fails |
| `logMeasurementDetail` | `false` | Logger: warmup / measure / bulk lines |

Probes run back-to-back (next download starts when the previous finishes).

## Warmup window (Stage B — default)

When **`useWarmupWindow`** and **`useByteRange`** are on:

| Step | Range | Scored? |
|------|-------|---------|
| Warmup | `bytes=0-2097151` (2 MB) | No — primes link, discarded |
| Measure | `bytes=2097152-10239999` (~7.77 MB) | Yes — Mbps from this step only |

With **`logMeasurementDetail=true`**, Logger shows:

```
warmup ok bytes=0-2097151 http=206 len=2097152
measure ok bytes=2097152-10239999 http=206 len=8142848 44.2 Mbps (warmup 2097152)
L:44.2 Mbps ok
```

Toggle **`useWarmupWindow=false`** to revert to Stage A (single full-file Range).  
Toggle **`useByteRange=false`** for bulk GET (Stage A parity test).

If warmup or measure Range fails and **`rangeFallbackToBulk`** is on → one bulk GET for that probe (logged once).

### Device test

1. **`useWarmupWindow=true`**, **`logMeasurementDetail=true`** — confirm warmup + measure 206 lines  
2. First probe Mbps should be closer to steady-state (less ~17–19 Mbps cold-start dip)  
3. Compare a few probes vs **`useWarmupWindow=false`** on the same spot  

**Status:** Device verified 2026-05-20 — warmup + measure 206; steady ~42–47 Mbps from probe 1.

## HTTP Range (Stage A fallback)

When **`useWarmupWindow=false`** but **`useByteRange=true`**, each probe uses one Range for the full file:

`Range: bytes=0-(expectedBytes-1)` → e.g. `bytes=0-10239999` for `10mb.bin`

- Expect **206 Partial Content** on servers that support Range (Python `http.server`, most static hosts).
- If Range fails and **`rangeFallbackToBulk`** is on, one retry uses a normal full-file GET (logged once in Logger).

## Setup: laptop as download server (recommended)

1. Copy or serve the test file from this repo:

   `InternetSpeed/testdata/100kb.bin` (exactly 102,400 bytes)

2. On your Mac (same Wi‑Fi as Spectacles):

   ```bash
   cd /path/to/PingTest/InternetSpeed/testdata
   python3 -m http.server 8080 --bind 0.0.0.0
   ```

3. Find your Mac’s LAN IP (System Settings → Network), e.g. `192.168.50.42`.

4. In Lens Studio Inspector on `ConnectionProbe`:

   - **Download Url:** `http://192.168.50.42:8080/10mb.bin`
   - **Expected Bytes:** `10240000`

5. Preview with **Device Type Override = Spectacles**.

## Router as server (optional)

Most routers don’t expose a clean fixed-size file. Prefer the laptop server above for repeatable Mbps.

## Reading coverage

- **Lower Mbps** in a spot → weaker Wi‑Fi / contended link.
- **`fail` / `error`** → request didn’t complete (often better signal than quantized RTT).
- Walk slowly; each line is one full 10 MB download (~100× longer than the 100 KB probe).

## Next

- Failure-rate window (Step 2 in [FINDINGS_AND_NEXT_STEPS.md](./FINDINGS_AND_NEXT_STEPS.md))
- Log position per sample for heatmap (Step 3)
