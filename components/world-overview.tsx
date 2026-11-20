'use client'

import { LoaderCircle, Play, RotateCw, Square } from 'lucide-react'
import type { ReactNode } from 'react'
import { useWorldLive } from './world-live'

const PANEL_COLOR = {
  paused: 'bg-st-paused text-base',
  stopping: 'bg-st-paused text-base',
  queued: 'bg-st-starting text-base',
  starting: 'bg-st-starting text-base',
  online: 'bg-st-online text-accent-ink',
} as const

const STARTUP_STEPS = ['Server wird gestartet …', 'Paper wird vorbereitet …', 'Welt wird geladen …']

function StatusPanel({
  tone,
  word,
  sub,
  title,
  children,
}: {
  tone: keyof typeof PANEL_COLOR
  word: string
  sub?: string
  title: string
  children: ReactNode
}) {
  return (
    <section aria-live="polite" className="panel grid sm:grid-cols-[minmax(200px,28%)_1fr]">
      <div className={`flex min-h-[120px] flex-col justify-center px-6 py-8 sm:min-h-[190px] ${PANEL_COLOR[tone]}`}>
        <p className="display text-[30px]">{word}</p>
        {sub && <p className="mt-1.5 font-mono text-[13px] font-bold uppercase tracking-[0.08em]">{sub}</p>}
      </div>
      <div className="flex flex-col justify-center px-6 py-7">
        <h2 className="heading text-[18px]">{title}</h2>
        {children}
      </div>
    </section>
  )
}

const PAUSE_NOTE: Record<string, string> = {
  idle: 'Es war eine Weile niemand online — deshalb hat sich deine Welt von selbst pausiert.',
  error: 'Der letzte Start hat nicht geklappt. Versuch es noch einmal — bleibt es dabei, schreib uns über die Hilfe.',
  stopped: 'Der Server wurde über die Konsole beendet.',
  admin: 'Deine Welt wurde vom aboutm.ee-Team pausiert.',
  disk: 'Der Speicherplatz deiner Welt ist voll — deshalb wurde sie pausiert. Lösche unter „Dateien“ etwas, bevor du sie wieder startest.',
}

