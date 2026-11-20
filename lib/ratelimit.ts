type Bucket = number[]
type Globals = { __amRate?: Map<string, Bucket> }
const globals = globalThis as unknown as Globals

function buckets(): Map<string, Bucket> {
  globals.__amRate ??= new Map()
  return globals.__amRate
}

/** Ist das Limit schon erreicht? Zählt selbst nichts mit. */
export function isLimited(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  return (buckets().get(key) ?? []).filter((t) => now - t < windowMs).length >= limit
}

/**
 * Gleitendes Zeitfenster im Arbeitsspeicher. Gibt `true` zurück, wenn der Versuch
 * erlaubt ist, und zählt ihn dann mit.
 */
export function allowAttempt(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const map = buckets()
  const recent = (map.get(key) ?? []).filter((t) => now - t < windowMs)
  if (recent.length >= limit) {
    map.set(key, recent)
    return false
  }
  recent.push(now)
  map.set(key, recent)

  if (map.size > 20_000) {
    for (const [k, times] of map) {
      if (times.every((t) => now - t >= windowMs)) map.delete(k)
    }
  }
  return true
}
