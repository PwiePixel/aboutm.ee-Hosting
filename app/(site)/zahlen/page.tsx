import { Plus } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { readStat } from '@/lib/db'
import { formatDateTime, formatNumber } from '@/lib/format'

export const metadata: Metadata = { title: 'aboutm.ee in Zahlen' }
export const dynamic = 'force-dynamic'

export default function NumbersPage() {
  const hours = Math.floor(readStat('play_seconds') / 3600)
  const figures = [
    { value: readStat('worlds_created'), label: 'Welten erstellt', note: 'seit dem Start von aboutm.ee' },
    { value: readStat('starts'), label: 'Server-Starts', note: 'jeder erfolgreiche Start zählt' },
    { value: readStat('peak_players'), label: 'Spieler gleichzeitig', note: 'bisheriger Höchstwert' },
  ]
  return (
    <div className="wrap pt-14">
      <p className="eyebrow">aboutm.ee in Zahlen</p>
      <h1 className="display mt-5 text-[clamp(40px,8vw,84px)]">
        {formatNumber(hours)} <span className="text-accent">Spielstunden.</span>
      </h1>
      <p className="mt-4 text-ink-dim">Von echten Spielern auf echten Welten.</p>

      <dl className="mt-12 grid gap-px border border-line bg-line sm:grid-cols-3">
        {figures.map((figure) => (
          <div key={figure.label} className="bg-base-soft p-6">
            <dd className="display text-[44px]">{formatNumber(figure.value)}</dd>
            <dt className="mt-3 font-semibold">{figure.label}</dt>
            <p className="mt-1 text-[13px] text-ink-faint">{figure.note}</p>
          </div>
        ))}
      </dl>

      <p className="mt-8 max-w-[640px] text-[13px] text-ink-faint">
        Stand: {formatDateTime(Date.now())}. Spielstunden sind die gemessene Zeit, in der Spieler online waren: zwei
        Spieler eine Stunde lang sind zwei Spielstunden. Server-Starts zählen auch Neustarts.
      </p>

      <div className="mt-16 flex flex-wrap items-center justify-between gap-6 border border-accent bg-accent-wash p-7 sm:p-10">
        <h2 className="display text-[clamp(26px,4.4vw,44px)]">Deine Welt fehlt noch.</h2>
        <Link href="/register" className="btn btn-primary btn-lg max-sm:w-full max-sm:whitespace-normal max-sm:py-3 max-sm:text-center max-sm:leading-snug">
          <Plus aria-hidden />
          Kostenlosen Server erstellen
        </Link>
      </div>
    </div>
  )
}
