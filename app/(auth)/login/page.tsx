import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AuthForm } from '@/components/auth-form'
import { currentUser } from '@/lib/auth'
import { config, turnstileEnabled } from '@/lib/config'

export const metadata: Metadata = { title: 'Anmelden' }

export default async function LoginPage() {
  if (await currentUser()) redirect('/app')
  return (
    <>
      <h1 className="display text-[40px]">Anmelden</h1>
      <p className="mt-3 text-ink-dim">Weiter zu deinen Welten.</p>
      <div className="mt-8">
        <AuthForm mode="login" siteKey={turnstileEnabled ? config.turnstileSiteKey : ''} />
      </div>
      <p className="mt-6 text-[14px] text-ink-dim">
        Noch kein Konto?{' '}
        <Link href="/register" className="link">
          Jetzt erstellen
        </Link>
      </p>
      <p className="mt-2 text-[14px] text-ink-dim">
        <Link href="/passwort-vergessen" className="link">
          Passwort vergessen?
        </Link>
      </p>
    </>
  )
}
