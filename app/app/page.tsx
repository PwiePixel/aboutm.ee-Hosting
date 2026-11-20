import { Check, Plus } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { Cover } from '@/components/cover'
import { StatusBadge } from '@/components/world-header'
import { imageUrl, worldArt } from '@/lib/art'
import { requireUser } from '@/lib/auth'
import { config } from '@/lib/config'
import { formatMiBAsGiB } from '@/lib/format'
import { worldPlan } from '@/lib/plan'
import { limits } from '@/lib/settings'
import { listWorlds, slotsFree, worldAddress } from '@/lib/worlds'

export const metadata: Metadata = { title: 'Deine Welten' }

export default async function WorldsPage({ searchParams }: { searchParams: Promise<{ geloescht?: string }> }) {
  const user = await requireUser()
  const params = await searchParams
  const worlds = listWorlds(user.id)
  const limit = limits()
  const free = slotsFree()
  const slotsLine = `Gerade ${free === 1 ? 'ist' : 'sind'} ${free} von ${limit.totalSlots} Serverplätzen frei.`
  const canCreate = worlds.length < limit.maxWorldsPerUser

  const deleted = params.geloescht === '1' && (
    <p className="notice mb-8" role="status">
      <Check aria-hidden />
      <span>Die Welt und alle ihre Daten sind gelöscht.</span>
    </p>
  )

  if (worlds.length === 0) {
    const hero = imageUrl('hero')
    return (
      <div className="mx-auto max-w-[560px] text-center">
        {deleted}
        {hero && (
          <div className="mb-8 border border-line">
            <Cover src={hero} priority className="aspect-[16/9] w-full" />
          </div>
        )}
        <p className="text-[14px] text-ink-dim">{slotsLine}</p>
        <div className="mx-auto mt-6 grid size-11 place-items-center bg-panel-2 text-accent">
          <Plus className="size-5" aria-hidden />
        </div>
        <h1 className="heading mt-4 text-[26px]">Erstelle deine erste Welt.</h1>
        <p className="mt-2 text-ink-dim">Du brauchst nur einen Namen und eine Minecraft-Version.</p>
        <ul className="mt-5 space-y-1.5 text-[13px] text-ink-faint">
          <li>1 laufende Welt gleichzeitig pro Konto</li>
          <li>pausiert automatisch nach {limit.autoPauseMinutes} Minuten Leerlauf</li>
          <li>deine Welt bleibt gespeichert</li>
        </ul>
        <Link href="/app/welten/neu" className="btn btn-primary btn-lg mt-8">
          <Plus aria-hidden />
          Welt erstellen
        </Link>
      </div>
    )
  }

  return (
    <>
      {deleted}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="display text-[clamp(36px,6vw,56px)]">Deine Welten.</h1>
          <p className="mt-3 text-[14px] text-ink-dim">{slotsLine}</p>
        </div>
        {canCreate ? (
          <Link href="/app/welten/neu" className="btn btn-primary">
            <Plus aria-hidden />
            Welt erstellen
          </Link>
        ) : (
          <p className="max-w-[260px] text-right text-[13px] text-ink-faint">
            Du hast {limit.maxWorldsPerUser} von {limit.maxWorldsPerUser} Welten. Lösche eine, um eine neue anzulegen.
          </p>
        )}
      </div>

      <ul className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {worlds.map((world) => {
          const art = worldArt(world.id)
          return (
            <li key={world.id}>
              <Link
                href={`/app/welten/${world.id}`}
                className="group block border border-line bg-base-soft hover:border-line-strong"
              >
                <div className="relative">
                  <Cover src={art} className="aspect-[16/7] w-full" />
                  <span className="absolute right-3 top-3">
                    <StatusBadge status={world.status} />
                  </span>
                </div>
                <div className="p-5">
                  <h2 className="heading truncate text-[20px] group-hover:text-accent">{world.name}</h2>
                  <p className="mt-1 font-mono text-[12px] uppercase tracking-[0.08em] text-ink-faint">
                    Paper {world.version} · {formatMiBAsGiB(worldPlan(world).ramMiB)}
                  </p>
                  <p className="mt-4 truncate font-mono text-[13px] text-ink-dim">{worldAddress(world)}</p>
                </div>
              </Link>
            </li>
          )
        })}
      </ul>
    </>
  )
}
