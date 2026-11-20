import { LimitsForm, LiveBoard } from '@/components/admin'
import { adminLive, adminTotals } from '@/lib/admin'
import { requireAdmin } from '@/lib/auth'
import { formatNumber } from '@/lib/format'
import { limits } from '@/lib/settings'

export const dynamic = 'force-dynamic'

export default async function AdminLivePage() {
  await requireAdmin()
  const totals = adminTotals()
  const numbers: Array<[string, number]> = [
    ['Konten', totals.users],
    ['Welten insgesamt', totals.worlds],
    ['Server-Starts', totals.starts],
    ['Spielstunden', totals.playHours],
    ['Meiste Spieler gleichzeitig', totals.peak],
  ]
  return (
    <>
      <LiveBoard initial={await adminLive()} />

      <section className="mt-12">
        <h2 className="eyebrow">Grenzen</h2>
        <p className="mb-5 mt-2 max-w-[640px] text-[14px] text-ink-dim">
          Senkst du die Zahl der gleichzeitigen Server unter den aktuellen Stand, laufen die bestehenden weiter — neue
          Starts warten, bis wieder Platz ist.
        </p>
        <LimitsForm limits={limits()} />
      </section>

      <section className="mt-12">
        <h2 className="eyebrow">Insgesamt</h2>
        <dl className="panel mt-3 divide-y divide-line">
          {numbers.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-6 px-4 py-3 text-[14px]">
              <dt className="text-ink-dim">{label}</dt>
              <dd className="font-semibold">{formatNumber(value)}</dd>
            </div>
          ))}
        </dl>
      </section>
    </>
  )
}
