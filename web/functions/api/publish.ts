import type {CoverageSnapshot} from "../../src/types"

type Env = {
  DB: D1Database
}

type PublishBody = {
  expiresInDays?: number
  snapshot?: CoverageSnapshot
}

const MAX_EXPIRY_DAYS = 30
const MAX_PAYLOAD_BYTES = 256 * 1024
const MAX_CELLS = 5000

export const onRequestPost: PagesFunction<Env> = async ({request, env}) => {
  let raw = ""
  try {
    raw = await request.text()
  } catch (_e) {
    return json({error: "Could not read body"}, 400)
  }

  if (new TextEncoder().encode(raw).length > MAX_PAYLOAD_BYTES) {
    return json({error: "Map is too large"}, 413)
  }

  let body: PublishBody
  try {
    body = JSON.parse(raw) as PublishBody
  } catch (_e) {
    return json({error: "Invalid JSON"}, 400)
  }

  const snapshot = body.snapshot
  const validationError = validateSnapshot(snapshot)
  if (validationError) {
    return json({error: validationError}, 400)
  }

  const expiresInDays = clampDays(body.expiresInDays)
  const now = new Date()
  const expiresAt = new Date(now.getTime() + expiresInDays * 24 * 60 * 60 * 1000)
  const payloadJson = JSON.stringify(snapshot)

  for (let attempt = 0; attempt < 10; attempt++) {
    const pin = generatePin()
    try {
      await env.DB.prepare(
        "INSERT INTO maps (pin, created_at, expires_at, schema_version, payload_json) VALUES (?, ?, ?, ?, ?)"
      )
        .bind(pin, now.toISOString(), expiresAt.toISOString(), snapshot!.schemaVersion, payloadJson)
        .run()

      return json({
        pin,
        createdAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
      })
    } catch (_e) {
      // PIN collision; retry with another six digit code.
    }
  }

  return json({error: "Could not allocate PIN"}, 503)
}

export const onRequestOptions: PagesFunction<Env> = async () => {
  return new Response(null, {status: 204, headers: corsHeaders()})
}

function validateSnapshot(snapshot: CoverageSnapshot | undefined): string {
  if (!snapshot || typeof snapshot !== "object") {
    return "Missing snapshot"
  }
  if (snapshot.schemaVersion !== 1) {
    return "Unsupported schema version"
  }
  if (!Array.isArray(snapshot.cells)) {
    return "Missing cells"
  }
  if (snapshot.cells.length === 0 || snapshot.cells.length > MAX_CELLS) {
    return "Invalid cell count"
  }
  if (snapshot.directCellCount < 1) {
    return "No direct scan cells"
  }
  for (const cell of snapshot.cells) {
    if (!Number.isFinite(cell.x) || !Number.isFinite(cell.z)) {
      return "Invalid cell position"
    }
    if (!Number.isFinite(cell.displayMbps) || cell.displayMbps < 0) {
      return "Invalid Mbps value"
    }
    if (!Number.isFinite(cell.sessionPct) || cell.sessionPct < 0 || cell.sessionPct > 100) {
      return "Invalid session percent"
    }
    if (!Array.isArray(cell.directSamples)) {
      return "Invalid direct samples"
    }
  }
  return ""
}

function clampDays(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return MAX_EXPIRY_DAYS
  }
  return Math.max(1, Math.min(MAX_EXPIRY_DAYS, Math.round(value as number)))
}

function generatePin(): string {
  const array = new Uint32Array(1)
  crypto.getRandomValues(array)
  return String(array[0] % 1000000).padStart(6, "0")
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(),
    },
  })
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  }
}
