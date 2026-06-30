<div align="center">

<img src="docs/images/logo.png" alt="Wi-Fi Speed" width="280">

# Wi-Fi Speed

**Snap Spectacles that map Wi-Fi coverage as you walk — probe, pin, and read signal quality from your palm.**

[![Watch the demo](https://img.shields.io/badge/▶-Watch_the_demo-red?style=for-the-badge)](https://www.youtube.com/watch?v=72Gr3HF7yRA)
[![Latest update](https://img.shields.io/badge/Latest_update-Publishing_+_web_view-yellow?style=for-the-badge)](https://youtu.be/DLD1hkpAsLQ)
[![Open web viewer](https://img.shields.io/badge/Web_viewer-wifi.familybusiness.studio-yellow?style=for-the-badge)](https://wifi.familybusiness.studio/)
[![Open in Lens Studio](https://img.shields.io/badge/Lens_Studio-5.15.4+-orange?style=for-the-badge)](https://ar.snap.com/lens-studio)

*Walk a space. See where download speed is good — and where it isn't.*

</div>

---

## Table of contents

- [Demo video](#demo-video)
- [Latest update](#latest-update)
- [Overview](#overview)
- [How it works](#how-it-works)
- [Web viewer](#web-viewer)
- [Project structure](#project-structure)
- [Main scripts](#main-scripts)
- [Tech stack](#tech-stack)
- [Getting started](#getting-started)
- [Run it locally](#run-it-locally)
- [Configure the speedtest file](#configure-the-speedtest-file)
- [Backend and credentials](#backend-and-credentials)
- [License](#license)

---

## Demo video

<div align="center" id="demo-video">

[![Wi-Fi Speed demo video](https://img.youtube.com/vi/72Gr3HF7yRA/hqdefault.jpg)](https://www.youtube.com/watch?v=72Gr3HF7yRA)

[Watch the demo on YouTube](https://www.youtube.com/watch?v=72Gr3HF7yRA)

</div>

---

## Latest update

Publishing and web viewing were added so scans can be opened outside Spectacles with a six digit PIN.

<div align="center">

[![Publishing and web viewer update](https://img.youtube.com/vi/DLD1hkpAsLQ/hqdefault.jpg)](https://youtu.be/DLD1hkpAsLQ)

[Watch the publishing and web viewer update](https://youtu.be/DLD1hkpAsLQ)

</div>

---

## Overview

Wi-Fi Speed turns a Spectacles walkthrough into a **live coverage map**. As you move, the lens measures download speed and shows results as colored bars in your space — plus speed and quality on your left palm. Published scans can also be opened in a browser by PIN.

No laptop server. No manual logging. Just walk and read the map.

### Why

Phone speedtests give you one number at one spot. Wi-Fi actually varies by room, wall, and where you stand — but there's no simple way to *see* that in AR while you're moving.

This lens answers: *"Where in this space is download actually good?"*

### Features

- **Walk and map** — signal bars appear as you move through a space
- **Color-coded quality** — see good and weak spots at a glance
- **Left-palm UI** — latest speed, quality, and hints while you walk
- **Pinch for detail** — open a spot for Mbps, quality label, and record count
- **Web sharing** — publish a snapshot, open it with a six digit PIN, and inspect the 3D map in a browser
- **Onboarding** — short first-run tour (see [Getting started](#getting-started))

---

## How it works

```
┌──────────────────┐         ┌──────────────────┐
│  SPECTACLES      │ ──────► │  PUBLIC FILE     │
│  walk + probe    │  HTTPS  │  public storage  │
│  (Lens Studio)   │  fetch  │  10mb.bin        │
└──────────────────┘         │                  │
         │                   └──────────────────┘
         ▼
┌──────────────────┐         ┌──────────────────┐
│  ON-DEVICE MAP   │ ──────► │  CLOUDFLARE      │
│  grid · pins ·   │ publish │  Pages + D1      │
│  palm UI         │  JSON   │  PIN viewer      │
└──────────────────┘         └──────────────────┘
```

1. **ConnectionProbe** resolves a public HTTPS download URL and runs a fetch with optional warmup + timed measure window. The URL can come from a Snap Cloud public storage asset or from the `downloadUrl` override.
2. **CoverageGridManager** records each good sample at a floor grid cell and spawns/updates a **Record** prefab pin.
3. Cell **weighted median** drives pin height, color bracket, and quality label via **CoverageMetrics**.
4. **CoveragePalmUi** shows probe progress, last Mbps, coaching hints, and an arrow toward stronger cells on the left palm.
5. Pinch a pin → **RecordMarker** detail panel (Mbps, session %, bracket, record count).
6. Optional publish sends a snapshot to the public Cloudflare Pages API and returns a six digit PIN for browser viewing.

*Download speed is measured on-device (10 MB HTTPS file); results may differ from phone speedtest apps.*

---

## Web viewer

The browser viewer lives in [`web/`](web/) and is deployed at:

```text
https://wifi.familybusiness.studio/
```

Open a published map with:

```text
https://wifi.familybusiness.studio/?pin=971588
```

The viewer includes:

- Orthographic Three.js coverage bars with rotate, pan, zoom, reset, and view presets
- Direct vs inferred cells, hover/select states, and per-cell details
- Best / worst / average speed summary and scan age
- Weakest, strongest, and recorded-point navigation
- Shareable selected-cell links, for example `?pin=971588&cell=20,-40`
- Expiration status and an extend action for keeping a published map available

Published maps are stored as snapshot JSON in Cloudflare D1 and are accessed by PIN only.

---

## Project structure

```
Wi-Fi Speed/
├── README.md
├── LICENSE
├── AGENTS.md                 # brief agent context
├── docs/images/              # logo, onboarding screenshots for GitHub
├── web/                      # Cloudflare Pages viewer + D1 API
└── WiFi Speed/               # Lens Studio project
    ├── WiFi Speed.esproj
    ├── icon.png
    ├── testdata/             # 100kb.bin, 10mb.bin (host 10mb.bin at any public HTTPS URL)
    ├── Assets/
    │   ├── Scene.scene
    │   ├── Record.prefab     # coverage pin (bar + pinch panel + VisualSphere)
    │   ├── Meshes/           # Cone, Cylinder, Sphere
    │   ├── Materials/        # bracket colors (0–10 … 90–100), UI mats
    │   ├── Images/           # onboarding PNGs + image materials
    │   ├── Scripts/          # TypeScript components (see below)
    │   └── SupabaseClient.lspkg
    └── Packages/
        ├── SpectaclesInteractionKit.lspkg
        ├── SpectaclesUIKit.lspkg
        └── Utilities.lspkg
```

Key scene objects: **`ConnectionProbe`**, **`CoverageGridManager`**, **`CoveragePalmUi`**, **`CoveragePublishController`**, **`OnboardingController`**, and optionally **`SnapCloud`** when using Snap Cloud as the speedtest file host.

---

## Main scripts

All TypeScript lives in `WiFi Speed/Assets/Scripts/`.

| Script | Role |
|--------|------|
| **`ConnectionProbe.ts`** | Download speedtest loop. Resolves URL from `downloadUrl` or **SnapCloudRequirements**, runs ranged HTTPS fetch with warmup/measure windows, computes Mbps, discards samples if user moved too far (`maxTravelDistance`), forwards good samples to the grid. |
| **`CoverageGridManager.ts`** | Floor grid (`gridSize`), cell snapping, weighted median per cell, neighbor spread, FOV culling, spawns **Record** prefabs. Tracks session min/max Mbps for relative quality. |
| **`RecordMarker.ts`** | Per-pin behavior: bracket material + bar height from session %, pinch panel (header/secondary text), hover/select scale on **VisualSphere**, dead-zone warnings, registers with grid on update. |
| **`CoveragePalmUi.ts`** | Left-palm HUD: probe progress bar, status line, Mbps / session %, coaching hints (stay / move / retry), arrow toward best cells. Gates visibility on left palm pose. |
| **`CoveragePublishController.ts`** | Publishes the current grid snapshot to the Cloudflare Pages API and displays the returned six digit PIN on the right-palm UI. |
| **`CoverageMetrics.ts`** | Shared math: weighted median, session %, quality brackets (Good / OK / Poor), dead-zone detection, color helpers. No scene inputs — imported by other scripts. |
| **`SnapCloudRequirements.ts`** | Optional helper for building public Snap Cloud storage URLs for `ConnectionProbe`. Not used for map publishing. |
| **`OnboardingController.ts`** | First-run slide tour (UIKit Frame + prev/next), persists dismiss in **PersistentStorage**, optional triggers tied to grid/palm events. |

Data flow:

```
ConnectionProbe → CoverageGridManager → RecordMarker (prefab instances)
        ↓                    ↓
  CoveragePalmUi      CoverageMetrics (shared)
```

---

## Tech stack

- **Platform** — Snap Spectacles, Lens Studio **5.15.4+**
- **Language** — TypeScript (`Assets/Scripts/`)
- **Hand / pinch UI** — Spectacles Interaction Kit (SIK)
- **Onboarding frame & buttons** — Spectacles UIKit (`Frame`, `RectangleButton`)
- **Speedtest file** — any public HTTPS file around 10 MB; Snap Cloud public storage is one supported option
- **Mapping** — on-device grid + median smoothing; published snapshots stored in Cloudflare D1
- **Web viewer** — Cloudflare Pages Functions, D1, Vite, Three.js

---

## Getting started

First launch shows a short onboarding flow. Five steps:

### 1. Map your space

The lens tests Wi‑Fi speed as you walk and shows signal strength in your space.

<div align="center">
<img src="docs/images/onboarding-1-map.png" alt="3D coverage map with signal bars" width="300">
</div>

### 2. Walk slowly

Slowly walk around to test your Wi‑Fi signal. Bars appear where probes succeed — taller and bluer means stronger download in your session.

<div align="center">
<img src="docs/images/onboarding-2-walk.png" alt="Walk to collect signal samples" width="300">
</div>

### 3. Open your palm

Turn your left palm toward you to see your latest speed and quality — progress while scanning, Mbps, session %, and hints.

<div align="center">
<img src="docs/images/onboarding-3-palm.png" alt="Left palm UI with speed and quality" width="300">
</div>

### 4. Pinch a bar

Pinch any bar to open details for that spot — Mbps, quality label, record count.

<div align="center">
<img src="docs/images/onboarding-4-pinch.png" alt="Pinch a bar for spot details" width="300">
</div>

### 5. Open your right palm

Turn your right palm toward you to publish the current coverage map and get a six digit PIN for the web viewer.

<div align="center">
<img src="docs/images/onboarding-5-web-pin.png" alt="Right palm web viewer PIN" width="300">
</div>

Onboarding dismisses after the tour (stored on-device — won't show again unless reset).

---

## Run it locally

1. Clone this repo.
2. Open **`WiFi Speed/WiFi Speed.esproj`** in Lens Studio 5.
3. Set **Device Type Override → Spectacles** for preview.
4. **File → Send To → Spectacles** (or use device preview).
5. Walk — probes start automatically; open left palm for status.

For speed testing, `ConnectionProbe` needs a public HTTPS file. You can either set `downloadUrl` directly or wire `SnapCloudRequirements` to a public Snap Cloud storage file.

Map publishing uses the public Cloudflare Pages endpoint configured in `CoveragePublishController.publishUrl`; the Lens does not need Cloudflare credentials.

Local Cloudflare Wrangler configs and imported Snap Cloud project assets are gitignored for public sharing. Your local files can stay on disk; forks should copy the example configs and import their own project assets.

---

## Configure the speedtest file

The lens measures speed by downloading a file, not by calling a private speedtest service. The simplest setup is to host `WiFi Speed/testdata/10mb.bin` somewhere public over HTTPS and paste that URL into **`ConnectionProbe.downloadUrl`**.

Snap Cloud public storage is still supported if you prefer to host the test file inside Snap's tooling:

### 1. Create storage

In [Snap Cloud Console](https://kit.snapchat.com/manage/snap-cloud):

1. **Storage → New bucket** — name **`speedtest`**, enable **Public bucket**.
2. Upload **`WiFi Speed/testdata/10mb.bin`** (~10 MB).
3. **Policies** — allow public read (otherwise probes fail with **403**).

Browser check — this URL must download the file, not return 403:

```text
https://<your-project-ref>.snapcloud.dev/storage/v1/object/public/speedtest/10mb.bin
```

### 2. Import the public storage project in Lens Studio

1. **Window → Supabase** → log in → select your project → **Import Credentials**.
2. This creates a **SupabaseProject** asset under Assets. It is used here only to build a public storage URL for the test file.

### 3. Wire the scene

1. Select **`SnapCloud`** → **SnapCloudRequirements → Supabase Project** → your new asset.
2. On **`ConnectionProbe`**, confirm **Snap Cloud** points to `SnapCloud`, bucket **`speedtest`**, path **`10mb.bin`**, and **Download Url** is empty.
3. Save scene → preview on Spectacles.

**Alternative:** set **Download Url** on ConnectionProbe to any public HTTPS URL for a ~10 MB file.

---

## Backend and credentials

Published maps use the Cloudflare backend in [`web/`](web/):

- `POST /api/publish` stores a snapshot in Cloudflare D1 and returns a PIN.
- `GET /api/maps/:pin` reads a published snapshot by PIN.
- `POST /api/maps/:pin/extend` extends a map's expiration.

The Lens calls these public HTTPS endpoints. It does **not** contain Cloudflare API tokens, D1 credentials, or account credentials. Cloudflare credentials are only needed by the project maintainer when deploying or managing the backend with Wrangler. The production URL in this repo is a public endpoint, not a secret.

Open-source forks should create their own Cloudflare Pages project and D1 database, then point `CoveragePublishController.publishUrl` at their own `/api/publish` endpoint. See [`web/README.md`](web/README.md) for setup.

---

## Publish and view maps on the web

The Lens can publish a coverage snapshot to the Cloudflare Pages backend. The backend stores it in D1 and returns a six digit PIN. Use the PIN in the web viewer to inspect or share the scan.

For deployment and local development details, see [`web/README.md`](web/README.md).

---

## License

[MIT](LICENSE) — Copyright (c) 2026 coob113
