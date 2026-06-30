# Wi-Fi Speed Web

Cloudflare Pages app for viewing published Wi-Fi Speed coverage maps by six digit PIN.

Demo: https://www.youtube.com/watch?v=72Gr3HF7yRA

Latest publishing and web viewer update: https://youtu.be/DLD1hkpAsLQ

Production viewer: https://wifi.familybusiness.studio/

The web viewer is part of the open-source Wi-Fi Speed Spectacles project. It renders published scan snapshots as an inspectable 3D model with stats, selected-point details, record navigation, view presets, and shareable PIN links.

## Features

- Load a published map with `?pin=971588`
- Inspect orthographic 3D coverage bars with rotate, pan, zoom, and view presets
- Distinguish directly recorded points from inferred cells
- Navigate weakest, strongest, and recorded points from the sidebar
- Share links to a full map or a selected cell
- Extend map expiration from the viewer
- Show graceful loading, empty, low-data, expired, not-found, and network states

## Local development

```sh
npm install
npm run build
```

For local Pages Functions with D1:

```sh
npm run d1:init
npm run build
npm run pages:dev
```

## Cloudflare setup

1. Create a D1 database named `wifi-speed-maps`.
2. Replace the placeholder `database_id` in `wrangler.jsonc`.
3. Apply the schema:

```sh
npm run d1:apply
```

4. Create a Cloudflare Pages project with this folder as the project root:
   - Root directory: `web`
   - Build command: `npm run build`
   - Build output directory: `dist`
5. Add a D1 binding named `DB` that points to `wifi-speed-maps`.

The Lens publish URL should be:

```text
https://<your-pages-domain>/api/publish
```

Published maps are snapshot-only and expire after at most 30 days. Access is PIN-only.

The viewer can extend a map's expiration through:

```text
POST /api/maps/:pin/extend
```

The backend only moves `expires_at` later; it never shortens an existing retention window.

## Expired map cleanup

Deploy the scheduled cleanup Worker after the D1 database is configured:

```sh
npm run cleanup:deploy
```

It runs daily at 03:00 UTC and deletes rows whose `expires_at` timestamp is in the past.

## Production smoke test

After deploying Pages, verify production publish/read/delete with:

```sh
npm run smoke:production
```

By default this targets `https://wifi.familybusiness.studio` and `wifi-speed-maps`. Override them with `WIFI_SPEED_BASE_URL` and `WIFI_SPEED_D1_DATABASE` if needed.
