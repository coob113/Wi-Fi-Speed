export type QualityLabel = "Good" | "OK" | "Poor"

export const DEFAULT_GOOD_PCT = 70
export const DEFAULT_OK_PCT = 35
export const DEFAULT_DEAD_ZONE_MBPS = 1
export const DEFAULT_DEAD_ZONE_SESSION_PCT = 1
export const DEFAULT_DEAD_ZONE_MIN_SAMPLES = 3
export const DEFAULT_SESSION_SPREAD_MIN_MBPS = 1

export type DeadZoneInput = {
  sampleCount: number
  displayMbps: number
  sessionPct: number
  sessionSpreadMbps: number
  deadZoneMbps?: number
  deadZoneSessionPct?: number
  deadZoneMinSamples?: number
  sessionSpreadMinMbps?: number
}

export type WeightedSample = {
  mbps: number
  weight: number
}

export function median(values: number[]): number {
  if (!values || values.length === 0) {
    return -1
  }
  const sorted = values.slice().sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2
  }
  return sorted[mid]
}

export function weightedMedian(samples: WeightedSample[]): number {
  if (!samples || samples.length === 0) {
    return -1
  }

  const valid: WeightedSample[] = []
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i]
    if (sample.weight > 0 && sample.mbps >= 0) {
      valid.push(sample)
    }
  }

  if (valid.length === 0) {
    return -1
  }
  if (valid.length === 1) {
    return valid[0].mbps
  }

  const sorted = valid.slice().sort((a, b) => a.mbps - b.mbps)
  let totalWeight = 0
  for (let i = 0; i < sorted.length; i++) {
    totalWeight += sorted[i].weight
  }

  const target = totalWeight / 2
  let cumulative = 0
  for (let i = 0; i < sorted.length; i++) {
    cumulative += sorted[i].weight
    if (cumulative >= target) {
      return sorted[i].mbps
    }
  }

  return sorted[sorted.length - 1].mbps
}

export function sessionPercent(mbps: number, minMbps: number, maxMbps: number): number {
  if (!isFinite(minMbps) || !isFinite(maxMbps) || maxMbps <= minMbps) {
    return 100
  }
  return ((mbps - minMbps) / (maxMbps - minMbps)) * 100
}

export function clampPercent(pct: number): number {
  return Math.max(0, Math.min(100, pct))
}

export function qualityLabel(
  pct: number,
  goodPct: number = DEFAULT_GOOD_PCT,
  okPct: number = DEFAULT_OK_PCT
): QualityLabel {
  if (pct >= goodPct) {
    return "Good"
  }
  if (pct >= okPct) {
    return "OK"
  }
  return "Poor"
}

export function bracketIndex(pct: number): number {
  return Math.min(9, Math.max(0, Math.floor(clampPercent(pct) / 10)))
}

export const DEFAULT_HEADER_TEXT_COLOR = new vec4(1, 1, 1, 1)

/** Text fill color from the same material array used for pin bar brackets. */
export function colorFromBracketMaterial(
  materials: Material[] | null | undefined,
  bracketIdx: number,
  fallback: vec4 = DEFAULT_HEADER_TEXT_COLOR
): vec4 {
  if (!materials || materials.length === 0) {
    return fallback
  }

  const idx = Math.min(9, Math.max(0, bracketIdx))
  const material = materials[idx]
  if (!material || !material.mainPass) {
    return fallback
  }

  const c = material.mainPass.baseColor
  return new vec4(c.x, c.y, c.z, 1)
}

export function colorForSessionPercent(
  materials: Material[] | null | undefined,
  pct: number,
  fallback: vec4 = DEFAULT_HEADER_TEXT_COLOR
): vec4 {
  return colorFromBracketMaterial(materials, bracketIndex(pct), fallback)
}

export function applyTextFillColor(
  text: Text | null | undefined,
  color: vec4
): void {
  if (!text) {
    return
  }
  text.textFill.color = color
}

/** Unique header label per 10% color bracket (0–10% … 90–100%). Editable on Record prefab. */
export const DEFAULT_BRACKET_LABELS: string[] = [
  "Terrible", // 0–10%
  "Very Poor", // 10–20%
  "Poor", // 20–30%
  "Weak", // 30–40%
  "Fair", // 40–50%
  "OK", // 50–60%
  "Good", // 60–70%
  "Great", // 70–80%
  "Excellent", // 80–90%
  "Perfect", // 90–100%
]

export function defaultBracketLabels(): string[] {
  return DEFAULT_BRACKET_LABELS.slice()
}

export function isDeadZone(input: DeadZoneInput): boolean {
  const deadZoneMbps = input.deadZoneMbps ?? DEFAULT_DEAD_ZONE_MBPS
  const deadZoneSessionPct = input.deadZoneSessionPct ?? DEFAULT_DEAD_ZONE_SESSION_PCT
  const deadZoneMinSamples = input.deadZoneMinSamples ?? DEFAULT_DEAD_ZONE_MIN_SAMPLES
  const sessionSpreadMinMbps = input.sessionSpreadMinMbps ?? DEFAULT_SESSION_SPREAD_MIN_MBPS

  if (input.sampleCount < deadZoneMinSamples) {
    return false
  }

  if (input.displayMbps < deadZoneMbps) {
    return true
  }

  if (
    input.sessionSpreadMbps >= sessionSpreadMinMbps &&
    input.sessionPct < deadZoneSessionPct
  ) {
    return true
  }

  return false
}
