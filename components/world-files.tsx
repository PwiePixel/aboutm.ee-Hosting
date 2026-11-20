'use client'

import { FolderPlus, Save, Trash2 } from 'lucide-react'
import { useActionState, useEffect, useState } from 'react'
import { createFolderAction, deleteEntryAction, saveFileAction } from '@/lib/actions/files'
import { EMPTY } from '@/lib/actions/state'
import { ConfirmButton } from './confirm'
import { FormMessage, SubmitButton } from './form'

export function NewFolder({ worldId, folder }: { worldId: string; folder: string }) {
  const [open, setOpen] = useState(false)
  const [state, action] = useActionState(createFolderAction, EMPTY)

  useEffect(() => {
    if (state.ok) setOpen(false)
  }, [state])

  if (!open) {
    return (
      <button type="button" className="btn" onClick={() => setOpen(true)}>
        <FolderPlus aria-hidden />
        Neuer Ordner
      </button>
    )
  }
  return (
    <form action={action} className="w-full max-w-[420px] space-y-3 sm:w-auto">
      <input type="hidden" name="worldId" value={worldId} />
      <input type="hidden" name="folder" value={folder} />
      <div className="flex gap-2">
        <label htmlFor="folder-name" className="sr-only">
          Name des Ordners
        </label>
        <input
          id="folder-name"
          name="name"
          className="field"
          placeholder="Name des Ordners"
          maxLength={64}
          autoComplete="off"
          autoFocus
          required
        />
        <SubmitButton className="btn btn-primary">Anlegen</SubmitButton>
        <button type="button" className="btn" onClick={() => setOpen(false)}>
          Abbrechen
        </button>
      </div>
      <FormMessage state={state} />
    </form>
  )
}

export function DeleteEntry({
  worldId,
  path,
  name,
  isFolder,
}: {
  worldId: string
  path: string
  name: string
  isFolder: boolean
}) {
  return (
    <ConfirmButton
      className="grid size-9 place-items-center text-ink-faint hover:text-danger"
      ariaLabel={`${name} löschen`}
      title={isFolder ? 'Ordner löschen?' : 'Datei löschen?'}
      text={
        <>
          <span className="font-mono text-ink">{name}</span>
          {isFolder ? ' und alles darin wird' : ' wird'} endgültig gelöscht. Das lässt sich nur über ein Backup
          zurückholen.
        </>
      }
      confirmLabel="Löschen"
      danger
      action={() => deleteEntryAction(worldId, path)}
    >
      <Trash2 className="size-4" aria-hidden />
    </ConfirmButton>
  )
}

export function FileEditor({ worldId, path, content }: { worldId: string; path: string; content: string }) {
  const [state, action] = useActionState(saveFileAction, EMPTY)
  const [value, setValue] = useState(content)
  const [saved, setSaved] = useState(content)

  useEffect(() => {
    if (state.ok) setSaved(value)
    // Nur auf das Ergebnis der Aktion reagieren, nicht auf jede Eingabe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="worldId" value={worldId} />
      <input type="hidden" name="path" value={path} />
      <label htmlFor="file-content" className="sr-only">
        Inhalt von {path}
      </label>
      <textarea
        id="file-content"
        name="content"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        className="field h-[460px] resize-y font-mono !text-[13px]"
      />
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton disabled={value === saved} icon={<Save aria-hidden />}>
          Speichern
        </SubmitButton>
        <span className="text-[13px] text-ink-faint">
          {value === saved ? 'Keine ungespeicherten Änderungen.' : 'Ungespeicherte Änderungen.'}
        </span>
      </div>
      <FormMessage state={state} />
    </form>
  )
}
