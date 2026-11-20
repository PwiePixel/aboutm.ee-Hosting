import { config } from './config'
import { db } from './db'

/** Grenzen, die sich im Admin-Bereich ändern lassen. */
export type Limits = {
  totalSlots: number
  autoPauseMinutes: number
  maxWorldsPerUser: number
}

export const LIMIT_RANGES: Record<keyof Limits, { min: number; max: number }> = {
  totalSlots: { min: 0, max: 500 },
  autoPauseMinutes: { min: 5, max: 24 * 60 },
  maxWorldsPerUser: { min: 1, max: 20 },
}

export function limits(): Limits {
  const rows = db().prepare('SELECT key, value FROM settings').all() as Array<{ key: string; value: string }>
  const stored = new Map(rows.map((row) => [row.key, row.value]))
  const read = (key: keyof Limits): number => {
    const value = Number.parseInt(stored.get(key) ?? '', 10)
    const range = LIMIT_RANGES[key]
    return Number.isFinite(value) && value >= range.min && value <= range.max ? value : config.defaults[key]
  }
  return {
    totalSlots: read('totalSlots'),
    autoPauseMinutes: read('autoPauseMinutes'),
    maxWorldsPerUser: read('maxWorldsPerUser'),
  }
}

export function setLimit(key: keyof Limits, value: number): void {
  const range = LIMIT_RANGES[key]
  if (!Number.isInteger(value) || value < range.min || value > range.max) {
    throw new RangeError(`Erlaubt sind Werte von ${range.min} bis ${range.max}.`)
  }
  db()
    .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, String(value))
}
