import './setup'
import { cookieJar, requestHeaders } from './helpers/next-mocks'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Wie im Live-Betrieb: Turnstile eingerichtet, Adresse des Besuchers kommt vom Cloudflare-Tunnel.
process.env.TURNSTILE_SITE_KEY = 'site'
process.env.TURNSTILE_SECRET_KEY = 'secret'
process.env.CLIENT_IP_HEADER = 'cf-connecting-ip'
vi.stubEnv('NODE_ENV', 'production')

const PASSWORD = 'richtiges-pferd-batterie'
let turnstileOk = true
let login: (typeof import('@/lib/actions/auth'))['loginAction']
let clientIp: (typeof import('@/lib/auth'))['clientIp']

function form(fields: Record<string, string>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  return data
}
async function attempt(fields: Record<string, string>): Promise<string> {
  try {
    return (await login({}, form(fields))).error ?? 'kein Fehler'
  } catch (error) {
    return String((error as Error).message)
  }
}

beforeAll(async () => {
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ success: turnstileOk }), { status: 200 }))
  const { db } = await import('@/lib/db')
  const { hashPassword } = await import('@/lib/password')
  db().prepare('INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)').run('usr_opferopferopfero', 'opfer@example.com', await hashPassword(PASSWORD), Date.now())
  login = (await import('@/lib/actions/auth')).loginAction
  clientIp = (await import('@/lib/auth')).clientIp
})
beforeEach(() => {
  requestHeaders.clear()
  cookieJar.clear()
  turnstileOk = true
})

describe('Anmeldung', () => {
  it('lässt sich nicht von Fremden für ein Konto sperren', async () => {
    // Ein Angreifer schickt viele Anfragen für das fremde Konto — ohne Sicherheitsprüfung und mit falschem Passwort.
    requestHeaders.set('cf-connecting-ip', '203.0.113.9')
    for (let i = 0; i < 12; i++) await attempt({ email: 'opfer@example.com' })
    for (let i = 0; i < 12; i++) await attempt({ email: 'opfer@example.com', password: 'geraten-geraten', 'cf-turnstile-response': 'token' })

    // Das Opfer meldet sich von seiner eigenen Adresse mit dem richtigen Passwort an.
    requestHeaders.set('cf-connecting-ip', '198.51.100.1')
    const result = await attempt({ email: 'opfer@example.com', password: PASSWORD, 'cf-turnstile-response': 'token' })
    expect(result).toBe('REDIRECT /app')
    expect(cookieJar.has('am_session')).toBe(true)
  })

  it('bremst Durchprobieren von einer Adresse', async () => {
    requestHeaders.set('cf-connecting-ip', '203.0.113.50')
    const results: string[] = []
    for (let i = 0; i < 12; i++) {
      results.push(await attempt({ email: 'opfer@example.com', password: `versuch-nummer-${i}`, 'cf-turnstile-response': 'token' }))
    }
    expect(results.slice(0, 8).every((message) => message === 'E-Mail oder Passwort stimmt nicht.')).toBe(true)
    expect(results.at(-1)).toMatch(/Zu viele Versuche/)
    // Auch das richtige Passwort hilft dem Angreifer von dieser Adresse jetzt nicht mehr.
    expect(await attempt({ email: 'opfer@example.com', password: PASSWORD, 'cf-turnstile-response': 'token' })).toMatch(/Zu viele Versuche/)
  })

  it('lehnt ab, wenn die Sicherheitsprüfung nicht bestanden ist', async () => {
    requestHeaders.set('cf-connecting-ip', '198.51.100.77')
    turnstileOk = false
    expect(await attempt({ email: 'opfer@example.com', password: PASSWORD, 'cf-turnstile-response': 'token' })).toMatch(/Sicherheitsprüfung/)
    expect(await attempt({ email: 'opfer@example.com', password: PASSWORD })).toMatch(/Sicherheitsprüfung/)
    expect(cookieJar.has('am_session')).toBe(false)
  })
})

describe('Adresse des Besuchers', () => {
  it('kommt nur aus der Kopfzeile des vorgeschalteten Dienstes', async () => {
    requestHeaders.set('cf-connecting-ip', '198.51.100.1')
    requestHeaders.set('x-forwarded-for', '10.9.9.9')
    requestHeaders.set('x-real-ip', '10.8.8.8')
    expect(await clientIp()).toBe('198.51.100.1')
  })

  it('glaubt im Live-Betrieb keiner anderen Angabe', async () => {
    requestHeaders.set('x-forwarded-for', '10.9.9.9')
    requestHeaders.set('x-real-ip', '10.8.8.8')
    expect(await clientIp()).toBeNull()
  })
})
