# Phase 1: Local (LAN) + remote probe

**Requires:** Experimental APIs enabled in Lens Studio (Project Settings) for `http://` LAN requests.

## Lens settings

1. **Project → Project Settings → Experimental APIs** — enable.
2. Preview **Device Type Override = Spectacles**.

## Local target

Set **Local Ping Url** on the `ConnectionProbe` component (Inspector).

| Target | Example URL | Notes |
|--------|-------------|--------|
| Router | `http://192.168.1.1/` | Use your router’s LAN IP (often `.1.1` or `.0.1`) |
| Laptop | `http://192.168.1.42:8080/` | Run a tiny server on your Mac (see below) |

**L:** local RTT (Wi‑Fi + LAN). **R:** remote HTTPS. **net:+N** ≈ internet leg (remote − local).

## Optional: laptop ping server

On your Mac (same Wi‑Fi as Spectacles):

```bash
python3 -m http.server 8080 --bind 0.0.0.0
```

Then set Local Ping Url to `http://<your-mac-lan-ip>:8080/` (find IP in System Settings → Network).

## Reading coverage

- **L** spikes or **error** in a spot → local Wi‑Fi / LAN path is weak.
- **R** stable but **L** bad → coverage issue, not “the whole internet.”
- **net:+** mostly stable while **L** varies → spatial Wi‑Fi signal matters.

Next phase: attach **position** per sample for a heatmap.
