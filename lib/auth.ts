import 'server-only'
import { createHash } from 'node:crypto'
import { cookies, headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { cache } from 'react'
import { config } from './config'
import { db } from './db'
import { newSessionToken } from './ids'

export type User = { id: string; email: string; created_at: number; isAdmin: boolean }

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export async function createSession(userId: string): Promise<void> {
  const token = newSessionToken()
  const now = Date.now()
  const expires = now + config.sessionDays * 24 * 60 * 60 * 1000
  db()
    .prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(hashToken(token), userId, now, expires)

  const store = await cookies()
  store.set(config.sessionCookie, token, {
    httpOnly: true,
    sameSite: 'lax',
    // Nur über HTTPS senden, sobald die Seite unter einer https-Adresse läuft.
    secure: config.siteUrl.startsWith('https://'),
    path: '/',
    expires: new Date(expires),
  })
}

export async function destroySession(): Promise<void> {
  const store = await cookies()
  const token = store.get(config.sessionCookie)?.value
  if (token) db().prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token))
  store.delete(config.sessionCookie)
}

export function destroyAllSessions(userId: string): void {
  db().prepare('DELETE FROM sessions WHERE user_id = ?').run(userId)
}

/** Das angemeldete Konto — oder `null`. Pro Anfrage nur einmal nachgeschlagen. */
export const currentUser = cache(async (): Promise<User | null> => {
  const store = await cookies()
  const token = store.get(config.sessionCookie)?.value
  if (!token || token.length > 128) return null
  const row = db()
    .prepare(
      `SELECT users.id, users.email, users.created_at, users.is_admin, sessions.expires_at
       FROM sessions JOIN users ON users.id = sessions.user_id
       WHERE sessions.token_hash = ?`,
    )
    .get(hashToken(token)) as
    | { id: string; email: string; created_at: number; is_admin: number; expires_at: number }
    | undefined
  if (!row || row.expires_at < Date.now()) return null
  return { id: row.id, email: row.email, created_at: row.created_at, isAdmin: row.is_admin === 1 }
})

export async function requireUser(): Promise<User> {
  const user = await currentUser()
  if (!user) redirect('/login')
  return user
}

/** Für den Admin-Bereich. Alle anderen sehen „nicht gefunden“ — die Seite verrät nicht, dass es sie gibt. */
export async function requireAdmin(): Promise<User> {
  const user = await requireUser()
  if (!user.isAdmin) notFound()
  return user
}

/**
 * Adresse des Besuchers — für Anmelde-Limits und die Turnstile-Prüfung. Gelesen wird nur die eine
 * Kopfzeile, die der vorgeschaltete Dienst selbst setzt (siehe config.clientIpHeader); alles andere
 * könnte der Besucher frei erfinden und damit die Limits umgehen.
 */
export async function clientIp(): Promise<string | null> {
  const list = await headers()
  const trusted = list.get(config.clientIpHeader)?.split(',')[0]?.trim()
  if (trusted) return trusted
  // Ohne vorgeschalteten Dienst (lokale Entwicklung) hilft die Angabe des Entwicklungsservers.
  if (process.env.NODE_ENV !== 'production') return list.get('x-forwarded-for')?.split(',')[0]?.trim() || null
  // Im Betrieb setzt Caddy diese Kopfzeile bei jeder Anfrage. Fehlt sie, erreicht jemand die Website an
  // Caddy vorbei (etwa über einen übrig gebliebenen Tunnel) — dann teilen sich alle Besucher dieselben Limits.
  const globals = globalThis as { __amMissingIpWarned?: boolean }
  if (!globals.__amMissingIpWarned) {
    globals.__amMissingIpWarned = true
    console.warn(
      `[aboutm.ee] Eine Anfrage kam ohne die Kopfzeile „${config.clientIpHeader}“ an — die Website wird an Caddy vorbei erreicht. ` +
        'Alte Dienste entfernen: docker compose up -d --remove-orphans',
    )
  }
  return null
}
