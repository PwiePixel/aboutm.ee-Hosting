'use client'

import { useEffect, useRef, useState } from 'react'

type TurnstileApi = {
  render: (element: HTMLElement, options: Record<string, unknown>) => string
  remove: (widgetId: string) => void
  reset: (widgetId: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
let scriptPromise: Promise<void> | undefined

function loadScript(): Promise<void> {
  scriptPromise ??= new Promise((resolve, reject) => {
    if (window.turnstile) return resolve()
    const script = document.createElement('script')
    script.src = SCRIPT_SRC
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => {
      scriptPromise = undefined
      reject(new Error('Turnstile konnte nicht geladen werden'))
    }
    document.head.appendChild(script)
  })
  return scriptPromise
}

type Status = 'loading' | 'ready' | 'failed'

/**
 * Cloudflare-Sicherheitsprüfung. Das Widget legt sein Token als verstecktes Feld
 * `cf-turnstile-response` ins umgebende Formular; der Server prüft es vor jeder Aktion.
 *
 * `resetKey` ändern, um nach einem abgeschickten Formular ein frisches Token zu holen —
 * ein Token gilt nur für einen Versuch.
 */
export function Turnstile({
  siteKey,
  onVerified,
  resetKey,
}: {
  siteKey: string
  onVerified: (verified: boolean) => void
  resetKey?: unknown
}) {
  const container = useRef<HTMLDivElement>(null)
  const widget = useRef<string | null>(null)
  const callback = useRef(onVerified)
  const [status, setStatus] = useState<Status>('loading')

  useEffect(() => {
    callback.current = onVerified
  }, [onVerified])

  useEffect(() => {
    if (!siteKey) return
    let cancelled = false

    loadScript()
      .then(() => {
        if (cancelled || !container.current || !window.turnstile) return
        widget.current = window.turnstile.render(container.current, {
          sitekey: siteKey,
          theme: 'dark',
          language: 'de',
          appearance: 'interaction-only',
          callback: () => {
            setStatus('ready')
            callback.current(true)
          },
          'expired-callback': () => {
            setStatus('loading')
            callback.current(false)
            if (widget.current) window.turnstile?.reset(widget.current)
          },
          'error-callback': () => {
            setStatus('failed')
            callback.current(false)
          },
        })
      })
      .catch(() => {
        if (!cancelled) setStatus('failed')
      })

    return () => {
      cancelled = true
      if (widget.current && window.turnstile) window.turnstile.remove(widget.current)
      widget.current = null
    }
  }, [siteKey])

  useEffect(() => {
    if (resetKey === undefined || !widget.current || !window.turnstile) return
    setStatus('loading')
    callback.current(false)
    window.turnstile.reset(widget.current)
  }, [resetKey])

  if (!siteKey) {
    return (
      <p className="border border-dashed border-line-strong px-3 py-2 text-[13px] text-ink-faint">
        Die Sicherheitsprüfung ist nicht eingerichtet. In der Entwicklung geht es ohne — im Live-Betrieb bleiben
        Formulare gesperrt, bis die Turnstile-Schlüssel eingetragen sind.
      </p>
    )
  }

  return (
    <div>
      <div ref={container} />
      <p className="text-[13px] text-ink-faint" role="status" aria-live="polite">
        {status === 'loading' && 'Sicherheitsprüfung läuft …'}
        {status === 'ready' && 'Sicherheitsprüfung bestanden.'}
        {status === 'failed' &&
          'Die Sicherheitsprüfung konnte nicht geladen werden. Lade die Seite neu oder schalte Werbeblocker für diese Seite aus.'}
      </p>
      <noscript>
        <p className="text-[13px] text-danger">
          Für dieses Formular braucht es JavaScript — die Sicherheitsprüfung läuft sonst nicht.
        </p>
      </noscript>
    </div>
  )
}
