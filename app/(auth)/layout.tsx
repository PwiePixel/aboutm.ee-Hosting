import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { Disclaimer } from '@/components/disclaimer'
import { Logo } from '@/components/logo'

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main id="inhalt" className="mx-auto flex min-h-dvh w-full max-w-[440px] flex-col justify-center px-5 py-12">
      <Logo className="self-start" />
      <div className="mt-10">{children}</div>
      <Link href="/" className="mt-10 inline-flex items-center gap-2 self-start text-[14px] text-ink-dim hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden />
        Zurück zur Startseite
      </Link>
      <Disclaimer className="mt-10" />
    </main>
  )
}
