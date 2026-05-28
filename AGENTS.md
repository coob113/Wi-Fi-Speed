# Agent context — Wi-Fi Speed

Public Spectacles lens repo. Lens project: **`WiFi Speed/WiFi Speed.esproj`**.

## Product

Walk a space → HTTPS download probes → 3D coverage bars + left-palm UI + pinch details.

Snap Cloud storage hosts the test file (`speedtest/10mb.bin`). Committed `SupabaseProject InternetSpeed.supabaseProject` is wired in scene; replacement steps are in root **README.md**.

## Scripts

`ConnectionProbe`, `CoverageGridManager`, `CoveragePalmUi`, `RecordMarker`, `SnapCloudRequirements`, `OnboardingController`, `CoverageMetrics` — under `WiFi Speed/Assets/Scripts/`.

## Conventions

- TypeScript `@component` scripts; scene wiring is manual in Lens Studio
- `Cache/`, `Workspaces/`, `PluginsUserPreferences/` are gitignored by Lens Studio

## Roadmap (public)

Coverage maps viewable on the web — no internal spec in this repo.
