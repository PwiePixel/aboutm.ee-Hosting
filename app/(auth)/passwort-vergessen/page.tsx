import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = { title: 'Passwort vergessen' }

export default function ForgotPasswordPage() {
  return (
    <>
      <h1 className="display text-[40px]">Passwort vergessen</h1>
      <p className="mt-4 text-ink-dim">
        Ein automatisches Zurücksetzen per E-Mail gibt es noch nicht. Schreib uns über das Hilfe-Formular mit der
        E-Mail-Adresse deines Kontos — wir melden uns bei dir und helfen dir zurück in dein Konto.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/hilfe" className="btn btn-primary">
          Zum Hilfe-Formular
        </Link>
        <Link href="/login" className="btn">
          Zurück zum Anmelden
        </Link>
      </div>
    </>
  )
}
