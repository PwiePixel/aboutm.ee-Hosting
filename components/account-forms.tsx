'use client'

import { useActionState, useEffect, useRef } from 'react'
import { changePasswordAction, deleteAccountAction } from '@/lib/actions/auth'
import { EMPTY } from '@/lib/actions/state'
import { PASSWORD_MIN } from '@/lib/validation'
import { FormMessage, SubmitButton } from './form'

export function ChangePasswordForm() {
  const [state, action] = useActionState(changePasswordAction, EMPTY)
  const form = useRef<HTMLFormElement>(null)
  useEffect(() => {
    if (state.ok) form.current?.reset()
  }, [state])
  return (
    <form ref={form} action={action} className="max-w-[420px] space-y-4">
      <div>
        <label htmlFor="current" className="label">
          Aktuelles Passwort
        </label>
        <input id="current" name="current" type="password" autoComplete="current-password" className="field" required />
      </div>
      <div>
        <label htmlFor="next" className="label">
          Neues Passwort
        </label>
        <input
          id="next"
          name="next"
          type="password"
          autoComplete="new-password"
          className="field"
          minLength={PASSWORD_MIN}
          required
          aria-describedby="next-hint"
        />
        <p id="next-hint" className="hint">
          Mindestens {PASSWORD_MIN} Zeichen.
        </p>
      </div>
      <FormMessage state={state} />
      <SubmitButton>Passwort ändern</SubmitButton>
    </form>
  )
}

export function DeleteAccountForm() {
  const [state, action] = useActionState(deleteAccountAction, EMPTY)
  return (
    <form action={action} className="max-w-[420px] space-y-4">
      <div>
        <label htmlFor="delete-password" className="label">
          Passwort zur Bestätigung
        </label>
        <input
          id="delete-password"
          name="password"
          type="password"
          autoComplete="current-password"
          className="field"
          required
        />
      </div>
      <FormMessage state={state} />
      <SubmitButton className="btn btn-danger">Konto endgültig löschen</SubmitButton>
    </form>
  )
}
