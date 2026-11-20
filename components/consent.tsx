'use client'

import { ShieldCheck } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState } from 'react'

type Analytics = { umamiSrc: string; umamiWebsiteId: string; cloudflareBeaconToken: string }
type Choice = 'granted' | 'denied'

const STORAGE_KEY = 'am_consent'

function readChoice(): Choice | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY)
    return value === 'granted' || value === 'denied' ? value : null
  } catch {
    return null
  }
}

function storeChoice(choice: Choice): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, choice)
  } catch {
    // Ohne Speicher fragen wir beim nächsten Besuch einfach wieder.
  }
}

function loadAnalytics(analytics: Analytics): void {
  if (document.querySelector('script[data-am-analytics]')) return
  if (analytics.umamiSrc && analytics.umamiWebsiteId) {
    const script = document.createElement('script')
    script.src = analytics.umamiSrc
    script.defer = true
    script.dataset.websiteId = analytics.umamiWebsiteId
    script.dataset.amAnalytics = 'umami'
    document.head.appendChild(script)
  }
  if (analytics.cloudflareBeaconToken) {
    const script = document.createElement('script')
    script.src = 'https://static.cloudflareinsights.com/beacon.min.js'
    script.defer = true
    script.dataset.cfBeacon = JSON.stringify({ token: analytics.cloudflareBeaconToken })
    script.dataset.amAnalytics = 'cloudflare'
    document.head.appendChild(script)
  }
}

/**
 * Einwilligung für die Statistik. Ohne eingerichtete Statistik gibt es nichts zu
 * erlauben — dann erscheint weder ein Banner noch der Knopf unten links.
 */
export function Consent({ analytics }: { analytics: Analytics }) {
  const hasAnalytics = Boolean((analytics.umamiSrc && analytics.umamiWebsiteId) || analytics.cloudflareBeaconToken)
  const [choice, setChoice] = useState<Choice | null>(null)
  const [open, setOpen] = useState(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!hasAnalytics) return
    const stored = readChoice()
    setChoice(stored)
    setOpen(stored === null)
    setReady(true)
    if (stored === 'granted') loadAnalytics(analytics)
  }, [analytics, hasAnalytics])

  if (!hasAnalytics || !ready) return null

  const decide = (next: Choice) => {
    const revoked = choice === 'granted' && next === 'denied'
    storeChoice(next)
    setChoice(next)
    setOpen(false)
    if (next === 'granted') loadAnalytics(analytics)
    // Schon geladene Skripte lassen sich nur durch Neuladen sicher entfernen.
    if (revoked) window.location.reload()
  }

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Datenschutzeinstellungen"
          title="Datenschutzeinstellungen"
          className="fixed bottom-4 left-4 z-40 grid size-10 place-items-center rounded-full border border-line-strong bg-panel text-ink-dim hover:text-ink"
        >
          <ShieldCheck className="size-[18px]" aria-hidden />
        </button>
      )}
      {open && (
        <section
          aria-label="Datenschutzeinstellungen"
          className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-[560px] border border-line-strong bg-panel p-5 shadow-2xl"
        >
          <h2 className="heading text-[17px]">Dürfen wir mitzählen?</h2>
          <p className="mt-2 text-[14px] text-ink-dim">
            Wir würden gern messen, welche Seiten genutzt werden und wie schnell sie laden. Keine Werbung, keine
            Weitergabe. Du kannst deine Entscheidung jederzeit über das Schild unten links ändern. Mehr dazu in der{' '}
            <Link href="/datenschutz" className="link">
              Datenschutzerklärung
            </Link>
            .
          </p>
          <p className="mt-2 text-[13px] text-ink-faint">
            Die Sicherheitsprüfung von Cloudflare bei Formularen läuft unabhängig davon — sie schützt die Seite vor
            Bots.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className="btn" onClick={() => decide('denied')}>
              Nur notwendige
            </button>
            <button type="button" className="btn" onClick={() => decide('granted')}>
              Statistik erlauben
            </button>
          </div>
        </section>
      )}
    </>
  )
}
