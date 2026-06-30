type Env = {
  DB: D1Database
}

const CLEANUP_EVENT = "expired_maps_cleanup"

export default {
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(cleanupExpiredMaps(env))
  },

  async fetch() {
    return new Response("Not found", {status: 404})
  },
} satisfies ExportedHandler<Env>

async function cleanupExpiredMaps(env: Env): Promise<void> {
  const now = new Date().toISOString()
  const result = await env.DB.prepare("DELETE FROM maps WHERE expires_at <= ?").bind(now).run()
  const deleted = result.meta?.changes ?? 0
  console.log(JSON.stringify({event: CLEANUP_EVENT, deleted, now}))
}
