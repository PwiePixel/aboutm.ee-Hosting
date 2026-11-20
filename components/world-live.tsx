'use client'

import { useRouter } from 'next/navigation'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { restartWorldAction, startWorldAction, stopWorldAction } from '@/lib/actions/worlds'
import type { LiveStatus } from '@/lib/status'

type Command = 'start' | 'stop' | 'restart'

type Live = {
  worldId: string
  live: LiveStatus
  busy: Command | null
  error: string | null
  run: (command: Command) => void
}

const Context = createContext<Live | null>(null)

export function useWorldLive(): Live {
  const value = useContext(Context)
  if (!value) throw new Error('useWorldLive braucht <WorldLiveProvider>')
  return value
}

const ACTIONS = { start: startWorldAction, stop: stopWorldAction, restart: restartWorldAction }

/**
 * Fragt den Status der Welt regelmäßig ab und stellt ihn allen Bausteinen der Welt-Seite
 * bereit. Wechselt der Status, werden die vom Server gerenderten Teile neu geladen.
 */
export function WorldLiveProvider({
  worldId,
  initial,
  children,
}: {
  worldId: string
  initial: LiveStatus
  children: ReactNode
}) {
  const router = useRouter()
  const [live, setLive] = useState(initial)
  const [busy, setBusy] = useState<Command | null>(null)
  const [error, setError] = useState<string | null>(null)
  const lastStatus = useRef(initial.status)

  const poll = useCallback(async () => {
    try {
      const response = await fetch(`/api/welten/${worldId}/status`, { cache: 'no-store' })
      if (response.status === 401) {
        window.location.assign('/login')
        return
      }
      if (!response.ok) return
      const next = (await response.json()) as LiveStatus
      setLive(next)
      if (next.status !== lastStatus.current) {
        lastStatus.current = next.status
        router.refresh()
      }
    } catch {
      // Kurz offline — beim nächsten Durchlauf geht es weiter.
    }
  }, [router, worldId])

  const changing = live.status === 'starting' || live.status === 'stopping' || live.status === 'queued'
  useEffect(() => {
    const timer = setInterval(
      () => {
        if (document.visibilityState === 'visible') void poll()
      },
      changing ? 1200 : 3000,
    )
    const onVisible = () => {
      if (document.visibilityState === 'visible') void poll()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [changing, poll])

  const run = useCallback(
    (command: Command) => {
      if (busy) return
      setBusy(command)
      setError(null)
      ACTIONS[command](worldId)
        .then((result) => setError(result.error ?? null))
        .catch(() => setError('Das hat nicht geklappt. Versuch es gleich noch einmal.'))
        .finally(() => {
          setBusy(null)
          void poll()
        })
    },
    [busy, poll, worldId],
  )

  const value = useMemo(() => ({ worldId, live, busy, error, run }), [worldId, live, busy, error, run])
  return <Context.Provider value={value}>{children}</Context.Provider>
}
