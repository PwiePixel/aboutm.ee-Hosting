import 'server-only'
import { config, turnstileEnabled } from './config'

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

const FAILED = 'Die Sicherheitsprüfung hat nicht geklappt. Lade die Seite neu und versuch es noch einmal.'
const NOT_SET_UP =
  'Die Sicherheitsprüfung ist auf diesem Server noch nicht eingerichtet. Bis dahin sind Formulare gesperrt.'

/**
 * Prüft das Token der Cloudflare-Sicherheitsprüfung. Gibt `null` zurück, wenn alles in Ordnung ist,
 * sonst die Meldung für den Besucher.
 *
 * Fehlen die Schlüssel, wird in der Entwicklung nicht geprüft. Im Live-Betrieb dagegen wird dann
 * abgelehnt — ein vergessener Schlüssel soll nicht unbemerkt alle Formulare für Bots öffnen.
 */
export async function turnstileProblem(formData: FormData, ip: string | null): Promise<string | null> {
  if (!turnstileEnabled) {
    if (process.env.NODE_ENV === 'production' && !config.allowNoTurnstile) return NOT_SET_UP
    return null
  }

  const token = formData.get('cf-turnstile-response')
  if (typeof token !== 'string' || token.length === 0 || token.length > 2048) return FAILED

  const body = new URLSearchParams({ secret: config.turnstileSecret, response: token })
  if (ip) body.set('remoteip', ip)

  try {
    const response = await fetch(VERIFY_URL, {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(8000),
      cache: 'no-store',
    })
    if (!response.ok) return FAILED
    const result = (await response.json()) as { success?: boolean }
    return result.success === true ? null : FAILED
  } catch {
    return FAILED
  }
}
