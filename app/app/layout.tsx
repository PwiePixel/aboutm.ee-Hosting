import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { AppHeader } from '@/components/app-header'
import { requireUser } from '@/lib/auth'
import { runtime } from '@/lib/runtime'

export const metadata: Metadata = { robots: { index: false, follow: false } }

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser()
  return (
    <>
      <AppHeader user={user} />
      {runtime().preview && (
        <p className="border-b border-line bg-panel px-5 py-2 text-center text-[13px] text-st-starting">
          Vorschau-Modus: Welten lassen sich anlegen und bedienen, es läuft aber kein echter Minecraft-Server.
        </p>
      )}
      <main id="inhalt" className="wrap pb-24 pt-10">
        {children}
      </main>
    </>
  )
}
