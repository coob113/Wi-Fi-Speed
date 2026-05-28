# Phase 1: Snap Cloud hosted speedtest

Online HTTPS download — no laptop IP or Experimental APIs.

## Verified in repo

| Item | Status |
|------|--------|
| `SupabaseProject InternetSpeed.supabaseProject` | Present |
| Project URL | `https://vbneppbpjchegvljmcdq.snapcloud.dev` |
| Public file URL (expected) | `https://vbneppbpjchegvljmcdq.snapcloud.dev/storage/v1/object/public/speedtest/10mb.bin` |

**HTTP check from this machine:** `403 Forbidden` on that URL — project exists, but storage is not publicly readable yet. Fix policies below, then re-test in a browser.

## Lens wiring (you)

### 1. SnapCloud object

1. Empty scene object **SnapCloud**.
2. Add script **SnapCloudRequirements** (`Assets/Scripts/SnapCloudRequirements.ts`).
3. **Supabase Project** → drag `SupabaseProject InternetSpeed` from Assets.

### 2. ConnectionProbe

On **ConnectionProbe** component:

| Input | Value |
|-------|--------|
| **Snap Cloud** | `SnapCloud` object (SnapCloudRequirements) |
| **Storage Bucket** | `speedtest` (must match dashboard bucket name) |
| **Storage Object Path** | `10mb.bin` |
| **Download Url** | *leave empty* (uses Snap Cloud) |
| **Expected Bytes** | `10240000` |

Or set **Download Url** manually to the full public URL above (override).

### 3. Preview

- **Device Type Override = Spectacles**
- Logger should print the resolved URL on start, then `L:… Mbps ok`.

## Fix 403 on storage (dashboard)

1. Snap Cloud dashboard → **Storage** → bucket `speedtest`.
2. Confirm **Public bucket** is enabled.
3. Confirm `10mb.bin` is uploaded (≈10,240,000 bytes).
4. **Policies** → allow **public read** on that bucket (anon `SELECT` on `storage.objects` for bucket `speedtest`).  
   The example “authenticated users only” template blocks anonymous `fetch` from the Lens.

**Browser test:** open the public URL — must download ~10 MB, not 403.

## Scripts

- `SnapCloudRequirements.ts` — from Snap Cloud example + `getPublicStorageUrl()`
- `ConnectionProbe.ts` — builds URL from Snap Cloud when **Download Url** is empty

## Fallback

LAN laptop server still works: set **Download Url** to `http://<mac-ip>:8080/10mb.bin` and enable Experimental APIs.

## Supabase MCP (Cursor)

Project `.cursor/mcp.json` includes:

```json
"supabase": {
  "url": "http://localhost:8080/mcp?project_ref=vbneppbpjchegvljmcdq"
}
```

1. Ensure the MCP server on port **8080** is running (Snap/Supabase plugin or CLI).
2. **Cursor → Settings → Tools & MCP** — enable **supabase**, then reload the window.
3. Ask the agent to use MCP for storage buckets, SQL policies, or logs.

Hosted alternative: `https://mcp.supabase.com/mcp?project_ref=vbneppbpjchegvljmcdq` (browser login once).
