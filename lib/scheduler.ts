import { autoBackupAfterPause } from './backups'
import { config, turnstileEnabled } from './config'
import { db } from './db'
import { runtime } from './runtime'
import { limits } from './settings'
import { tick } from './worlds'

type Globals = { __amScheduler?: NodeJS.Timeout }
const globals = globalThis as unknown as Globals

const INTERVAL_MS = 2000

export function startScheduler(): void {
  if (globals.__amScheduler) return

  const driver = runtime()
  console.log(`[aboutm.ee] Treiber: ${driver.name} · ${limits().totalSlots} Serverplätze · Daten in ${config.dataDir}`)
  if (driver.preview) {
    console.warn('[aboutm.ee] Vorschau-Modus: Es werden keine echten Minecraft-Server gestartet.')
  }
  if (!turnstileEnabled && process.env.NODE_ENV === 'production') {
    console.warn(
      config.allowNoTurnstile
        ? '[aboutm.ee] Cloudflare Turnstile ist nicht konfiguriert — Formulare laufen ohne Bot-Prüfung (ALLOW_NO_TURNSTILE=1).'
        : '[aboutm.ee] Cloudflare Turnstile ist nicht konfiguriert — Anmeldung, Registrierung und Hilfe-Formular sind gesperrt, bis TURNSTILE_SITE_KEY und TURNSTILE_SECRET_KEY gesetzt sind.',
    )
  }

  const run = () => {
    tick({ afterPause: autoBackupAfterPause }).catch((error) => console.error('[aboutm.ee] Taktgeber:', error))
  }
  globals.__amScheduler = setInterval(run, INTERVAL_MS)
  globals.__amScheduler.unref()

  const cleanup = setInterval(
    () => {
      try {
        db().prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now())
      } catch (error) {
        console.error('[aboutm.ee] Sitzungen aufräumen:', error)
      }
    },
    60 * 60 * 1000,
  )
  cleanup.unref()
  run()
}
