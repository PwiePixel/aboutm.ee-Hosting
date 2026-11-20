import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'

const N = 2 ** 15
const R = 8
const P = 1
const KEY_LENGTH = 64

function derive(password: string, salt: Buffer, n: number, r: number, p: number, length: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, length, { N: n, r, p, maxmem: 128 * n * r * 2 }, (error, key) => {
      if (error) reject(error)
      else resolve(key)
    })
  })
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const key = await derive(password, salt, N, R, P, KEY_LENGTH)
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const n = Number(parts[1])
  const r = Number(parts[2])
  const p = Number(parts[3])
  if (![n, r, p].every((x) => Number.isInteger(x) && x > 0)) return false
  const salt = Buffer.from(parts[4]!, 'base64')
  const expected = Buffer.from(parts[5]!, 'base64')
  const actual = await derive(password, salt, n, r, p, expected.length)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

// Wird geprüft, wenn es das Konto nicht gibt — damit die Antwortzeit nichts verrät.
let dummy: Promise<string> | undefined
export async function verifyAgainstDummy(password: string): Promise<void> {
  dummy ??= hashPassword('kein-echtes-passwort')
  await verifyPassword(password, await dummy)
}
