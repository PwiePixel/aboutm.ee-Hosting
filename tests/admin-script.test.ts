import './setup'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { verifyPassword } from '@/lib/password'

const SCRIPT = path.join(import.meta.dirname, '..', 'scripts', 'make-admin.mjs')

function run(args: string[], env: Record<string, string> = {}): { ok: boolean; output: string } {
  try {
    const output = execFileSync('node', [SCRIPT, ...args], {
      env: { ...process.env, ...env },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { ok: true, output }
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string }
    return { ok: false, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` }
  }
}

describe('scripts/make-admin.mjs', () => {
  it('legt ein Admin-Konto an, mit dem sich die Website anmelden lässt', async () => {
    db() // Datenbank anlegen
    expect(run(['chef@example.com']).ok).toBe(false) // ohne Passwort kein neues Konto
    expect(run(['chef@example.com'], { ADMIN_PASSWORD: 'kurz' }).ok).toBe(false)

    const created = run(['Chef@Example.com'], { ADMIN_PASSWORD: 'ein-langes-passwort-42' })
    expect(created.ok, created.output).toBe(true)

    const row = db().prepare('SELECT id, password_hash, is_admin FROM users WHERE email = ?').get('chef@example.com') as {
      id: string
      password_hash: string
      is_admin: number
    }
    expect(row.is_admin).toBe(1)
    expect(row.id).toMatch(/^usr_[a-z0-9]{16}$/)
    // Der Hash aus dem Skript muss zur Passwortprüfung der Website passen.
    expect(await verifyPassword('ein-langes-passwort-42', row.password_hash)).toBe(true)
    expect(await verifyPassword('falsch-falsch-falsch', row.password_hash)).toBe(false)
  })

  it('gibt und nimmt Admin-Rechte bei bestehenden Konten, ohne das Passwort anzufassen', () => {
    db()
      .prepare('INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)')
      .run('usr_nutzernutzernutz', 'nutzer@example.com', 'unverändert', Date.now())
    const read = () =>
      db().prepare('SELECT is_admin, password_hash FROM users WHERE email = ?').get('nutzer@example.com') as {
        is_admin: number
        password_hash: string
      }

    expect(run(['nutzer@example.com'], { ADMIN_PASSWORD: 'wird-nicht-benutzt-123' }).ok).toBe(true)
    expect(read()).toEqual({ is_admin: 1, password_hash: 'unverändert' })
    expect(run(['nutzer@example.com', '--entfernen']).ok).toBe(true)
    expect(read().is_admin).toBe(0)
    expect(run(['gibtsnicht@example.com', '--entfernen']).ok).toBe(false)
    expect(run(['keine-mail']).ok).toBe(false)
  })
})
