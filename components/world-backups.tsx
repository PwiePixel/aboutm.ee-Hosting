'use client'

import { Archive, LoaderCircle, RotateCcw, Trash2 } from 'lucide-react'
import { useState, useTransition } from 'react'
import {
  createBackupAction,
  deleteBackupAction,
  restoreBackupAction,
  setAutoBackupAction,
} from '@/lib/actions/backups'
import type { ActionState } from '@/lib/actions/state'
import { ConfirmButton } from './confirm'
import { FormMessage } from './form'

export function CreateBackup({ worldId }: { worldId: string }) {
  const [pending, start] = useTransition()
  const [state, setState] = useState<ActionState>({})
  return (
    <div className="flex flex-col items-end gap-3">
      <button
        type="button"
        className="btn btn-primary"
        disabled={pending}
        onClick={() => start(async () => setState(await createBackupAction(worldId)))}
      >
        {pending ? <LoaderCircle className="spin" aria-hidden /> : <Archive aria-hidden />}
        Backup erstellen
      </button>
      <FormMessage state={state} />
    </div>
  )
}

export function AutoBackupSelect({ worldId, value }: { worldId: string; value: string }) {
  const [pending, start] = useTransition()
  const [current, setCurrent] = useState(value)
  const [error, setError] = useState<string | null>(null)
  return (
    <div>
      <label htmlFor="auto-backup" className="sr-only">
        Automatische Backups
      </label>
      <select
        id="auto-backup"
        className="field min-w-[210px]"
        value={current}
        disabled={pending}
        onChange={(event) => {
          const next = event.target.value
          const previous = current
          setCurrent(next)
          setError(null)
          start(async () => {
            const result = await setAutoBackupAction(worldId, next)
            if (result.error) {
              setCurrent(previous)
              setError(result.error)
            }
          })
        }}
      >
        <option value="off">Aus</option>
        <option value="on_pause">Nach jedem Pausieren</option>
      </select>
      {error && (
        <p className="mt-2 text-[13px] text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

export function BackupActions({
  worldId,
  backupId,
  label,
  canRestore,
}: {
  worldId: string
  backupId: string
  label: string
  canRestore: boolean
}) {
  return (
    <div className="flex items-center gap-2">
      <ConfirmButton
        className="btn min-h-[38px] px-3 text-[13px]"
        disabled={!canRestore}
        title="Backup wiederherstellen?"
        text={
          <>
            Deine aktuelle Welt wird vollständig durch den Stand vom <strong className="text-ink">{label}</strong>{' '}
            ersetzt. Alles, was danach gebaut wurde, ist weg.
          </>
        }
        confirmLabel="Wiederherstellen"
        danger
        action={() => restoreBackupAction(worldId, backupId)}
      >
        <RotateCcw aria-hidden />
        Wiederherstellen
      </ConfirmButton>
      <ConfirmButton
        className="grid size-9 place-items-center text-ink-faint hover:text-danger"
        ariaLabel={`Backup vom ${label} löschen`}
        title="Backup löschen?"
        text={
          <>
            Das Backup vom <strong className="text-ink">{label}</strong> wird endgültig gelöscht.
          </>
        }
        confirmLabel="Löschen"
        danger
        action={() => deleteBackupAction(worldId, backupId)}
      >
        <Trash2 className="size-4" aria-hidden />
      </ConfirmButton>
    </div>
  )
}
