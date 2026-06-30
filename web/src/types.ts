export type CoverageCell = {
  key: string
  x: number
  z: number
  displayMbps: number
  sessionPct: number
  bracketIndex: number
  label: string
  sampleCount: number
  directSampleCount: number
  hasOwnRecording: boolean
  isDeadZone: boolean
  directSamples: number[]
}

export type CoverageSnapshot = {
  schemaVersion: number
  createdAtMs: number
  gridSize: number
  sessionMinMbps: number
  sessionMaxMbps: number
  cellCount: number
  directCellCount: number
  bounds: {
    minX: number
    maxX: number
    minZ: number
    maxZ: number
  }
  cells: CoverageCell[]
}

export type PublishedMap = {
  pin: string
  createdAt: string
  expiresAt: string
  snapshot: CoverageSnapshot
}
