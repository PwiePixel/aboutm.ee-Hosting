import { randomBytes, randomInt } from 'node:crypto'

// Ohne leicht verwechselbare Zeichen (0/o, 1/l/i).
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'

export function randomId(length: number): string {
  let out = ''
  for (let i = 0; i < length; i++) out += ALPHABET[randomInt(ALPHABET.length)]
  return out
}

export function newUserId(): string {
  return `usr_${randomId(16)}`
}

export function newWorldId(): string {
  return `welt_${randomId(16)}`
}

export function newBackupId(): string {
  return `bkp_${randomId(16)}`
}

export function newFeedbackId(): string {
  return `fb_${randomId(16)}`
}

export function newSessionToken(): string {
  return randomBytes(32).toString('base64url')
}
