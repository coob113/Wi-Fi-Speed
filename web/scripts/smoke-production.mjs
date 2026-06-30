import {execFile} from "node:child_process"
import {fileURLToPath} from "node:url"
import {dirname, resolve} from "node:path"
import {promisify} from "node:util"

const execFileAsync = promisify(execFile)

const scriptDir = dirname(fileURLToPath(import.meta.url))
const webDir = resolve(scriptDir, "..")
const baseUrl = (process.env.WIFI_SPEED_BASE_URL || "https://wifi.familybusiness.studio").replace(/\/+$/, "")
const databaseName = process.env.WIFI_SPEED_D1_DATABASE || "wifi-speed-maps"

let pin = ""

try {
  console.log(`[smoke] POST ${baseUrl}/api/publish`)
  const publishResponse = await fetch(`${baseUrl}/api/publish`, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({
      expiresInDays: 1,
      snapshot: createTinySnapshot(),
    }),
  })

  const publishText = await publishResponse.text()
  if (!publishResponse.ok) {
    throw new Error(`publish failed: HTTP ${publishResponse.status} ${publishText}`)
  }

  const publishJson = parseJson(publishText, "publish response")
  pin = String(publishJson.pin || "")
  if (!/^\d{6}$/.test(pin)) {
    throw new Error(`publish returned invalid PIN: ${pin || "(empty)"}`)
  }
  console.log(`[smoke] PIN ${pin}`)

  console.log(`[smoke] GET ${baseUrl}/api/maps/${pin}`)
  const mapResponse = await fetch(`${baseUrl}/api/maps/${pin}`)
  const mapText = await mapResponse.text()
  if (!mapResponse.ok) {
    throw new Error(`map fetch failed: HTTP ${mapResponse.status} ${mapText}`)
  }

  const mapJson = parseJson(mapText, "map response")
  if (mapJson.pin !== pin) {
    throw new Error(`map response PIN mismatch: expected ${pin}, got ${mapJson.pin}`)
  }
  if (!mapJson.snapshot || mapJson.snapshot.schemaVersion !== 1 || !Array.isArray(mapJson.snapshot.cells)) {
    throw new Error("map response snapshot shape is invalid")
  }

  console.log("[smoke] production publish/read passed")
} finally {
  if (pin) {
    await deleteSmokeRow(pin)
  }
}

function createTinySnapshot() {
  const now = Date.now()
  return {
    schemaVersion: 1,
    createdAtMs: now,
    gridSize: 1,
    sessionMinMbps: 0,
    sessionMaxMbps: 0,
    cellCount: 0,
    directCellCount: 0,
    bounds: {minX: 0, maxX: 0, minZ: 0, maxZ: 0},
    cells: [],
  }
}

function parseJson(text, label) {
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new Error(`${label} is not JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function deleteSmokeRow(pinToDelete) {
  console.log(`[smoke] deleting test row ${pinToDelete}`)
  const command = `DELETE FROM maps WHERE pin = '${pinToDelete}'`
  const {stdout, stderr} = await execFileAsync(
    "npx",
    ["wrangler", "d1", "execute", databaseName, "--remote", "--command", command],
    {cwd: webDir}
  )

  if (stdout.trim()) {
    console.log(stdout.trim())
  }
  if (stderr.trim()) {
    console.error(stderr.trim())
  }
}
