import './setup'
import './helpers/next-mocks'
import { describe, expect, it, vi } from 'vitest'

// Live-Betrieb, aber die Turnstile-Schlüssel wurden vergessen.
delete process.env.TURNSTILE_SITE_KEY
delete process.env.TURNSTILE_SECRET_KEY
vi.stubEnv('NODE_ENV', 'production')

describe('Fehlende Turnstile-Schlüssel im Live-Betrieb', () => {
  it('sperren die Formulare, statt sie ungeprüft zu öffnen', async () => {
    const { turnstileProblem } = await import('@/lib/turnstile')
    expect(await turnstileProblem(new FormData(), '198.51.100.1')).toMatch(/nicht eingerichtet/)

    const { registerAction } = await import('@/lib/actions/auth')
    const data = new FormData()
    data.set('email', 'neu@example.com')
    data.set('password', 'ein-langes-passwort-42')
    expect((await registerAction({}, data)).error).toMatch(/nicht eingerichtet/)

    const { db } = await import('@/lib/db')
    expect(db().prepare('SELECT COUNT(*) AS n FROM users').get()).toEqual({ n: 0 })
  })
})
