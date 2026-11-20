import { Check } from 'lucide-react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { LiveUsage, WorldOverview } from '@/components/world-overview'
import { requireUser } from '@/lib/auth'
import { worldDiskUsage } from '@/lib/files'
import { formatBytes, formatMiBAsGiB, formatRelative } from '@/lib/format'
import { worldPlan } from '@/lib/plan'
import { formatPlayTime } from '@/lib/stats'
import { difficultyLabel, gamemodeLabel } from '@/lib/versions'
import { getWorld } from '@/lib/worlds'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const user = await requireUser()
  return { title: getWorld(user.id, (await params).id)?.name ?? 'Welt' }
}

export default async function WorldOverviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ neu?: string }>
}) {
  const user = await requireUser()
  const world = getWorld(user.id, (await params).id)
  if (!world) notFound()
  // Der Hinweis „jetzt starten“ passt nur, solange die Welt noch nicht gestartet wurde.
  const plan = worldPlan(world)
  const created = (await searchParams).neu === '1' && world.status === 'paused' && world.starts === 0

  const details: Array<[string, React.ReactNode]> = [
    ['Version', `Paper ${world.version}`],
    ['Minecraft', world.version],
    ['Paper-Build', String(world.paper_build)],
    ['Spielmodus', gamemodeLabel(world.gamemode)],
    ['Schwierigkeit', difficultyLabel(world.difficulty)],
    ['Speicherprofil', `${formatMiBAsGiB(plan.ramMiB)} · ${plan.upgraded ? 'Upgrade' : 'kostenlos'}`],
    ['CPU', <LiveUsage key="cpu" kind="cpu" ramLimitMiB={plan.ramMiB} />],
    ['RAM', <LiveUsage key="ram" kind="ram" ramLimitMiB={plan.ramMiB} />],
    ['Dateien', `${formatBytes(worldDiskUsage(world.id))} von ${plan.diskGiB} GiB`],
    ['Gespielt', `${formatPlayTime(world.play_ms)} · ${world.starts} ${world.starts === 1 ? 'Start' : 'Starts'}`],
    ['Erstellt', formatRelative(world.created_at)],
  ]

  return (
    <>
      {created && (
        <p className="notice" role="status">
          <Check aria-hidden />
          <span>Deine Welt ist erstellt. Du kannst sie jetzt starten.</span>
        </p>
      )}

      <WorldOverview autoPauseMinutes={plan.autoPauseMinutes} />

      <section className="pt-4">
        <h2 className="eyebrow">Details</h2>
        <dl className="panel mt-3 divide-y divide-line">
          {details.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-6 px-4 py-3 text-[14px]">
              <dt className="text-ink-dim">{label}</dt>
              <dd className="text-right font-semibold">{value}</dd>
            </div>
          ))}
        </dl>
      </section>
    </>
  )
}
