import { ChevronLeft } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import { CopyAddress, LiveError, LiveStatusBadge, QuickControl, WorldTabs } from '@/components/world-header'
import { WorldLiveProvider } from '@/components/world-live'
import { isPixelArt, worldArt } from '@/lib/art'
import { requireUser } from '@/lib/auth'
import { config } from '@/lib/config'
import { formatMiBAsGiB } from '@/lib/format'
import { buildStatus } from '@/lib/status'
import { getWorld, worldAddress } from '@/lib/worlds'

export default async function WorldLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ id: string }>
}) {
  const user = await requireUser()
  const world = getWorld(user.id, (await params).id)
  if (!world) notFound()
  const art = worldArt(world.id)

  return (
    <WorldLiveProvider worldId={world.id} initial={await buildStatus(world)}>
      <Link href="/app" className="inline-flex items-center gap-1.5 text-[14px] text-ink-dim hover:text-ink">
        <ChevronLeft className="size-4" aria-hidden />
        Deine Welten
      </Link>

      <div className="relative mt-4 overflow-hidden border border-line">
        <Image
          src={art}
          alt=""
          width={960}
          height={320}
          unoptimized
          priority
          className={`block h-[220px] w-full object-cover sm:h-[300px] ${isPixelArt(art) ? 'pixelated' : ''}`}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-base/90 via-base/20 to-transparent" />
        <span className="absolute right-4 top-4">
          <LiveStatusBadge />
        </span>
        <div className="absolute inset-x-0 bottom-0 p-5 sm:p-7">
          <h1 className="display break-words text-[clamp(32px,6.5vw,60px)]">{world.name}</h1>
          <p className="mt-2 font-mono text-[12px] font-semibold uppercase tracking-[0.14em] text-ink-dim">
            Paper {world.version} · {formatMiBAsGiB(config.ramMiB)}
          </p>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <CopyAddress address={worldAddress(world)} />
          <p className="mt-2 text-[13px] text-ink-dim">Minecraft Java – Version {world.version} erforderlich.</p>
        </div>
        <QuickControl />
      </div>

      <div className="mt-8">
        <WorldTabs worldId={world.id} />
      </div>
      <div className="mt-6 space-y-4">
        <LiveError />
        {children}
      </div>
    </WorldLiveProvider>
  )
}
