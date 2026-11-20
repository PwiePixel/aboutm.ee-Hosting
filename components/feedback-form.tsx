'use client'

import { useActionState, useState } from 'react'
import { sendFeedbackAction } from '@/lib/actions/feedback'
import { EMPTY } from '@/lib/actions/state'
import { MESSAGE_MAX } from '@/lib/validation'
import { FormMessage, SubmitButton } from './form'
import { Turnstile } from './turnstile'

const CATEGORIES = [
  { id: 'problem', label: 'Problem' },
  { id: 'feedback', label: 'Feedback' },
  { id: 'kontakt', label: 'Kontakt' },
]

export function FeedbackForm({ siteKey, email }: { siteKey: string; email: string }) {
  const [state, action] = useActionState(sendFeedbackAction, EMPTY)
  const [verified, setVerified] = useState(!siteKey)
  const [category, setCategory] = useState('problem')

  if (state.ok) {
    return (
      <div className="panel p-6">
        <FormMessage state={state} />
      </div>
    )
  }

  return (
    <form action={action} className="space-y-6">
      <fieldset>
        <legend className="label">Worum geht es?</legend>
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((entry) => (
            <label
              key={entry.id}
              className={`cursor-pointer border px-4 py-2.5 text-[14px] font-semibold has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent ${
                category === entry.id
                  ? 'border-accent bg-accent-wash text-accent-strong'
                  : 'border-line-strong text-ink-dim hover:text-ink'
              }`}
            >
              <input
                type="radio"
                name="category"
                value={entry.id}
                checked={category === entry.id}
                onChange={() => setCategory(entry.id)}
                className="sr-only"
              />
              {entry.label}
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <label htmlFor="feedback-email" className="label">
          Deine E-Mail <span className="font-normal text-ink-faint">(optional)</span>
        </label>
        <input
          id="feedback-email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          className="field"
          defaultValue={state.values?.email ?? email}
          aria-describedby="feedback-email-hint"
        />
        <p id="feedback-email-hint" className="hint">
          Nur, damit wir dir antworten können. Ohne E-Mail bleibt deine Nachricht anonym.
        </p>
      </div>

      <div>
        <label htmlFor="feedback-message" className="label">
          Nachricht
        </label>
        <textarea
          id="feedback-message"
          name="message"
          rows={7}
          maxLength={MESSAGE_MAX}
          required
          className="field"
          defaultValue={state.values?.message ?? ''}
          aria-describedby="feedback-message-hint"
        />
        <p id="feedback-message-hint" className="hint">
          Bei einem Problem helfen der Name der Welt und die ungefähre Uhrzeit. Bitte keine Passwörter mitschicken.
        </p>
      </div>

      <Turnstile siteKey={siteKey} onVerified={setVerified} resetKey={state} />
      <FormMessage state={state} />
      <SubmitButton disabled={!verified}>Nachricht senden</SubmitButton>
    </form>
  )
}
