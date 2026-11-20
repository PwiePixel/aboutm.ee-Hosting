import '@fontsource-variable/archivo/wdth.css'
import '@fontsource-variable/manrope/wght.css'
import '@fontsource-variable/jetbrains-mono/wght.css'
import './globals.css'

import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import { Consent } from '@/components/consent'
import { config } from '@/lib/config'

const description =
  'Kostenloser Minecraft-Java-Server mit Paper für dich und deine Freunde. Welt anlegen, Adresse teilen, losspielen — deine Welt bleibt gespeichert.'

export const metadata: Metadata = {
  metadataBase: new URL(config.siteUrl),
  title: {
    default: 'Kostenloser Minecraft-Server für dich und deine Freunde | aboutm.ee',
    template: '%s — aboutm.ee',
  },
  description,
  openGraph: {
    title: 'aboutm.ee — kostenloser Minecraft-Server für Freunde',
    description,
    siteName: 'aboutm.ee',
    locale: 'de_DE',
    type: 'website',
  },
}

export const viewport: Viewport = {
  themeColor: '#0a0c10',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="de" data-scroll-behavior="smooth">
      <body>
        <a
          href="#inhalt"
          className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:bg-accent focus:px-3 focus:py-2 focus:text-accent-ink"
        >
          Zum Inhalt springen
        </a>
        {children}
        <Consent analytics={config.analytics} />
      </body>
    </html>
  )
}
