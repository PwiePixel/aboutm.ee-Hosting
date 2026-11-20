import Link from 'next/link'
import { currentUser } from '@/lib/auth'
import { Disclaimer } from './disclaimer'
import { Logo } from './logo'

export async function SiteHeader() {
  const user = await currentUser()
  return (
    <header className="border-b border-line">
      <div className="wrap flex h-[60px] items-center gap-3 sm:gap-6">
        <Logo />
        <nav aria-label="Hauptnavigation" className="ml-auto flex items-center gap-1 text-[14px] sm:gap-3">
          <Link href="/#ablauf" className="hidden px-2 py-2 text-ink-dim hover:text-ink sm:block">
            So funktioniert’s
          </Link>
          {user ? (
            <Link href="/app" className="btn btn-primary min-h-[38px] px-4 text-[13px]">
              Deine Welten
            </Link>
          ) : (
            <>
              <Link href="/login" className="px-2 py-2 text-ink-dim hover:text-ink">
                Anmelden
              </Link>
              <Link href="/register" className="btn btn-primary min-h-[38px] px-3 text-[13px] sm:px-4">
                <span className="sm:hidden">Erstellen</span>
                <span className="hidden sm:inline">Server erstellen</span>
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  )
}

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-line">
      <div className="wrap py-10">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <Logo />
          <span className="text-[14px] text-ink-dim">— kostenlose Minecraft-Server für Freundesgruppen.</span>
        </div>
        <nav aria-label="Fußzeile" className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-[14px] text-ink-dim">
          <Link href="/#ablauf" className="hover:text-ink">
            So funktioniert’s
          </Link>
          <Link href="/hilfe" className="hover:text-ink">
            Feedback &amp; Hilfe
          </Link>
          <Link href="/zahlen" className="hover:text-ink">
            aboutm.ee in Zahlen
          </Link>
          <Link href="/login" className="hover:text-ink">
            Anmelden
          </Link>
          <Link href="/impressum" className="hover:text-ink">
            Impressum
          </Link>
          <Link href="/datenschutz" className="hover:text-ink">
            Datenschutz
          </Link>
          <Link href="/bildnachweise" className="hover:text-ink">
            Bildnachweise
          </Link>
        </nav>
        <Disclaimer className="mt-6 max-w-[680px]" />
      </div>
    </footer>
  )
}
