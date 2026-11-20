import { CircleHelp, CircleUserRound, ShieldCheck } from 'lucide-react'
import Link from 'next/link'
import type { User } from '@/lib/auth'
import { logoutAction } from '@/lib/actions/auth'
import { Logo } from './logo'

export function AppHeader({ user }: { user: User }) {
  return (
    <header className="border-b border-line">
      <div className="wrap flex min-h-[60px] flex-wrap items-center gap-x-6 gap-y-1 py-2">
        <Logo href="/app" />
        <nav aria-label="Hauptnavigation" className="flex items-center gap-4 text-[14px] font-semibold">
          <Link href="/app" className="text-ink-dim hover:text-ink">
            Deine Welten
          </Link>
          {user.isAdmin && (
            <Link href="/admin" className="flex items-center gap-1.5 text-accent hover:text-accent-strong">
              <ShieldCheck className="size-4" aria-hidden />
              Admin
            </Link>
          )}
        </nav>
        <div className="ml-auto flex items-center gap-4 text-[14px]">
          <Link href="/hilfe" className="flex items-center gap-1.5 text-ink-dim hover:text-ink">
            <CircleHelp className="size-[17px]" aria-hidden />
            Hilfe
          </Link>
          <Link href="/app/konto" className="flex min-w-0 items-center gap-1.5 text-ink-dim hover:text-ink">
            <CircleUserRound className="size-[17px] flex-none" aria-hidden />
            <span className="max-w-[220px] truncate">{user.email}</span>
          </Link>
          <form action={logoutAction}>
            <button type="submit" className="text-ink-faint hover:text-ink">
              Abmelden
            </button>
          </form>
        </div>
      </div>
    </header>
  )
}
