import { ChevronLeft } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PlanForm } from '@/components/admin'
import { StatusBadge } from '@/components/world-header'
import { adminWorld } from '@/lib/admin'
import { requireAdmin } from '@/lib/auth'
import { defaultPlan, hostCapacity } from '@/lib/plan'

export const dynamic = 'force-dynamic'

export default async function AdminWorldPlanPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin()
  const world = adminWorld((await params).id)
  if (!world) notFound()
  const running = world.status !== 'paused'

  return (
    <>
      <Link href="/admin/welten" className="inline-flex items-center gap-1.5 text-[14px] text-ink-dim hover:text-ink">
        <ChevronLeft className="size-4" aria-hidden />
        Alle Welten
      </Link>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <h2 className="heading text-[24px]">{world.name}</h2>
        <StatusBadge status={world.status} />
        <span className="border border-line px-2 py-0.5 font-mono text-[12px] uppercase tracking-[0.08em] text-ink-dim">
          {world.plan.upgraded ? 'Upgrade' : 'Standardpaket'}
        </span>
      </div>
      <p className="mt-1 text-[14px] text-ink-dim">
        {world.owner} · <span className="font-mono">{world.address}</span>
      </p>

      <section className="mt-8">
        <h3 className="eyebrow">Paket</h3>
        <p className="mt-2 max-w-[720px] text-[14px] text-ink-dim">
          Was dieser Welt zur Verfügung steht. Speicherplatz, Backup-Speicher und Auto-Pause gelten sofort;
          Arbeitsspeicher, CPU und Spielerplätze übernimmt der Server beim nächsten Start
          {running ? ' — diese Welt läuft gerade, also erst nach einem Neustart.' : '.'}
        </p>
        <div className="panel mt-4 p-5">
          <PlanForm
            worldId={world.id}
            plan={world.plan}
            standard={defaultPlan()}
            host={hostCapacity()}
          />
        </div>
        <p className="mt-3 max-w-[720px] text-[13px] text-ink-faint">
          Arbeitsspeicher wird nicht reserviert: Vergib insgesamt nicht mehr, als gleichzeitig laufende Welten auf
          diesem Server wirklich belegen können — sonst beendet das System bei Speichermangel einzelne Server.
        </p>
      </section>
    </>
  )
}
