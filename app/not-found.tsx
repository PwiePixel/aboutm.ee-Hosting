import Link from 'next/link'
import { Logo } from '@/components/logo'

export default function NotFound() {
  return (
    <main id="inhalt" className="mx-auto flex min-h-dvh max-w-[520px] flex-col justify-center px-5">
      <Logo className="self-start" />
      <p className="eyebrow mt-10 text-accent">Fehler 404</p>
      <h1 className="display mt-4 text-[44px]">Hier ist nichts.</h1>
      <p className="mt-4 text-ink-dim">Diese Seite gibt es nicht — oder sie gehört zu einem anderen Konto.</p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/app" className="btn btn-primary">
          Zu deinen Welten
        </Link>
        <Link href="/" className="btn">
          Zur Startseite
        </Link>
      </div>
    </main>
  )
}
