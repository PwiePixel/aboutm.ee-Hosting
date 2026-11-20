import type { ReactNode } from 'react'

/** Markiert Angaben, die der Betreiber vor dem Start noch eintragen muss. */
export function Todo({ children }: { children: ReactNode }) {
  return <mark className="bg-st-starting px-1 text-base">[{children}]</mark>
}

export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="wrap max-w-[720px] pt-14">
      <h1 className="display text-[clamp(34px,6vw,52px)]">{title}</h1>
      <div className="mt-8 space-y-4 text-[15px] text-ink-dim [&_h2]:heading [&_h2]:mt-10 [&_h2]:text-[19px] [&_h2]:text-ink [&_li]:ml-5 [&_li]:list-disc [&_strong]:text-ink">
        {children}
      </div>
    </div>
  )
}
