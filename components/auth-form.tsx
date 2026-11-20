'use client'

import { Check, Eye, EyeOff } from 'lucide-react'
import { useActionState, useId, useState } from 'react'
import { loginAction, registerAction } from '@/lib/actions/auth'
import { EMPTY } from '@/lib/actions/state'
import { PASSWORD_MIN } from '@/lib/validation'
import { FormMessage, SubmitButton } from './form'
import { Turnstile } from './turnstile'

export function AuthForm({ mode, siteKey }: { mode: 'login' | 'register'; siteKey: string }) {
  const [state, action] = useActionState(mode === 'login' ? loginAction : registerAction, EMPTY)
  const [verified, setVerified] = useState(!siteKey)
  const [password, setPassword] = useState('')
  const [visible, setVisible] = useState(false)
  const emailId = useId()
  const passwordId = useId()
  const hintId = useId()

  const longEnough = password.length >= PASSWORD_MIN
  const mixed = /[A-Za-zÄÖÜäöüß]/.test(password) && /\d/.test(password)

  return (
    <form action={action} className="space-y-5" noValidate>
      <FormMessage state={state} />

      <div>
        <label htmlFor={emailId} className="label">
          E-Mail
        </label>
        <input
          id={emailId}
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          defaultValue={state.values?.email ?? ''}
          className="field"
        />
      </div>

      <div>
        <label htmlFor={passwordId} className="label">
          Passwort
        </label>
        <div className="relative">
          <input
            id={passwordId}
            name="password"
            type={visible ? 'text' : 'password'}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-describedby={mode === 'register' ? hintId : undefined}
            className="field pr-12"
          />
          <button
            type="button"
            onClick={() => setVisible((value) => !value)}
            aria-label={visible ? 'Passwort verbergen' : 'Passwort anzeigen'}
            aria-pressed={visible}
            className="absolute inset-y-0 right-0 grid w-11 place-items-center text-ink-faint hover:text-ink"
          >
            {visible ? <EyeOff className="size-[18px]" aria-hidden /> : <Eye className="size-[18px]" aria-hidden />}
          </button>
        </div>
        {mode === 'register' && (
          <ul id={hintId} className="mt-3 space-y-1 text-[13px]">
            <li className={`flex items-center gap-2 ${longEnough ? 'text-accent' : 'text-ink-faint'}`}>
              <Check className="size-3.5" aria-hidden />
              Mindestens {PASSWORD_MIN} Zeichen
              <span className="sr-only">{longEnough ? ' — erfüllt' : ' — noch nicht erfüllt'}</span>
            </li>
            <li className={`flex items-center gap-2 ${mixed ? 'text-accent' : 'text-ink-faint'}`}>
              <Check className="size-3.5" aria-hidden />
              Buchstaben und Ziffern gemischt (empfohlen)
            </li>
          </ul>
        )}
      </div>

      <Turnstile siteKey={siteKey} onVerified={setVerified} resetKey={state} />

      <SubmitButton className="btn btn-primary w-full" disabled={!verified}>
        {mode === 'login' ? 'Anmelden' : 'Konto anlegen'}
      </SubmitButton>
    </form>
  )
}
