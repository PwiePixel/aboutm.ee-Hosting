import 'server-only'
import { config, turnstileEnabled } from './config'

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

/**
 * Prüft das Token der Cloudflare-Sicherheitsprüfung. Ohne konfigurierte Schlüssel
 * ist die Prüfung abgeschaltet (nur für die lokale Entwicklung gedacht).
 */
export async function verifyTurnstile(formData: FormData, ip: string | null): Promise<boolean> {
  if (!turnstileEnabled) return true

  const token = formData.get('cf-turnstile-response')
  if (typeof token !== 'string' || token.length === 0 || token.length > 2048) return false

  const body = new URLSearchParams({ secret: config.turnstileSecret, response: token })
  if (ip) body.set('remoteip', ip)

  try {
    const response = await fetch(VERIFY_URL, {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(8000),
      cache: 'no-store',
    })
    if (!response.ok) return false
    const result = (await response.json()) as { success?: boolean }
    return result.success === true
  } catch {
    return false
  }
}
