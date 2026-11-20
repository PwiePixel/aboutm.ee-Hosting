'use client'

import { Check, Copy, LoaderCircle, Play, Square } from 'lucide-react'
import Link from 'next/link'
import { useSelectedLayoutSegment } from 'next/navigation'
import { useEffect, useState } from 'react'
import type { WorldStatus } from '@/lib/runtime/types'
import { STATUS_LABEL } from '@/lib/labels'
import { useWorldLive } from './world-live'

const BADGE: Record<WorldStatus, string> = {
  paused: 'bg-st-paused text-base',
  queued: 'bg-st-starting text-base',
  starting: 'bg-st-starting text-base',
  online: 'bg-st-online text-accent-ink',
  stopping: 'bg-st-paused text-base',
}

export function StatusBadge({ status }: { status: WorldStatus }) {
  return (
    <span className={`px-3 py-1.5 font-mono text-[12px] font-bold uppercase tracking-[0.1em] ${BADGE[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  )
}

export function LiveStatusBadge() {
  const { live } = useWorldLive()
  return <StatusBadge status={live.status} />
}

export function CopyAddress({ address }: { address: string }) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
    } catch {
      window.prompt('Adresse kopieren:', address)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <code className="break-all bg-panel-2 px-3.5 py-2.5 font-mono text-[15px] font-semibold">{address}</code>
      <button type="button" onClick={copy} className="btn">
        {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
        <span aria-live="polite">{copied ? 'Kopiert' : 'IP kopieren'}</span>
      </button>
    </div>
  )
}

/** Kleiner Start-/Pause-Knopf neben der Adresse — auf allen Reitern außer der Übersicht. */
export function QuickControl() {
  const segment = useSelectedLayoutSegment()
  const { live, busy, run } = useWorldLive()
  if (segment === null) return null

  if (live.status === 'paused') {
    return (
      <button type="button" className="btn" onClick={() => run('start')} disabled={busy !== null}>
        {busy === 'start' ? <LoaderCircle className="spin" aria-hidden /> : <Play aria-hidden />}
        Welt starten
      </button>
    )
  }
  if (live.status === 'stopping') {
    return (
      <span className="flex items-center gap-2 text-[14px] text-ink-dim">
        <LoaderCircle className="spin size-4" aria-hidden />
        Wird pausiert …
      </span>
    )
  }
  return (
    <button type="button" className="btn btn-danger" onClick={() => run('stop')} disabled={busy !== null}>
      {busy === 'stop' ? <LoaderCircle className="spin" aria-hidden /> : <Square aria-hidden />}
      {live.status === 'queued' ? 'Warten abbrechen' : 'Welt pausieren'}
    </button>
  )
}

const TABS = [
  { segment: null, slug: '', label: 'Übersicht' },
  { segment: 'konsole', slug: '/konsole', label: 'Konsole' },
  { segment: 'dateien', slug: '/dateien', label: 'Dateien' },
  { segment: 'backups', slug: '/backups', label: 'Backups' },
  { segment: 'einstellungen', slug: '/einstellungen', label: 'Einstellungen' },
] as const

export function WorldTabs({ worldId }: { worldId: string }) {
  const segment = useSelectedLayoutSegment()
  return (
    <nav aria-label="Bereiche dieser Welt" className="-mx-5 overflow-x-auto border-b border-line px-5 sm:mx-0 sm:px-0">
      <ul className="flex gap-1">
        {TABS.map((tab) => {
          const active = segment === tab.segment
          return (
            <li key={tab.label}>
              <Link
                href={`/app/welten/${worldId}${tab.slug}`}
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

export function LiveError() {
  const { error } = useWorldLive()
  if (!error) return null
  return (
    <p className="notice notice-error" role="alert">
      {error}
    </p>
  )
}
