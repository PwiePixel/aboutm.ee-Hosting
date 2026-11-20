import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { AutoBackupSelect, BackupActions, CreateBackup } from '@/components/world-backups'
import { requireUser } from '@/lib/auth'
import { listBackups } from '@/lib/backups'
import { config } from '@/lib/config'
import { formatBytes, formatDateTime } from '@/lib/format'
import { worldPlan } from '@/lib/plan'
import { getWorld } from '@/lib/worlds'

export const metadata: Metadata = { title: 'Backups' }

export default async function BackupsPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser()
  const world = getWorld(user.id, (await params).id)
  if (!world) notFound()
  const backups = listBackups(world.id)
  const paused = world.status === 'paused'

  return (
    <section>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="eyebrow">Backups</h2>
          <p className="mt-2 text-[14px] text-ink-dim">
            Ein Abbild deiner Welt. Wiederherstellen ersetzt die aktuelle Welt komplett.
          </p>
        </div>
        <CreateBackup worldId={world.id} />
      </div>

      <div className="panel mt-5 flex flex-wrap items-center justify-between gap-4 px-4 py-4">
        <div className="max-w-[620px]">
          <h3 className="font-semibold">Automatische Backups</h3>
          <p className="mt-1 text-[13px] text-ink-dim">
            Wir behalten höchstens {config.maxAutoBackups} automatische Backups — das älteste macht Platz für das
            neueste. Eigene Backups bleiben unberührt (bis zu {config.maxManualBackups}). Alle Backups dieser Welt
            zusammen dürfen {worldPlan(world).backupGiB} GiB belegen.
          </p>
        </div>
        <AutoBackupSelect worldId={world.id} value={world.auto_backup} />
      </div>

      {backups.length === 0 ? (
        <p className="panel mt-5 px-4 py-7 text-center text-[14px] text-ink-dim">
          Noch keine Backups. Erstelle eins, bevor du größere Änderungen machst.
        </p>
      ) : (
        <>
          <ul className="panel mt-5 divide-y divide-line">
            {backups.map((backup) => {
              const label = formatDateTime(backup.created_at)
              return (
                <li key={backup.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div>
                    <p className="font-semibold">{label}</p>
                    <p className="mt-0.5 text-[13px] text-ink-dim">
                      {backup.kind === 'auto' ? 'Automatisch' : 'Eigenes Backup'} · {formatBytes(backup.size_bytes)} ·
                      Minecraft {backup.version}
                    </p>
                  </div>
                  <BackupActions worldId={world.id} backupId={backup.id} label={label} canRestore={paused} />
                </li>
              )
            })}
          </ul>
          {!paused && (
            <p className="mt-3 text-[13px] text-ink-faint">
              Wiederherstellen geht nur, während deine Welt pausiert ist.
            </p>
          )}
        </>
      )}
    </section>
  )
}
