import type { ReactNode } from 'react'
import { SiteFooter, SiteHeader } from '@/components/site-chrome'

export default function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main id="inhalt">{children}</main>
      <SiteFooter />
    </>
  )
}
