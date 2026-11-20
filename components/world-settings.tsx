'use client'

import { LoaderCircle, Trash2, UserPlus, X } from 'lucide-react'
import { useActionState, useEffect, useRef, useState, useTransition } from 'react'
import { EMPTY } from '@/lib/actions/state'
import {
  addWhitelistPlayerAction,
  changeVersionAction,
  deleteWorldAction,
  removeWhitelistPlayerAction,
  renameWorldAction,
  setWhitelistAction,
  updateGameSettingsAction,
} from '@/lib/actions/worlds'
import { WORLD_NAME_MAX } from '@/lib/validation'
import { DIFFICULTIES, GAMEMODES } from '@/lib/versions'
import { ConfirmButton } from './confirm'
import { FormMessage, SubmitButton } from './form'

export function RenameForm({ worldId, name }: { worldId: string; name: string }) {
  const [state, action] = useActionState(renameWorldAction, EMPTY)
  const [value, setValue] = useState(name)
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="worldId" value={worldId} />
      <div className="flex gap-2">
        <label htmlFor="world-name" className="sr-only">
          Name der Welt
        </label>
        <input
          id="world-name"
          name="name"
          className="field"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          maxLength={WORLD_NAME_MAX}
          autoComplete="off"
          required
        />
        <SubmitButton disabled={value.trim() === name || value.trim() === ''}>Speichern</SubmitButton>
      </div>
      <FormMessage state={state} />
    </form>
  )
}

export function GameSettingsForm({
  worldId,
  gamemode,
  difficulty,
}: {
  worldId: string
  gamemode: string
  difficulty: string
}) {
  const [state, action] = useActionState(updateGameSettingsAction, EMPTY)
  const [mode, setMode] = useState(gamemode)
  const [level, setLevel] = useState(difficulty)
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="worldId" value={worldId} />
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div>
          <label htmlFor="settings-gamemode" className="label">
            Spielmodus
          </label>
          <select
            id="settings-gamemode"
            name="gamemode"
            className="field"
            value={mode}
            onChange={(event) => setMode(event.target.value)}
          >
            {GAMEMODES.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="settings-difficulty" className="label">
            Schwierigkeit
          </label>
          <select
            id="settings-difficulty"
            name="difficulty"
            className="field"
            value={level}
            onChange={(event) => setLevel(event.target.value)}
          >
            {DIFFICULTIES.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
        </div>
        <SubmitButton disabled={mode === gamemode && level === difficulty}>Speichern</SubmitButton>
      </div>
      <p className="hint !mt-0">Der Spielmodus gilt für alle, die neu dazukommen.</p>
      <FormMessage state={state} />
    </form>
  )
}

export function WhitelistEditor({
  worldId,
  enabled,
  players,
}: {
  worldId: string
  enabled: boolean
  players: string[]
}) {
  const [state, action] = useActionState(addWhitelistPlayerAction, EMPTY)
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const form = useRef<HTMLFormElement>(null)

  useEffect(() => {
    if (!state.error) form.current?.reset()
  }, [state])

  const call = (run: () => Promise<{ error?: string }>) => {
    setError(null)
    start(async () => {
      const result = await run()
      if (result.error) setError(result.error)
    })
  }

  return (
    <div className="space-y-4">
      <label className="flex cursor-pointer items-center gap-3">
        <input
          type="checkbox"
          checked={enabled}
          disabled={pending}
          onChange={(event) => {
            const next = event.target.checked
            call(() => setWhitelistAction(worldId, next))
          }}
          className="size-4 accent-[var(--color-accent)]"
        />
        <span className="font-semibold">Nur Spieler auf der Liste dürfen beitreten</span>
        {pending && <LoaderCircle className="spin size-4 text-ink-faint" aria-hidden />}
      </label>

      <form ref={form} action={action} className="flex max-w-[460px] gap-2">
        <input type="hidden" name="worldId" value={worldId} />
        <label htmlFor="whitelist-player" className="sr-only">
          Minecraft-Name
        </label>
        <input
          id="whitelist-player"
          name="player"
          className="field"
          placeholder="Minecraft-Name"
          maxLength={16}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          required
        />
        <SubmitButton className="btn" icon={<UserPlus aria-hidden />}>
          Hinzufügen
        </SubmitButton>
      </form>
      <FormMessage state={state} />
      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}

      {players.length === 0 ? (
        <p className="text-[14px] text-ink-dim">Noch niemand auf der Liste.</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {players.map((player) => (
            <li key={player} className="flex items-center gap-1 bg-panel-2 py-1 pl-3 pr-1 font-mono text-[13px]">
              {player}
              <button
                type="button"
                aria-label={`${player} entfernen`}
                disabled={pending}
                onClick={() => call(() => removeWhitelistPlayerAction(worldId, player))}
                className="grid size-7 place-items-center text-ink-faint hover:text-danger"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function VersionForm({
  worldId,
  options,
  disabled,
}: {
  worldId: string
  options: string[]
  disabled: boolean
}) {
  const [state, action] = useActionState(changeVersionAction, EMPTY)
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="worldId" value={worldId} />
      <div className="flex gap-2">
        <label htmlFor="new-version" className="sr-only">
          Neue Version
        </label>
        <select id="new-version" name="version" className="field" defaultValue={options[0]} disabled={disabled}>
          {options.map((id) => (
            <option key={id} value={id}>
              Minecraft {id}
            </option>
          ))}
        </select>
        <SubmitButton className="btn" disabled={disabled}>
          Version wechseln
        </SubmitButton>
      </div>
      <FormMessage state={state} />
    </form>
  )
}

export function DeleteWorld({ worldId, name }: { worldId: string; name: string }) {
  return (
    <ConfirmButton
      className="btn btn-danger"
      title="Welt wirklich löschen?"
      text={
        <>
          <strong className="text-ink">{name}</strong> wird mit allen Dateien und Backups unwiderruflich gelöscht.
        </>
      }
      confirmLabel="Endgültig löschen"
      danger
      typeToConfirm={name}
      action={async (typed) => {
        const data = new FormData()
        data.set('worldId', worldId)
        data.set('confirm', typed)
        return deleteWorldAction(EMPTY, data)
      }}
    >
      <Trash2 aria-hidden />
      Welt löschen
    </ConfirmButton>
  )
}