export function WorldOverview({ autoPauseMinutes }: { autoPauseMinutes: number }) {
  const { live, busy, run } = useWorldLive()
  const playerCount = live.players.length

  if (live.status === 'paused') {
    return (
      <StatusPanel tone="paused" word="Pausiert" title="Deine Welt macht Pause">
        <p className="mt-2 max-w-[520px] text-ink-dim">
          {(live.pauseReason && PAUSE_NOTE[live.pauseReason]) ||
            'Alle Dateien und dein Fortschritt sind gespeichert.'}{' '}
          {live.slotsFree > 0
            ? 'Ein Serverplatz ist frei — du bist meist in wenigen Augenblicken wieder online.'
            : 'Gerade sind alle Serverplätze belegt. Dein Start reiht sich in die Warteschlange ein.'}
        </p>
        <div className="mt-5">
          <button type="button" className="btn btn-primary" onClick={() => run('start')} disabled={busy !== null}>
            {busy === 'start' ? <LoaderCircle className="spin" aria-hidden /> : <Play aria-hidden />}
            Welt starten
          </button>
        </div>
      </StatusPanel>
    )
  }

  if (live.status === 'queued') {
    return (
      <StatusPanel tone="queued" word="Wartet" sub={`Platz ${live.queuePosition}`} title="Du stehst in der Warteschlange">
        <p className="mt-2 max-w-[520px] text-ink-dim">
          Alle Serverplätze sind gerade belegt. Sobald einer frei wird, startet deine Welt von selbst — du kannst diese
          Seite offen lassen oder später wiederkommen.
        </p>
        <div className="mt-5">
          <button type="button" className="btn btn-danger" onClick={() => run('stop')} disabled={busy !== null}>
            {busy === 'stop' ? <LoaderCircle className="spin" aria-hidden /> : <Square aria-hidden />}
            Warten abbrechen
          </button>
        </div>
      </StatusPanel>
    )
  }

  if (live.status === 'starting') {
    return (
      <StatusPanel tone="starting" word="Welt lädt …" title="Deine Welt wird geladen">
        <p className="mt-2 max-w-[520px] text-ink-dim">
          Paper wird vorbereitet und die Welt geladen. Bei großen Welten kann das ein paar Minuten dauern.
        </p>
        <ol className="mt-4 space-y-1.5 text-[14px]">
          {STARTUP_STEPS.map((step, index) => (
            <li
              key={step}
              className={`flex items-center gap-2.5 ${index <= live.startupStep ? 'text-ink' : 'text-ink-faint'}`}
            >
              <span
                className={`size-1.5 rounded-full ${index <= live.startupStep ? 'bg-st-starting' : 'bg-line-strong'}`}
                aria-hidden
              />
              {step}
            </li>
          ))}
        </ol>
        <div className="mt-5">
          <button type="button" className="btn btn-danger" onClick={() => run('stop')} disabled={busy !== null}>
            {busy === 'stop' ? <LoaderCircle className="spin" aria-hidden /> : <Square aria-hidden />}
            Welt pausieren
          </button>
        </div>
      </StatusPanel>
    )
  }

  if (live.status === 'stopping') {
    return (
      <StatusPanel tone="stopping" word="Pausiert …" title="Wird pausiert">
        <p className="mt-2 max-w-[520px] text-ink-dim">
          Wir speichern deine Welt. Bei großen Welten kann das einige Minuten dauern. Du kannst diese Seite verlassen —
          der Vorgang läuft weiter.
        </p>
        <p className="mt-4 flex items-center gap-2 text-[14px] text-ink-dim">
          <LoaderCircle className="spin size-4" aria-hidden />
          Einen Moment …
        </p>
      </StatusPanel>
    )
  }

  return (
    <>
      <StatusPanel
        tone="online"
        word="Online"
        sub={`${playerCount} Spieler`}
        title="Deine Welt ist online"
      >
        <p className="mt-2 max-w-[520px] text-ink-dim">
          {playerCount === 0
            ? `Gerade spielt niemand — schick deinen Freunden die IP. Nach ${autoPauseMinutes} Minuten ohne Spieler pausiert die Welt von selbst.`
            : playerCount === 1
              ? 'Gerade ist ein Spieler auf deiner Welt.'
              : `Gerade sind ${playerCount} Spieler auf deiner Welt.`}
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <button type="button" className="btn" onClick={() => run('restart')} disabled={busy !== null}>
            {busy === 'restart' ? <LoaderCircle className="spin" aria-hidden /> : <RotateCw aria-hidden />}
            Neustarten
          </button>
          <button type="button" className="btn btn-danger" onClick={() => run('stop')} disabled={busy !== null}>
            {busy === 'stop' ? <LoaderCircle className="spin" aria-hidden /> : <Square aria-hidden />}
            Welt pausieren
          </button>
        </div>
      </StatusPanel>

      <section className="pt-4">
        <h2 className="heading text-[15px]">Wer ist da</h2>
        {playerCount === 0 ? (
          <p className="mt-2 text-[14px] text-ink-dim">Gerade ist niemand verbunden.</p>
        ) : (
          <ul className="mt-3 flex flex-wrap gap-2">
            {live.players.map((player) => (
              <li key={player} className="bg-panel-2 px-3 py-1.5 font-mono text-[13px]">
                {player}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}

/** CPU und RAM in der Detailtabelle — nur aussagekräftig, solange die Welt läuft. */
export function LiveUsage({ kind, ramLimitMiB }: { kind: 'cpu' | 'ram'; ramLimitMiB: number }) {
  const { live } = useWorldLive()
  const running = live.status === 'starting' || live.status === 'online'
  if (!running) return <>Offline</>
  if (kind === 'cpu') return <>{live.cpuPercent === null ? '…' : `${live.cpuPercent} %`}</>
  if (live.ramMiB === null) return <>…</>
  const gib = (value: number) => (value / 1024).toLocaleString('de-DE', { maximumFractionDigits: 1 })
  return (
    <>
      {gib(live.ramMiB)} von {gib(ramLimitMiB)} GiB
    </>
  )
}
