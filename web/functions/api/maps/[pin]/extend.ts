type Env = {
  DB: D1Database
}

type StoredMap = {
  pin: string
  expires_at: string
}

const EXTEND_DAYS = 30

export const onRequestPost: PagesFunction<Env> = async ({params, env}) => {
  const pin = String(params.pin || "")
  if (!/^\d{6}$/.test(pin)) {
    return json({error: "Invalid PIN"}, 400)
  }

  const row = await env.DB.prepare(
    "SELECT pin, expires_at FROM maps WHERE pin = ?"
  )
    .bind(pin)
    .first<StoredMap>()

  if (!row) {
    return json({error: "Map not found"}, 404)
  }

  const currentExpiresAtMs = new Date(row.expires_at).getTime()
  const extendedExpiresAtMs = Date.now() + EXTEND_DAYS * 24 * 60 * 60 * 1000
  const nextExpiresAt = new Date(Math.max(currentExpiresAtMs, extendedExpiresAtMs))

  await env.DB.prepare("UPDATE maps SET expires_at = ? WHERE pin = ?")
    .bind(nextExpiresAt.toISOString(), pin)
    .run()

  return json({
    pin,
    expiresAt: nextExpiresAt.toISOString(),
  })
}

export const onRequestOptions: PagesFunction<Env> = async () => {
  return new Response(null, {status: 204, headers: corsHeaders()})
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
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
