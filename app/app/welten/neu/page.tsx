import { ChevronLeft } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { NewWorldForm } from '@/components/new-world-form'
import { requireUser } from '@/lib/auth'
import { config } from '@/lib/config'
import { formatMiBAsGiB } from '@/lib/format'
import { limits } from '@/lib/settings'
import { listWorlds } from '@/lib/worlds'

export const metadata: Metadata = { title: 'Neue Welt' }

export default async function NewWorldPage() {
  const user = await requireUser()
  const limit = limits()
  const full = listWorlds(user.id).length >= limit.maxWorldsPerUser

  return (
    <>
      <Link href="/app" className="inline-flex items-center gap-1.5 text-[14px] text-ink-dim hover:text-ink">
        <ChevronLeft className="size-4" aria-hidden />
        Deine Welten
      </Link>
      <h1 className="display mt-6 text-[clamp(40px,7vw,60px)]">Neue Welt.</h1>
      <p className="mt-3 text-ink-dim">Such dir einen Namen aus, die Version und wie ihr spielen möchtet.</p>

      {full ? (
        <div className="panel mt-10 max-w-[560px] p-6">
          <h2 className="heading text-[18px]">Du hast schon {limit.maxWorldsPerUser} Welten.</h2>
          <p className="mt-2 text-ink-dim">
            Mehr gehen pro Konto nicht. Lösche eine Welt in ihren Einstellungen, dann kannst du eine neue anlegen.
          </p>
          <Link href="/app" className="btn mt-5">
            Zu deinen Welten
          </Link>
        </div>
      ) : (
        <NewWorldForm ramLabel={formatMiBAsGiB(config.ramMiB)} autoPauseMinutes={limit.autoPauseMinutes} />
      )}
    </>
  )
}
