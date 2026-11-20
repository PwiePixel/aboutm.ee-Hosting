import { LimitsForm, LiveBoard } from '@/components/admin'
import { adminCounts, adminLive } from '@/lib/admin'
import { requireAdmin } from '@/lib/auth'
import { config } from '@/lib/config'
import { db } from '@/lib/db'
import { dnsEnabled, dnsUsage } from '@/lib/dns'
import { formatDateTime, formatNumber } from '@/lib/format'
import { limits } from '@/lib/settings'
import { dailyStats, formatPlayTime, totals } from '@/lib/stats'

export const dynamic = 'force-dynamic'

const weekday = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'UTC' })

export default async function AdminLivePage() {
  await requireAdmin()
  const counts = adminCounts()
  const stats = totals()
  const days = dailyStats(14)
  const usage = await dnsUsage()
  const withoutRecord = (
    db().prepare('SELECT COUNT(*) AS n FROM worlds WHERE port IS NOT NULL AND dns_record_id IS NULL').get() as { n: number }
  ).n
  const nearLimit = usage?.quota ? usage.used >= usage.quota * 0.9 : false
  const busiest = Math.max(1, ...days.map((day) => day.playMs))

  const numbers: Array<[string, string]> = [
    ['Konten', formatNumber(counts.users)],
    ['Welten vorhanden', formatNumber(counts.worlds)],
    ['Welten erstellt (insgesamt)', formatNumber(stats.worldsCreated)],
    ['Server-Starts', formatNumber(stats.starts)],
    ['Spielzeit', formatPlayTime(stats.playMs)],
    ['Verschiedene Spieler', formatNumber(stats.uniquePlayers)],
    [
      'Meiste Spieler gleichzeitig',
      `${formatNumber(stats.peakPlayers)}${stats.peakPlayersAt ? ` · ${formatDateTime(stats.peakPlayersAt)}` : ''}`,
    ],
    [
      'Meiste Server gleichzeitig',
      `${formatNumber(stats.peakServers)}${stats.peakServersAt ? ` · ${formatDateTime(stats.peakServersAt)}` : ''}`,
    ],
    ['Gezählt seit', stats.since ? formatDateTime(stats.since) : '–'],
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
        <h2 className="eyebrow">Adressen der Welten</h2>
        <dl className="panel mt-3 divide-y divide-line">
          <div className="flex justify-between gap-6 px-4 py-3 text-[14px]">
            <dt className="text-ink-dim">Eigene Adresse je Welt (SRV-Eintrag)</dt>
            <dd className="text-right font-semibold">
              {dnsEnabled() ? `an — mc-….${config.serverDomain}` : 'aus — kein Cloudflare-Zugang hinterlegt'}
            </dd>
          </div>
          <div className="flex justify-between gap-6 px-4 py-3 text-[14px]">
            <dt className="text-ink-dim">Adresse dieses Servers</dt>
            <dd className="text-right font-semibold">
              {config.nodeHost} · Ports {config.portMin}–{config.portMax}
            </dd>
          </div>
          {usage && (
            <div className="flex justify-between gap-6 px-4 py-3 text-[14px]">
              <dt className="text-ink-dim">DNS-Einträge der Domain bei Cloudflare</dt>
              <dd className={`text-right font-semibold ${nearLimit ? 'text-st-starting' : ''}`}>
                {formatNumber(usage.used)}
                {usage.quota ? ` von ${formatNumber(usage.quota)}` : ''} belegt
              </dd>
            </div>
          )}
          {dnsEnabled() && withoutRecord > 0 && (
            <div className="flex justify-between gap-6 px-4 py-3 text-[14px]">
              <dt className="text-ink-dim">Welten ohne eigenen Eintrag</dt>
              <dd className="text-right font-semibold text-st-starting">
                {formatNumber(withoutRecord)} — erreichbar über {config.nodeHost}:&lt;Port&gt;
              </dd>
            </div>
          )}
        </dl>
        <p className="mt-3 max-w-[680px] text-[13px] text-ink-faint">
          Jede Welt braucht einen DNS-Eintrag. Cloudflare begrenzt deren Zahl je Domain (kostenlos 200, bei vor
          September 2024 angelegten Domains 1.000, im Pro-Tarif 3.500). Ist die Grenze erreicht, bleiben neue Welten
          trotzdem erreichbar — über die Adresse des Servers mit ihrem Port statt über einen eigenen Namen.
        </p>
      </section>

      <section className="mt-12">
        <h2 className="eyebrow">Die letzten 14 Tage</h2>
        <div className="panel mt-3 overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-[14px]">
            <caption className="sr-only">Statistik je Tag, neuester Tag zuerst</caption>
            <thead className="border-b border-line text-[12px] uppercase tracking-[0.08em] text-ink-faint">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">Tag</th>
                <th scope="col" className="px-4 py-3 font-semibold">Spielzeit</th>
                <th scope="col" className="px-4 py-3 text-right font-semibold">Starts</th>
                <th scope="col" className="px-4 py-3 text-right font-semibold">Neue Welten</th>
                <th scope="col" className="px-4 py-3 text-right font-semibold">Neue Spieler</th>
                <th scope="col" className="px-4 py-3 text-right font-semibold">Spitze Spieler</th>
                <th scope="col" className="px-4 py-3 text-right font-semibold">Spitze Server</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {days.map((day) => (
                <tr key={day.day}>
                  <th scope="row" className="whitespace-nowrap px-4 py-2.5 font-semibold">
                    {weekday.format(new Date(`${day.day}T12:00:00Z`))}
                  </th>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-3">
                      <span className="w-[72px] whitespace-nowrap text-ink-dim">{formatPlayTime(day.playMs)}</span>
                      <span className="h-1.5 min-w-[80px] flex-1 bg-panel-2" aria-hidden>
                        <span className="block h-full bg-accent" style={{ width: `${(day.playMs / busiest) * 100}%` }} />
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatNumber(day.starts)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatNumber(day.worldsCreated)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatNumber(day.uniquePlayers)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatNumber(day.peakPlayers)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatNumber(day.peakServers)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-12">
        <h2 className="eyebrow">Insgesamt</h2>
        <dl className="panel mt-3 divide-y divide-line">
          {numbers.map(([label, value]) => (
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
