# Agent context — Wi-Fi Speed

Public Spectacles lens repo. Lens project: **`WiFi Speed/WiFi Speed.esproj`**.

## Product

Walk a space → HTTPS download probes → 3D coverage bars + left-palm UI + pinch details → optional Cloudflare web publishing by PIN.

Speed probes download a public test file. `ConnectionProbe.downloadUrl` can point directly to any public HTTPS file, or `SnapCloudRequirements` can build a public Snap Cloud storage URL for `speedtest/10mb.bin`. Map publishing and PIN lookup use the Cloudflare Pages/D1 backend in `web/`; the Lens does not need Cloudflare credentials.

## Scripts

`ConnectionProbe`, `CoverageGridManager`, `CoveragePalmUi`, `CoveragePublishController`, `RecordMarker`, `SnapCloudRequirements`, `OnboardingController`, `CoverageMetrics` — under `WiFi Speed/Assets/Scripts/`.

## Conventions

- TypeScript `@component` scripts; scene wiring is manual in Lens Studio
- `Cache/`, `Workspaces/`, `PluginsUserPreferences/` are gitignored by Lens Studio

## Roadmap (public)

Coverage maps are viewable on the web through Cloudflare Pages Functions and D1.
