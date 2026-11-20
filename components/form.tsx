'use client'

import { Check, CircleAlert, LoaderCircle } from 'lucide-react'
import type { ReactNode } from 'react'
import { useFormStatus } from 'react-dom'
import type { ActionState } from '@/lib/actions/state'

export function FormMessage({ state }: { state: ActionState }) {
  if (state.error) {
    return (
      <p className="notice notice-error" role="alert">
        <CircleAlert aria-hidden />
        <span>{state.error}</span>
      </p>
    )
  }
  if (state.ok) {
    return (
      <p className="notice" role="status">
        <Check aria-hidden />
        <span>{state.ok}</span>
      </p>
    )
  }
  return null
}

/** Absende-Knopf, der während des Sendens gesperrt ist und einen Ladekreis zeigt. */
export function SubmitButton({
  children,
  className = 'btn btn-primary',
  disabled = false,
  icon,
}: {
  children: ReactNode
  className?: string
  disabled?: boolean
  icon?: ReactNode
}) {
  const { pending } = useFormStatus()
  return (
    <button type="submit" className={className} disabled={disabled || pending} aria-busy={pending}>
      {pending ? <LoaderCircle className="spin" aria-hidden /> : icon}
      {children}
    </button>
  )
}
