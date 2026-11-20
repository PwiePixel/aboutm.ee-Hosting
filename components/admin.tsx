'use client'

import { Square, Trash2, Upload } from 'lucide-react'
import Link from 'next/link'
import { useSelectedLayoutSegment } from 'next/navigation'
import { useActionState, useEffect, useState } from 'react'
import {
  adminDeleteFeedbackAction,
  adminDeleteUserAction,
  adminDeleteWorldAction,
  adminPauseWorldAction,
  removeImageAction,
  resetWorldPlanAction,
  saveImprintAction,
  saveLimitsAction,
  saveWorldPlanAction,
  uploadImageAction,
} from '@/lib/actions/admin'
import { EMPTY } from '@/lib/actions/state'
import type { AdminLive } from '@/lib/admin'
import type { Imprint } from '@/lib/imprint'
import type { Plan, PlanValues } from '@/lib/plan'
import type { Limits } from '@/lib/settings'
import { ConfirmButton } from './confirm'
import { FormMessage, SubmitButton } from './form'
import { StatusBadge } from './world-header'

const TABS = [
  { segment: null, href: '/admin', label: 'Live' },
  { segment: 'welten', href: '/admin/welten', label: 'Alle Welten' },
  { segment: 'konten', href: '/admin/konten', label: 'Konten' },
  { segment: 'nachrichten', href: '/admin/nachrichten', label: 'Nachrichten' },
  { segment: 'bilder', href: '/admin/bilder', label: 'Bilder' },
  { segment: 'impressum', href: '/admin/impressum', label: 'Impressum' },
] as const

