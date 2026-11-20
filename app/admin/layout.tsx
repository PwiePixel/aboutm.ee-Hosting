import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { AdminTabs } from '@/components/admin'
import { AppHeader } from '@/components/app-header'
import { requireAdmin } from '@/lib/auth'
import { runtime } from '@/lib/runtime'

export const metadata: Metadata = { title: 'Admin', robots: { index: false, follow: false } }

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await requireAdmin()
  const driver = runtime()
  return (
    <>
      <AppHeader user={user} />
      <main id="inhalt" className="wrap pb-24 pt-10">
        <p className="eyebrow text-accent">Admin</p>
        <h1 className="display mt-3 text-[clamp(34px,6vw,52px)]">Leitstand.</h1>
        <p className="mt-3 text-[14px] text-ink-dim">
          Server laufen über: <strong className="text-ink">{driver.preview ? 'Vorschau (kein echter Server)' : 'Docker'}</strong>
        </p>
        <div className="mt-8">
          <AdminTabs />
        </div>
        <div className="mt-8">{children}</div>
      </main>
    </>
  )
}
