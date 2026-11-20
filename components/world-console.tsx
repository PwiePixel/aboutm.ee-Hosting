'use client'

import { LoaderCircle, SendHorizontal } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { sendCommandAction } from '@/lib/actions/worlds'
import { COMMAND_MAX } from '@/lib/validation'
import { useWorldLive } from './world-live'

export function WorldConsole() {
  const { worldId, live } = useWorldLive()
  const [lines, setLines] = useState<string[]>([])
  const [command, setCommand] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const output = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  const history = useRef<string[]>([])
  const cursor = useRef(-1)

  const active = live.status === 'starting' || live.status === 'online' || live.status === 'stopping'
  const online = live.status === 'online'

  useEffect(() => {
    if (!active) {
      setLines([])
      return
    }
    let cancelled = false
    const load = async () => {
      if (document.visibilityState !== 'visible') return
      try {
        const response = await fetch(`/api/welten/${worldId}/konsole`, { cache: 'no-store' })
        if (!response.ok) return
        const data = (await response.json()) as { lines: string[] }
        if (!cancelled) setLines(data.lines)
      } catch {
        // Beim nächsten Durchlauf weiter.
      }
    }
    void load()
    const timer = setInterval(load, 1500)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [active, worldId])

  // Unten bleiben, solange nicht bewusst nach oben gescrollt wurde.
  useEffect(() => {
    const element = output.current
    if (element && pinned.current) element.scrollTop = element.scrollHeight
  }, [lines])

  const onScroll = () => {
    const element = output.current
    if (!element) return
    pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 40
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const text = command.trim()
    if (!text || sending || !online) return
    setSending(true)
    setError(null)
    try {
      const result = await sendCommandAction(worldId, text)
      if (result.error) {
        setError(result.error)
      } else {
        history.current = [text, ...history.current.filter((entry) => entry !== text)].slice(0, 30)
        cursor.current = -1
        setCommand('')
        pinned.current = true
      }
    } catch {
      setError('Der Befehl kam nicht an. Versuch es gleich noch einmal.')
    } finally {
      setSending(false)
    }
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    const next = cursor.current + (event.key === 'ArrowUp' ? 1 : -1)
    if (next < -1 || next >= history.current.length) return
    event.preventDefault()
    cursor.current = next
    setCommand(next === -1 ? '' : history.current[next]!)
  }

  const empty = !active
    ? 'Deine Welt ist pausiert. Starte sie, dann erscheint das Log hier.'
    : lines.length === 0
      ? 'Warte auf die ersten Zeilen …'
      : null

  return (
    <section>
      <h2 className="eyebrow">Konsole</h2>
      <p className="mt-2 text-[14px] text-ink-dim">
        Live-Ausgabe deines Servers. Befehle laufen direkt auf deiner Welt — ohne führenden Schrägstrich. IP-Adressen
        deiner Mitspieler blenden wir hier aus.
      </p>

      <div
        ref={output}
        onScroll={onScroll}
        role="log"
        aria-label="Server-Log"
        tabIndex={0}
        className="panel mt-4 h-[420px] overflow-y-auto p-4 font-mono text-[13px] leading-[1.65]"
      >
        {empty ? (
          <p className="text-ink-dim">{empty}</p>
        ) : (
          lines.map((line, index) => (
            <div
              key={index}
              className={`whitespace-pre-wrap break-words ${
                /\b(ERROR|SEVERE)\b/.test(line)
                  ? 'text-danger'
                  : /\b(WARN|HINWEIS)\b/.test(line)
                    ? 'text-st-starting'
                    : 'text-ink-dim'
              }`}
            >
              {line}
            </div>
          ))
        )}
      </div>

      <form onSubmit={submit} className="mt-4 flex gap-2">
        <label htmlFor="command" className="sr-only">
          Befehl
        </label>
        <input
          id="command"
          className="field font-mono !text-[14px]"
          placeholder={online ? 'Befehl eingeben, z. B. say Hallo' : 'Welt läuft nicht'}
          value={command}
          onChange={(event) => setCommand(event.target.value)}
          onKeyDown={onKeyDown}
          maxLength={COMMAND_MAX}
          disabled={!online}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
        />
        <button type="submit" className="btn btn-primary" disabled={!online || sending || !command.trim()}>
          {sending ? <LoaderCircle className="spin" aria-hidden /> : <SendHorizontal aria-hidden />}
          Senden
        </button>
      </form>
      {error ? (
        <p className="mt-3 text-[14px] text-danger" role="alert">
          {error}
        </p>
      ) : (
        !online && <p className="mt-3 text-[14px] text-ink-dim">Befehle gehen nur, wenn die Welt läuft.</p>
      )}
    </section>
  )
}
