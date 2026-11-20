import { DIFFICULTIES, GAMEMODES, findVersion } from './versions'

export const PASSWORD_MIN = 10
export const PASSWORD_MAX = 200
export const WORLD_NAME_MAX = 32
export const SEED_MAX = 64
export const COMMAND_MAX = 256
export const MESSAGE_MAX = 4000

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const email = value.trim().toLowerCase()
  if (email.length < 5 || email.length > 254) return null
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return null
  return email
}

export function passwordProblem(value: unknown): string | null {
  if (typeof value !== 'string' || value.length < PASSWORD_MIN) {
    return `Das Passwort braucht mindestens ${PASSWORD_MIN} Zeichen.`
  }
  if (value.length > PASSWORD_MAX) return `Das Passwort darf höchstens ${PASSWORD_MAX} Zeichen haben.`
  return null
}

/** Entfernt Steuerzeichen und überflüssige Leerzeichen. */
export function cleanText(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function worldNameProblem(name: string): string | null {
  if (name.length === 0) return 'Gib deiner Welt einen Namen.'
  if (name.length > WORLD_NAME_MAX) return `Der Name darf höchstens ${WORLD_NAME_MAX} Zeichen haben.`
  return null
}

export function isGamemode(value: unknown): value is (typeof GAMEMODES)[number]['id'] {
  return GAMEMODES.some((g) => g.id === value)
}

export function isDifficulty(value: unknown): value is (typeof DIFFICULTIES)[number]['id'] {
  return DIFFICULTIES.some((d) => d.id === value)
}

export function isVersion(value: unknown): value is string {
  return typeof value === 'string' && findVersion(value) !== undefined
}

export function isPlayerName(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_]{3,16}$/.test(value)
}

/** Konsolenbefehl: eine Zeile, ohne führenden Schrägstrich. */
export function cleanCommand(value: unknown): string {
  return cleanText(value).replace(/^\/+/, '').slice(0, COMMAND_MAX)
}