export function AdminTabs() {
  const segment = useSelectedLayoutSegment()
  return (
    <nav aria-label="Admin-Bereiche" className="-mx-5 overflow-x-auto border-b border-line px-5 sm:mx-0 sm:px-0">
      <ul className="flex gap-1">
        {TABS.map((tab) => {
          const active = segment === tab.segment
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={`-mb-px block whitespace-nowrap border-b-2 px-3 py-3 text-[14px] font-semibold ${
                  active ? 'border-accent text-ink' : 'border-transparent text-ink-faint hover:text-ink'
                }`}
              >
                {tab.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

function since(timestamp: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60_000))
  if (minutes < 1) return 'gerade eben'
  if (minutes < 60) return `seit ${minutes} Min.`
  const hours = Math.floor(minutes / 60)
  return `seit ${hours} Std. ${minutes % 60} Min.`
}

/** Laufende und wartende Server — aktualisiert sich alle drei Sekunden von selbst. */
export function LiveBoard({ initial }: { initial: AdminLive }) {
  const [live, setLive] = useState(initial)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const load = async () => {
      if (document.visibilityState !== 'visible') return
      try {
        const response = await fetch('/api/admin/live', { cache: 'no-store' })
        if (!response.ok) return
        setLive((await response.json()) as AdminLive)
        setNow(Date.now())
      } catch {
        // Beim nächsten Durchlauf weiter.
      }
    }
    const timer = setInterval(load, 3000)
    return () => clearInterval(timer)
  }, [])

  const share = live.totalSlots > 0 ? Math.min(100, Math.round((live.inUse / live.totalSlots) * 100)) : 100
  const tiles = [
    { label: 'Belegte Serverplätze', value: `${live.inUse} / ${live.totalSlots}` },
    { label: 'Davon online', value: String(live.online) },
    { label: 'In der Warteschlange', value: String(live.queued) },
    { label: 'Spieler online', value: String(live.playersOnline) },
  ]

  return (
    <section aria-live="polite">
      <dl className="grid gap-px border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((tile) => (
          <div key={tile.label} className="bg-base-soft p-5">
            <dt className="text-[13px] text-ink-dim">{tile.label}</dt>
            <dd className="display mt-2 text-[34px]">{tile.value}</dd>
          </div>
        ))}
      </dl>
      <div
        className="mt-3 h-2 bg-panel-2"
        role="meter"
        aria-label="Auslastung der Serverplätze"
        aria-valuemin={0}
        aria-valuemax={live.totalSlots}
        aria-valuenow={live.inUse}
      >
        <div className={`h-full ${share >= 100 ? 'bg-st-starting' : 'bg-accent'}`} style={{ width: `${share}%` }} />
      </div>

      <h2 className="eyebrow mt-10">Gerade aktiv</h2>
      {live.worlds.length === 0 ? (
        <p className="panel mt-3 px-4 py-7 text-center text-[14px] text-ink-dim">
          Im Moment läuft kein Server und niemand wartet.
        </p>
      ) : (
        <div className="panel mt-3 overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-[14px]">
            <thead className="border-b border-line text-[12px] uppercase tracking-[0.08em] text-ink-faint">
              <tr>
                <th className="px-4 py-3 font-semibold">Welt</th>
                <th className="px-4 py-3 font-semibold">Konto</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Spieler</th>
                <th className="px-4 py-3 font-semibold">CPU / RAM</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {live.worlds.map((world) => (
                <tr key={world.id}>
                  <td className="px-4 py-3">
                    <p className="font-semibold">{world.name}</p>
                    <p className="font-mono text-[12px] text-ink-faint">{world.address}</p>
                  </td>
                  <td className="max-w-[220px] truncate px-4 py-3 text-ink-dim">{world.owner}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={world.status} />
                    <p className="mt-1.5 text-[12px] text-ink-faint">{since(world.statusSince, now)}</p>
                  </td>
                  <td className="px-4 py-3">
                    {world.status === 'online' ? (
                      <span title={world.players.join(', ')}>{world.players.length}</span>
                    ) : (
                      <span className="text-ink-faint">–</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-ink-dim">
                    {world.cpuPercent === null || world.ramMiB === null
                      ? '–'
                      : `${world.cpuPercent} % · ${(world.ramMiB / 1024).toLocaleString('de-DE', { maximumFractionDigits: 1 })} GiB`}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {world.status !== 'stopping' && (
                      <ConfirmButton
                        className="btn btn-danger min-h-[36px] px-3 text-[13px]"
                        title={world.status === 'queued' ? 'Aus der Warteschlange nehmen?' : 'Server pausieren?'}
                        text={
                          <>
                            <strong className="text-ink">{world.name}</strong> von {world.owner} wird gespeichert und
                            pausiert. Wer gerade spielt, wird getrennt.
                          </>
                        }
                        confirmLabel="Pausieren"
                        danger
                        action={() => adminPauseWorldAction(world.id)}
                      >
                        <Square aria-hidden />
                        Pausieren
                      </ConfirmButton>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

export function LimitsForm({ limits }: { limits: Limits }) {
  const [state, action] = useActionState(saveLimitsAction, EMPTY)
  const fields: Array<{ name: keyof Limits; label: string; hint: string; min: number; max: number }> = [
    {
      name: 'totalSlots',
      label: 'Gleichzeitig laufende Server',
      hint: 'So viele Welten dürfen zur selben Zeit online sein. Alle weiteren warten in der Schlange.',
      min: 0,
      max: 500,
    },
    {
      name: 'autoPauseMinutes',
      label: 'Auto-Pause nach (Minuten)',
      hint: 'So lange darf eine Welt ohne Spieler laufen.',
      min: 5,
      max: 1440,
    },
    {
      name: 'maxWorldsPerUser',
      label: 'Welten pro Konto',
      hint: 'Gilt für neue Welten; bestehende bleiben.',
      min: 1,
      max: 20,
    },
  ]
  return (
    <form action={action} className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-3">
        {fields.map((field) => (
          <div key={field.name}>
            <label htmlFor={field.name} className="label">
              {field.label}
            </label>
            <input
              id={field.name}
              name={field.name}
              type="number"
              inputMode="numeric"
              min={field.min}
              max={field.max}
              step={1}
              required
              defaultValue={limits[field.name]}
              className="field"
              aria-describedby={`${field.name}-hint`}
            />
            <p id={`${field.name}-hint`} className="hint">
              {field.hint}
            </p>
          </div>
        ))}
      </div>
      <FormMessage state={state} />
      <SubmitButton>Speichern</SubmitButton>
    </form>
  )
}

export function AdminWorldActions({ worldId, name, active }: { worldId: string; name: string; active: boolean }) {
  return (
    <div className="flex justify-end gap-2">
      {active && (
        <ConfirmButton
          className="btn min-h-[36px] px-3 text-[13px]"
          title="Server pausieren?"
          text={<>{name} wird gespeichert und pausiert.</>}
          confirmLabel="Pausieren"
          danger
          action={() => adminPauseWorldAction(worldId)}
        >
          Pausieren
        </ConfirmButton>
      )}
      <ConfirmButton
        className="grid size-9 place-items-center text-ink-faint hover:text-danger"
        ariaLabel={`${name} löschen`}
        title="Welt löschen?"
        text={
          <>
            <strong className="text-ink">{name}</strong> wird mit allen Dateien und Backups unwiderruflich gelöscht.
          </>
        }
        confirmLabel="Endgültig löschen"
        danger
        typeToConfirm={name}
        action={() => adminDeleteWorldAction(worldId)}
      >
        <Trash2 className="size-4" aria-hidden />
      </ConfirmButton>
    </div>
  )
}

export function AdminDeleteUser({ userId, email }: { userId: string; email: string }) {
  return (
    <ConfirmButton
      className="grid size-9 place-items-center text-ink-faint hover:text-danger"
      ariaLabel={`Konto ${email} löschen`}
      title="Konto löschen?"
      text={
        <>
          Das Konto <strong className="text-ink">{email}</strong> wird mit allen Welten, Dateien und Backups
          unwiderruflich gelöscht.
        </>
      }
      confirmLabel="Endgültig löschen"
      danger
      typeToConfirm={email}
      action={() => adminDeleteUserAction(userId)}
    >
      <Trash2 className="size-4" aria-hidden />
    </ConfirmButton>
  )
}

export function AdminDeleteFeedback({ feedbackId }: { feedbackId: string }) {
  return (
    <ConfirmButton
      className="grid size-9 flex-none place-items-center text-ink-faint hover:text-danger"
      ariaLabel="Nachricht löschen"
      title="Nachricht löschen?"
      text="Die Nachricht wird endgültig gelöscht."
      confirmLabel="Löschen"
      danger
      action={() => adminDeleteFeedbackAction(feedbackId)}
    >
      <Trash2 className="size-4" aria-hidden />
    </ConfirmButton>
  )
}

export function ImageSlotCard({
  slot,
  title,
  hint,
  url,
  custom,
}: {
  slot: string
  title: string
  hint: string
  url: string | null
  custom: boolean
}) {
  const [state, action] = useActionState(uploadImageAction, EMPTY)
  return (
    <li className="panel">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={`Aktuelles Bild für ${title}`} className="block aspect-[16/7] w-full object-cover" />
      ) : (
        <div className="cover-empty grid aspect-[16/7] w-full place-items-center text-[13px] text-ink-faint">
          Noch kein Bild
        </div>
      )}
      <div className="space-y-3 p-4">
        <div>
          <h3 className="font-semibold">{title}</h3>
          <p className="text-[13px] text-ink-dim">
            {hint} {custom ? 'Bild ist aktiv.' : 'Noch leer — die Seite zeigt hier eine neutrale Fläche.'}
          </p>
        </div>
        <form action={action} className="space-y-3">
          <input type="hidden" name="slot" value={slot} />
          <label htmlFor={`file-${slot}`} className="sr-only">
            Bilddatei für {title}
          </label>
          <input
            id={`file-${slot}`}
            name="file"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            required
            className="block w-full text-[13px] text-ink-dim file:mr-3 file:cursor-pointer file:border file:border-line-strong file:bg-transparent file:px-3 file:py-2 file:text-[13px] file:font-semibold file:text-ink"
          />
          <div className="flex flex-wrap items-center gap-2">
            <SubmitButton className="btn min-h-[38px] px-3 text-[13px]" icon={<Upload aria-hidden />}>
              Hochladen
            </SubmitButton>
            {custom && (
              <ConfirmButton
                className="btn min-h-[38px] px-3 text-[13px]"
                title="Bild entfernen?"
                text="Danach zeigt die Seite an dieser Stelle wieder eine neutrale Fläche."
                confirmLabel="Entfernen"
                danger
                action={() => removeImageAction(slot)}
              >
                Entfernen
              </ConfirmButton>
            )}
          </div>
          <FormMessage state={state} />
        </form>
      </div>
    </li>
  )
}

const gib = (mib: number) => (mib / 1024).toLocaleString('de-DE', { maximumFractionDigits: 1 })

/** Paket einer Welt hochstufen: mehr Arbeitsspeicher, Speicherplatz, CPU und so weiter. */
export function PlanForm({
  worldId,
  plan,
  standard,
  host,
}: {
  worldId: string
  plan: Plan
  standard: PlanValues
  host: { ramMiB: number; cpus: number }
}) {
  const [state, action] = useActionState(saveWorldPlanAction, EMPTY)
  // Nach „Zurücksetzen“ gelten die Eingaben eines zuvor abgelehnten Versuchs nicht mehr.
  const [dismissed, setDismissed] = useState<unknown>(null)
  const typed = state === dismissed ? undefined : state.values
  const fields: Array<{ name: string; label: string; unit: string; value: number; min: number; max: number; step: number; hint: string }> = [
    {
      name: 'ramGiB',
      label: 'Arbeitsspeicher',
      unit: 'GiB',
      value: plan.ramMiB / 1024,
      min: Math.min(2, standard.ramMiB / 1024),
      max: Math.max(Math.min(64, Math.floor(host.ramMiB / 512) / 2), standard.ramMiB / 1024),
      step: 0.5,
      hint: `Standard: ${gib(standard.ramMiB)} GiB · dieser Server hat ${gib(host.ramMiB)} GiB`,
    },
    {
      name: 'diskGiB',
      label: 'Speicherplatz (SSD)',
      unit: 'GiB',
      value: plan.diskGiB,
      min: 1,
      max: 500,
      step: 1,
      hint: `Standard: ${standard.diskGiB} GiB für Welt und Plugins`,
    },
    {
      name: 'cpus',
      label: 'CPU-Kerne',
      unit: 'Kerne',
      value: plan.cpus,
      min: Math.min(0.5, standard.cpus),
      max: Math.max(Math.min(64, host.cpus), standard.cpus),
      // „any“, falls der Standard selbst kein Vielfaches von 0,5 ist.
      step: Number.isInteger(standard.cpus * 2) ? 0.5 : 0.05,
      hint: `Standard: ${standard.cpus.toLocaleString('de-DE')} · dieser Server hat ${host.cpus}`,
    },
    {
      name: 'maxPlayers',
      label: 'Spielerplätze',
      unit: 'Spieler',
      value: plan.maxPlayers,
      min: 1,
      max: 500,
      step: 1,
      hint: `Standard: ${standard.maxPlayers}`,
    },
    {
      name: 'backupGiB',
      label: 'Backup-Speicher',
      unit: 'GiB',
      value: plan.backupGiB,
      min: 1,
      max: 1000,
      step: 1,
      hint: `Standard: ${standard.backupGiB} GiB für alle Backups der Welt zusammen`,
    },
    {
      name: 'autoPauseMinutes',
      label: 'Auto-Pause',
      unit: 'Minuten',
      value: plan.autoPauseMinutes,
      min: 0,
      max: 1440,
      step: 1,
      hint: `Standard: ${standard.autoPauseMinutes} · 0 = die Welt bleibt online, bis sie jemand pausiert`,
    },
  ]
  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="worldId" value={worldId} />
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {fields.map((field) => (
          <div key={field.name}>
            <label htmlFor={field.name} className="label">
              {field.label} <span className="font-normal text-ink-faint">({field.unit})</span>
            </label>
            <input
              // Ändert sich der gespeicherte Wert (etwa durch „Zurücksetzen“), zeigt das Feld ihn neu an.
              key={field.value}
              id={field.name}
              name={field.name}
              type="number"
              inputMode="decimal"
              min={field.min}
              max={field.max}
              step={field.step}
              required
              defaultValue={typed?.[field.name] ?? field.value}
              className="field"
              aria-describedby={`${field.name}-hint`}
            />
            <p id={`${field.name}-hint`} className="hint">
              {field.hint}
            </p>
          </div>
        ))}
      </div>
      <FormMessage state={state} />
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton>Paket speichern</SubmitButton>
        {plan.upgraded && (
          <ConfirmButton
            className="btn"
            title="Zurück auf das Standardpaket?"
            text={<>Die Welt bekommt wieder die Werte des kostenlosen Pakets. Ihre Dateien bleiben erhalten.</>}
            confirmLabel="Zurücksetzen"
            action={async () => {
              const result = await resetWorldPlanAction(worldId)
              if (!result.error) setDismissed(state)
              return result
            }}
          >
            Auf Standard zurücksetzen
          </ConfirmButton>
        )}
      </div>
    </form>
  )
}

/** Angaben des Betreibers für Impressum und Datenschutzerklärung. */
export function ImprintForm({ imprint }: { imprint: Imprint }) {
  const [state, action] = useActionState(saveImprintAction, EMPTY)
  const fields: Array<{ name: keyof Omit<Imprint, 'updatedAt'>; label: string; hint?: string; type?: string; required?: boolean; autoComplete?: string }> = [
    { name: 'name', label: 'Vor- und Nachname oder Firma', required: true, autoComplete: 'name' },
    { name: 'street', label: 'Straße und Hausnummer', required: true, autoComplete: 'street-address' },
    { name: 'city', label: 'PLZ und Ort', required: true },
    { name: 'country', label: 'Land', required: true, autoComplete: 'country-name' },
    { name: 'email', label: 'E-Mail-Adresse', type: 'email', required: true, hint: 'Auch für Meldungen rechtswidriger Inhalte.', autoComplete: 'email' },
    { name: 'phone', label: 'Telefon', type: 'tel', hint: 'Freiwillig — ohne Angabe erscheint keine Zeile. Nur Ziffern, Leerzeichen und + ( ) / . -', autoComplete: 'tel' },
  ]
  return (
    <form action={action} className="space-y-5">
      <div className="grid gap-5 sm:grid-cols-2">
        {fields.map((field) => (
          <div key={field.name}>
            <label htmlFor={`imprint-${field.name}`} className="label">
              {field.label}
            </label>
            <input
              id={`imprint-${field.name}`}
              name={field.name}
              type={field.type ?? 'text'}
              required={field.required}
              maxLength={200}
              defaultValue={state.values?.[field.name] ?? imprint[field.name]}
              autoComplete={field.autoComplete}
              className="field"
              aria-describedby={field.hint ? `imprint-${field.name}-hint` : undefined}
            />
            {field.hint && (
              <p id={`imprint-${field.name}-hint`} className="hint">
                {field.hint}
              </p>
            )}
          </div>
        ))}
      </div>
      <FormMessage state={state} />
      <SubmitButton>Speichern</SubmitButton>
    </form>
  )
}
