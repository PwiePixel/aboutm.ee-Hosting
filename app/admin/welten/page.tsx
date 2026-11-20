import { AdminWorldActions } from '@/components/admin'
import { StatusBadge } from '@/components/world-header'
import { adminWorlds } from '@/lib/admin'
import { requireAdmin } from '@/lib/auth'
import { formatDateTime, formatMiBAsGiB } from '@/lib/format'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default async function AdminWorldsPage() {
  await requireAdmin()
  const worlds = adminWorlds()
  if (worlds.length === 0) {
    return <p className="panel px-4 py-7 text-center text-[14px] text-ink-dim">Es gibt noch keine Welten.</p>
  }
  return (
    <>
      <p className="mb-3 text-[14px] text-ink-dim">
        {worlds.length} {worlds.length === 1 ? 'Welt' : 'Welten'}. Konsole, Dateien und Backups sieht nur das Konto,
        dem die Welt gehört. Über „Paket“ gibst du einer Welt mehr Arbeitsspeicher, Speicherplatz und mehr.
      </p>
      <div className="panel overflow-x-auto">
        <table className="w-full min-w-[900px] text-left text-[14px]">
          <thead className="border-b border-line text-[12px] uppercase tracking-[0.08em] text-ink-faint">
            <tr>
              <th className="px-4 py-3 font-semibold">Welt</th>
              <th className="px-4 py-3 font-semibold">Konto</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 font-semibold">Paket</th>
              <th className="px-4 py-3 font-semibold">Version</th>
              <th className="px-4 py-3 font-semibold">Erstellt</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {worlds.map((world) => (
              <tr key={world.id}>
                <td className="px-4 py-3">
                  <p className="font-semibold">{world.name}</p>
                  <p className="font-mono text-[12px] text-ink-faint">{world.address}</p>
                </td>
                <td className="max-w-[220px] truncate px-4 py-3 text-ink-dim">{world.owner}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={world.status} />
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  <Link href={`/admin/welten/${world.id}`} className="font-semibold underline-offset-4 hover:text-accent hover:underline">
                    {formatMiBAsGiB(world.plan.ramMiB)} · {world.plan.diskGiB} GiB
                  </Link>
                  <p className="text-[12px] text-ink-faint">{world.plan.upgraded ? world.plan.label : 'Standard'} · ändern</p>
                </td>
                <td className="px-4 py-3 text-ink-dim">{world.version}</td>
                <td className="whitespace-nowrap px-4 py-3 text-ink-dim">{formatDateTime(world.createdAt)}</td>
                <td className="px-4 py-2">
                  <AdminWorldActions
                    worldId={world.id}
                    name={world.name}
                    active={world.status !== 'paused' && world.status !== 'stopping'}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
