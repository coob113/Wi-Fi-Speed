# Wi-Fi Speed Web

Cloudflare Pages app for viewing published Wi-Fi Speed coverage maps by six digit PIN.

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
