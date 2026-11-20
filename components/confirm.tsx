'use client'

import { LoaderCircle } from 'lucide-react'
import { useId, useRef, useState, type ReactNode } from 'react'
import type { ActionState } from '@/lib/actions/state'

/**
 * Knopf mit Rückfrage. Optional muss ein Text (z. B. der Name der Welt) abgetippt werden,
 * bevor sich bestätigen lässt.
 */
export function ConfirmButton({
  children,
  className = 'btn',
  title,
  text,
  confirmLabel,
  danger = false,
  disabled = false,
  typeToConfirm,
  action,
  ariaLabel,
}: {
  children: ReactNode
  className?: string
  title: string
  text: ReactNode
  confirmLabel: string
  danger?: boolean
  disabled?: boolean
  typeToConfirm?: string
  action: (typed: string) => Promise<ActionState | void>
  ariaLabel?: string
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [typed, setTyped] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const titleId = useId()
  const inputId = useId()

  const open = () => {
    setTyped('')
    setError(null)
    dialog.current?.showModal()
  }

  const confirm = async () => {
    setPending(true)
    setError(null)
    try {
      const result = await action(typed)
      if (result?.error) setError(result.error)
      else dialog.current?.close()
    } catch (caught) {
      // Weiterleitungen nach einer Aktion kommen als Ausnahme an — die gehören durchgereicht.
      if (caught && typeof caught === 'object' && 'digest' in caught) throw caught
      setError('Das hat nicht geklappt. Versuch es gleich noch einmal.')
    } finally {
      setPending(false)
    }
  }

  const blocked = typeToConfirm !== undefined && typed.trim() !== typeToConfirm

  return (
    <>
      <button type="button" className={className} onClick={open} disabled={disabled} aria-label={ariaLabel}>
        {children}
      </button>
      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        className="m-auto w-[min(92vw,460px)] border border-line-strong bg-panel p-6 text-ink"
      >
        <h2 id={titleId} className="heading text-[19px]">
          {title}
        </h2>
        <div className="mt-3 text-[14px] text-ink-dim">{text}</div>
        {typeToConfirm !== undefined && (
          <div className="mt-4">
            <label htmlFor={inputId} className="label">
              Tippe zur Bestätigung <span className="font-mono text-accent">{typeToConfirm}</span>
            </label>
            <input
              id={inputId}
              className="field"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
            />
          </div>
        )}
        {error && (
          <p className="notice notice-error mt-4" role="alert">
            {error}
          </p>
        )}
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button type="button" className="btn" onClick={() => dialog.current?.close()} disabled={pending}>
            Abbrechen
          </button>
          <button
            type="button"
            className={danger ? 'btn btn-danger' : 'btn btn-primary'}
            onClick={confirm}
            disabled={pending || blocked}
          >
            {pending && <LoaderCircle className="spin" aria-hidden />}
            {confirmLabel}
          </button>
        </div>
      </dialog>
    </>
  )
}
