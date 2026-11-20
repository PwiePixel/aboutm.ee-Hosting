'use client'

import { useActionState, useState } from 'react'
import { createWorldAction } from '@/lib/actions/worlds'
import { EMPTY } from '@/lib/actions/state'
import { SEED_MAX, WORLD_NAME_MAX } from '@/lib/validation'
import {
  DIFFICULTIES,
  GAMEMODES,
  RECOMMENDED_VERSION,
  VERSIONS,
  difficultyLabel,
  findVersion,
  gamemodeLabel,
} from '@/lib/versions'
import { FormMessage, SubmitButton } from './form'

function Step({ number, title, children }: { number: number; title: string; children: React.ReactNode }) {
  return (
    <section className="mt-12 first:mt-0">
      <h2 className="flex items-baseline gap-3">
        <span className="display text-[24px] text-ink-faint">{number}</span>
        <span className="heading text-[17px]">{title}</span>
      </h2>
      <div className="mt-5">{children}</div>
    </section>
  )
}

export function NewWorldForm({ ramLabel, autoPauseMinutes }: { ramLabel: string; autoPauseMinutes: number }) {
  const [state, action] = useActionState(createWorldAction, EMPTY)
  const initial = state.values
  const [name, setName] = useState(initial?.name ?? '')
  const [version, setVersion] = useState(findVersion(initial?.version ?? '')?.id ?? RECOMMENDED_VERSION.id)
  const [gamemode, setGamemode] = useState(initial?.gamemode || 'survival')
  const [difficulty, setDifficulty] = useState(initial?.difficulty || 'easy')
  const [seed, setSeed] = useState(initial?.seed ?? '')
  const [whitelist, setWhitelist] = useState(initial?.whitelist === 'on')

  const chosen = findVersion(version) ?? RECOMMENDED_VERSION
  const summary: Array<[string, string]> = [
    ['Version', `Minecraft ${chosen.id}`],
    ['Paper-Build', String(chosen.build)],
    ['Spielmodus', gamemodeLabel(gamemode)],
    ['Schwierigkeit', difficultyLabel(difficulty)],
    ['RAM', ramLabel],
    ['Auto-Pause', `nach ${autoPauseMinutes} min`],
    ['Welt', 'bleibt gespeichert'],
    ['Whitelist', whitelist ? 'an' : 'aus'],
    ['Seed', seed.trim() ? 'eigener' : 'zufällig'],
  ]

  return (
    <form action={action} className="mt-10 grid gap-10 lg:grid-cols-[1fr_304px] lg:gap-14">
      <div>
        <Step number={1} title="Name">
          <label htmlFor="name" className="label">
            Wie soll deine Welt heißen?
          </label>
          <input
            id="name"
            name="name"
            className="field"
            placeholder="Freunde SMP"
            maxLength={WORLD_NAME_MAX}
            autoComplete="off"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-describedby="name-hint"
          />
          <p id="name-hint" className="hint">
            Steht in deiner Übersicht. Lässt sich später ändern.
          </p>
        </Step>

        <Step number={2} title="Version">
          <fieldset>
            <legend className="sr-only">Minecraft-Version</legend>
            <div className="border border-line">
              {VERSIONS.map((entry, index) => {
                const selected = entry.id === version
                return (
                  <label
                    key={entry.id}
                    className={`flex cursor-pointer items-center gap-3 border-l-2 px-4 py-3.5 ${index > 0 ? 'border-t border-t-line' : ''} ${
                      selected ? 'border-l-accent bg-accent-wash' : 'border-l-transparent hover:bg-panel'
                    }`}
                  >
                    <input
                      type="radio"
                      name="version"
                      value={entry.id}
                      checked={selected}
                      onChange={() => setVersion(entry.id)}
                      className="size-4 accent-[var(--color-accent)]"
                    />
                    <span className="font-semibold">Minecraft {entry.id}</span>
                    <span
                      className={`ml-auto font-mono text-[11px] font-bold uppercase tracking-[0.1em] ${
                        entry.recommended ? 'text-accent' : 'text-ink-faint'
                      }`}
                    >
                      {entry.recommended ? 'Empfohlen' : index > 0 ? 'Älter' : ''}
                    </span>
                  </label>
                )
              })}
            </div>
          </fieldset>
          <p className="hint">
            <strong className="text-ink">Minecraft Java – Version {chosen.id} erforderlich.</strong> Alle, die
            mitspielen, brauchen genau diese Version. Später kannst du nur auf eine neuere wechseln.
          </p>
        </Step>

        <Step number={3} title="Spieleinstellungen">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="gamemode" className="label">
                Spielmodus
              </label>
              <select
                id="gamemode"
                name="gamemode"
                className="field"
                value={gamemode}
                onChange={(event) => setGamemode(event.target.value)}
              >
                {GAMEMODES.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="difficulty" className="label">
                Schwierigkeit
              </label>
              <select
                id="difficulty"
                name="difficulty"
                className="field"
                value={difficulty}
                onChange={(event) => setDifficulty(event.target.value)}
              >
                {DIFFICULTIES.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="hint">So startet eure Welt. In den Einstellungen jederzeit änderbar.</p>
        </Step>

        <Step number={4} title="World Seed">
          <label htmlFor="seed" className="label">
            World Seed (optional)
          </label>
          <input
            id="seed"
            name="seed"
            className="field"
            placeholder="Zum Beispiel: aboutmee mit Freunden"
            maxLength={SEED_MAX}
            autoComplete="off"
            value={seed}
            onChange={(event) => setSeed(event.target.value)}
            aria-describedby="seed-hint"
          />
          <p id="seed-hint" className="hint">
            Leer lassen für eine zufällige Welt.
          </p>
        </Step>

        <Step number={5} title="Whitelist">
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              name="whitelist"
              checked={whitelist}
              onChange={(event) => setWhitelist(event.target.checked)}
              className="mt-1 size-4 flex-none accent-[var(--color-accent)]"
            />
            <span className="text-ink-dim">
              <strong className="text-ink">Nur eingeladene Spieler können beitreten.</strong> Die Spieler trägst du
              nach dem Erstellen in den Einstellungen ein. Jederzeit umschaltbar.
            </span>
          </label>
        </Step>
      </div>

      <aside className="lg:sticky lg:top-6 lg:self-start">
        <div className="bg-accent p-6 text-accent-ink">
          <p className="font-mono text-[12px] font-bold uppercase tracking-[0.14em] opacity-80">Deine Welt</p>
          <p className="heading mt-2 break-words text-[24px]">{name.trim() || 'Ohne Namen'}</p>
          <dl className="mt-5 space-y-2.5 text-[14px]">
            {summary.map(([label, value]) => (
              <div key={label} className="flex justify-between gap-4">
                <dt className="opacity-80">{label}</dt>
                <dd className="text-right font-semibold">{value}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-6">
            <SubmitButton className="btn w-full border-accent-ink text-accent-ink uppercase tracking-[0.04em] hover:!bg-accent-strong">
              Welt erstellen
            </SubmitButton>
          </div>
          <p className="mt-4 text-[13px] opacity-80">
            Wird angelegt und bleibt zunächst pausiert. Starten mit einem Klick.
          </p>
        </div>
        <div className="mt-4">
          <FormMessage state={state} />
        </div>
      </aside>
    </form>
  )
}
