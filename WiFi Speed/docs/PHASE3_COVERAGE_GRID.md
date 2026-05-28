# Phase 3: Coverage grid visualization

Spatial map of download Mbps on a world **XZ** grid (10 cm units by default — set `gridSize` on the manager).

## Scripts

| Script | Where |
|--------|--------|
| `RecordMarker.ts` | **Record** prefab root |
| `CoverageGridManager.ts` | Empty scene object (e.g. `CoverageGrid`) |
| `ConnectionProbe.ts` | Already on scene — wire two new optional inputs |

## Record prefab

1. Select **Record** prefab root.
2. Add component **RecordMarker**.
3. Wire **Label Text** → child **Text** component (not the parent object name).

## Scene

1. Create empty object **CoverageGrid** → add **CoverageGridManager**.
2. Wire:
   - **Record Prefab** → `Assets/Record.prefab`
   - **Records Parent** → same empty object (or a child folder object)
   - **Look At Target** → **Camera** or **Device Tracking** scene object (user head)
3. On **ConnectionProbe**:
   - **Coverage Grid** → `CoverageGrid` object’s manager
   - **Position Source** → same as look-at target (where you stand when the sample finishes)

Optional tuning on manager: `gridSize` (10 cm), height offsets (all **cm**, relative to smoothed `lookAtTarget` Y):

- `heightReferenceOffset` **-30** / `heightBandMaxOffset` **-10** — cm below user; tracked anchor **stays fixed** while inside that band (walking on flat ground)
- `heightBandCatchUpSmooth` **2** — when user Y moves (stairs), anchor slowly re-enters band
- `yAtMaxMbps` **-10** / `yAtMinMbps` **-40** — extra offset by session % on top of tracked anchor

**Y** height and **%** label use **smoothed** median: weighted 8-neighbor blend (`smoothPasses` default 2).
- Global min/max for % and height are computed from smoothed values.
- Markers rotate each frame to face **Look At Target**.

Failed downloads do not create or update markers.
