import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AuthForm } from '@/components/auth-form'
import { currentUser } from '@/lib/auth'
import { config, turnstileEnabled } from '@/lib/config'

export const metadata: Metadata = { title: 'Konto erstellen' }

export default async function RegisterPage() {
  if (await currentUser()) redirect('/app')
  return (
    <>
      <h1 className="display text-[40px]">Konto erstellen</h1>
      <p className="mt-3 text-ink-dim">E-Mail und Passwort genügen. Danach geht es direkt zur ersten Welt.</p>
      <div className="mt-8">
        <AuthForm mode="register" siteKey={turnstileEnabled ? config.turnstileSiteKey : ''} />
      </div>
      <p className="mt-6 text-[13px] text-ink-faint">
        Was mit deinen Daten passiert und wie du dein Konto wieder löschst, steht in der{' '}
        <Link href="/datenschutz" className="link">
          Datenschutzerklärung
        </Link>
        . Wer hinter aboutm.ee steckt, steht im{' '}
        <Link href="/impressum" className="link">
          Impressum
        </Link>
        .
      </p>
      <p className="mt-6 text-[14px] text-ink-dim">
        Schon ein Konto?{' '}
        <Link href="/login" className="link">
          Anmelden
        </Link>
      </p>
    </>
  )
}
