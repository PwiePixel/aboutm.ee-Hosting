import { Plus } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { db } from '@/lib/db'
import { formatDateTime, formatNumber } from '@/lib/format'
import { playHeadline, totals } from '@/lib/stats'

export const metadata: Metadata = { title: 'aboutm.ee in Zahlen' }
export const dynamic = 'force-dynamic'

const dayMonth = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Berlin' })
const longDate = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Berlin' })

export default function NumbersPage() {
  const stats = totals()
  const headline = playHeadline(stats.playMs)
  const onlineNow = (db().prepare(`SELECT COUNT(*) AS n FROM worlds WHERE status = 'online'`).get() as { n: number }).n
  const exactHours = stats.playMs / 3_600_000

  const figures = [
    { value: stats.worldsCreated, label: 'Server erstellt', note: 'seit dem Start von aboutm.ee' },
    { value: stats.starts, label: 'Server-Starts', note: 'jeder erfolgreiche Start zählt' },
    {
      value: stats.peakPlayers,
      label: 'Spieler gleichzeitig',
      note: stats.peakPlayersAt ? `Rekord am ${dayMonth.format(new Date(stats.peakPlayersAt))}` : 'noch kein Rekord',
    },
    { value: stats.uniquePlayers, label: 'Verschiedene Spieler', note: 'jeder Minecraft-Name zählt einmal' },
    {
      value: stats.peakServers,
      label: 'Server gleichzeitig',
      note: stats.peakServersAt ? `Rekord am ${dayMonth.format(new Date(stats.peakServersAt))}` : 'noch kein Rekord',
    },
    { value: onlineNow, label: 'Server gerade online', note: 'in diesem Moment' },
  ]

  return (
    <div className="wrap pt-14">
      <p className="eyebrow">aboutm.ee in Zahlen</p>
      <h1 className="display mt-5 text-[clamp(40px,8vw,84px)]">
        {headline.prefix && <span className="text-ink-dim">{headline.prefix} </span>}
        {headline.value} <span className="text-accent">{headline.unit}.</span>
      </h1>
      <p className="mt-4 text-ink-dim">
        Von echten Spielern auf echten Servern{stats.since ? `, gezählt seit dem ${longDate.format(new Date(stats.since))}` : ''}.
      </p>

      <dl className="mt-12 grid gap-px border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
        {figures.map((figure) => (
          <div key={figure.label} className="bg-base-soft p-6">
            <dd className="display text-[44px]">{formatNumber(figure.value)}</dd>
            <dt className="mt-3 font-semibold">{figure.label}</dt>
            <p className="mt-1 text-[13px] text-ink-faint">{figure.note}</p>
          </div>
        ))}
      </dl>

      <p className="mt-8 max-w-[680px] text-[13px] text-ink-faint">
        Stand: {formatDateTime(Date.now())}. Genau sind es{' '}
        {exactHours.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} Spielstunden.
        Spielstunden sind die gemessene Zeit, in der Spieler online waren: zwei Spieler eine Stunde lang sind zwei
        Spielstunden. Server-Starts zählen auch Neustarts. Minecraft-Namen speichern wir für diese Zählung nicht — nur
        einen nicht umkehrbaren Fingerabdruck.
      </p>

      <div className="mt-16 flex flex-wrap items-center justify-between gap-6 border border-accent bg-accent-wash p-7 sm:p-10">
        <h2 className="display text-[clamp(26px,4.4vw,44px)]">Deine Welt fehlt noch.</h2>
        <Link
          href="/register"
          className="btn btn-primary btn-lg max-sm:w-full max-sm:whitespace-normal max-sm:py-3 max-sm:text-center max-sm:leading-snug"
        >
          <Plus aria-hidden />
          Kostenlosen Server erstellen
        </Link>
      </div>
    </div>
  )
}
