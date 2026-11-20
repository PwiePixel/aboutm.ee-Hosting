/**
 * Merkt sich, an welchen Welten gerade eine länger laufende Dateiarbeit hängt (Backup, Wiederherstellen).
 * Solange darf die Welt nicht starten — sonst entstünde ein halb kopierter Stand.
 */
type Globals = { __amLocks?: Set<string> }
const globals = globalThis as unknown as Globals

function locks(): Set<string> {
  globals.__amLocks ??= new Set()
  return globals.__amLocks
}

export function isLocked(worldId: string): boolean {
  return locks().has(worldId)
}

/** Führt `work` aus, während die Welt gesperrt ist. Gibt `null` zurück, wenn sie schon gesperrt war. */
export async function withWorldLock<T>(worldId: string, work: () => Promise<T>): Promise<T | null> {
  if (locks().has(worldId)) return null
  locks().add(worldId)
  try {
    return await work()
  } finally {
    locks().delete(worldId)
  }
}
