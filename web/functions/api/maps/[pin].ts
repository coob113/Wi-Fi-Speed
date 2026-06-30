import type {CoverageSnapshot, PublishedMap} from "../../../src/types"

type Env = {
  DB: D1Database
}

type StoredMap = {
  pin: string
  created_at: string
  expires_at: string
  payload_json: string
}

export const onRequestGet: PagesFunction<Env> = async ({params, env}) => {
  const pin = String(params.pin || "")
  if (!/^\d{6}$/.test(pin)) {
    return json({error: "Invalid PIN"}, 400)
  }

  const row = await env.DB.prepare(
    "SELECT pin, created_at, expires_at, payload_json FROM maps WHERE pin = ?"
  )
    .bind(pin)
    .first<StoredMap>()

  if (!row) {
    return json({error: "Map not found"}, 404)
  }

  if (new Date(row.expires_at).getTime() <= Date.now()) {
    return json({error: "Map expired"}, 410)
  }

  let snapshot: CoverageSnapshot
  try {
    snapshot = JSON.parse(row.payload_json) as CoverageSnapshot
  } catch (_e) {
    return json({error: "Stored map is invalid"}, 500)
  }

  const map: PublishedMap = {
    pin: row.pin,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    snapshot,
  }

  return json(map)
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": status === 200 ? "private, max-age=30" : "no-store",
    },
  })
}
