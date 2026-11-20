import { config } from './config'
import { db } from './db'

/**
 * Angaben des Betreibers für Impressum und Datenschutzerklärung. Sie werden im Admin-Bereich
 * eingetragen (Admin → Impressum) und liegen in der Datenbank — der Code muss dafür nicht angefasst werden.
 */
export type Imprint = {
  name: string
  street: string
  city: string
  country: string
  email: string
  phone: string
  /** Wann die Angaben zuletzt gespeichert wurden — erscheint als „Stand“. */
  updatedAt: number | null
}

export const IMPRINT_FIELDS = ['name', 'street', 'city', 'country', 'email', 'phone'] as const
export type ImprintField = (typeof IMPRINT_FIELDS)[number]

const EMPTY: Imprint = { name: '', street: '', city: '', country: 'Deutschland', email: '', phone: '', updatedAt: null }

export function imprint(): Imprint {
  const row = db().prepare(`SELECT value FROM settings WHERE key = 'imprint'`).get() as { value: string } | undefined
  let stored: Partial<Imprint> = {}
  try {
    stored = row ? (JSON.parse(row.value) as Partial<Imprint>) : {}
  } catch {
    stored = {}
  }
  const merged = { ...EMPTY, ...stored }
  // Solange keine eigene Adresse eingetragen ist, gilt die Kontaktadresse aus der .env.
  return { ...merged, email: merged.email || config.supportEmail }
}

/** Pflichtangaben vollständig? Telefon ist freiwillig. */
export function imprintComplete(value: Imprint): boolean {
  return Boolean(value.name && value.street && value.city && value.country && value.email)
}

export function saveImprint(values: Record<ImprintField, string>): void {
  const next: Imprint = { ...values, updatedAt: Date.now() }
  db()
    .prepare(`INSERT INTO settings (key, value) VALUES ('imprint', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .run(JSON.stringify(next))
}
