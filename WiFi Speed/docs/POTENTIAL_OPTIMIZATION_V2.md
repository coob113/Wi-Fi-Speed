# Potential optimization v2

CPU reduction backlog for InternetSpeed lens. Ordered by suggested priority.

**Related:** [IMPLEMENTATION_ARCHITECTURE](./IMPLEMENTATION_ARCHITECTURE.md) · `CoverageGridManager.ts` · `CoveragePalmUi.ts`

**Last updated:** 2026-05-20

---

## Context — where CPU goes

Three per-frame update loops on device:

| System | Runs | Scales with |
|--------|------|-------------|
| `CoverageGridManager.onUpdate` | Every frame | **Number of bars** (largest cost) |
| `CoveragePalmUi.onUpdate` | Every frame | Palm visible + bar count (arrow scan) |
| `OnboardingController` | Every frame while active | Negligible when dismissed |

Per bar, every frame (`CoverageGridManager`):

- [ ] Document baseline: distance check + `Camera.isSphereVisible()` for culling (cached with intervals)
- [ ] Document baseline: **second** `isSphereVisible()` for pinch — **uncached**, every frame within `interactableMaxDistance`
- [ ] Document baseline: height lerp (`stepWorldY`) for all enabled bars
- [ ] Document baseline: on each ok probe — full-grid smooth (`smoothPasses × all markers`) + global resync when session min/max shifts

Each bar = full Record prefab (mesh + material swaps + SIK Interactable). Long walks → dozens to 100+ live objects.

---

## Quick wins — Inspector only

Try these before code changes.

### CoverageGridManager

- [ ] Raise `gridSize` from **20** → **30–40** (fewer unique cells over same walk)
- [ ] Lower `cullMaxDistance` from **800** → **400–500** (disable far bars)
- [ ] Lower `neighborSpreadRings` from **2** → **1**
- [ ] Set `neighborIncludeDiagonals` **false**
- [ ] Lower `smoothPasses` from **2** → **1**
- [ ] Set `barHeightMoveSmooth` from **10** → **0** (snap Y instead of per-frame lerp)
- [ ] Raise `cullFovCheckNearSec` from **0** → **0.1**
- [ ] Raise `cullFovCheckMidSec` from **0.15** → **0.25**
- [ ] Raise `cullFovCheckFarSec` from **0.33** → **0.5**
- [ ] Lower `interactableMaxDistance` from **100** → **60–70** (fewer live pinch FOV checks)
- [ ] Verify `perfNearDistance` / `perfMidDistance` units — scene has **2 / 4**, script defaults **200 / 400** (cm); confirm not mis-set

### ConnectionProbe

- [ ] Raise `interProbeDelaySec` from **0.5** → **1.0–1.5** (fewer probes → fewer bars + less smoothing)

### Record prefab

- [ ] Disable or simplify VisualSphere hover scale if acceptable for UX
- [ ] Confirm `enableLookAt` stays **false**

---

## Medium wins — code changes (high ROI)

- [ ] **Cache pinch FOV checks** — `queryMarkerInFovForInteractable()` calls `isSphereVisible()` every frame for bars within pinch range; reuse cull cache or throttle ~10 Hz
- [ ] **Dirty-check palm Text** — `CoveragePalmUi.refreshAll()` rewrites `statusText` / `headerText` / `secondaryText` every frame; only update when probe state or metrics change
- [ ] **Throttle arrow centroid** — `getBestClusterCentroid()` scans all markers every frame while palm open; run at ~5–10 Hz
- [ ] **Skip palm work when hidden** — when `uiScale ≈ 0`, skip attach lerp, arrow, hints, and most text refresh
- [ ] **Smarter global resync** — when session min/max shifts slightly, resync only bars whose bracket index changed (not entire map)

---

## Heavy wins — larger changes

- [ ] Cap max markers (drop oldest / merge distant cells after N bars)
- [ ] Far LOD — culled bars stay disabled; near bars keep full prefab
- [ ] Split update rates — culling at ~15 Hz, height lerp at ~30 Hz
- [ ] Slim Record prefab — fewer mesh passes, no VisualSphere, lighter materials

---

## Profiling — how to tell what hurts

- [ ] Re-run device walk with Lens Studio Profiler
- [ ] **Spike every ~0.5 s** → probe + smoothing + spawn (`refreshAfterDataChange`)
- [ ] **High constant frame time** → per-frame cull + interactable FOV + palm text + height lerp
- [ ] **Degrades over time, never recovers** → too many enabled bars; tune `cullMaxDistance` / `gridSize`

---

## Suggested order

1. [ ] Inspector: `gridSize` 30, `cullMaxDistance` 500, `smoothPasses` 1, `neighborSpreadRings` 1
2. [ ] Inspector: `barHeightMoveSmooth` 0, bump all `cullFovCheck*` intervals
3. [ ] Code: cache interactable FOV + palm text dirty-check
4. [ ] Re-profile; then heavier items if still over budget

---

## Done (v1)

- [x] Central grid loop (single `UpdateEvent` on `CoverageGridManager`)
- [x] FOV + distance cull with tiered FOV intervals
- [x] Tiered visual sync (near / mid / far)
- [x] Staggered spawn (1 prefab / frame)
- [x] Interactable disable beyond pinch distance
