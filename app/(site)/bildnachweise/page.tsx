import type { Metadata } from 'next'
import { customImage, imageUrl } from '@/lib/art'
import { CREDITS } from '@/lib/credits'

export const metadata: Metadata = { title: 'Bildnachweise' }
export const dynamic = 'force-dynamic'

const PLACE: Record<string, string> = { hero: 'Startseite' }

export default function CreditsPage() {
  // Wurde ein Bild im Admin-Bereich durch ein eigenes ersetzt, wird das mitgelieferte nicht mehr gezeigt.
  const shown = CREDITS.filter((credit) => customImage(credit.slot) === null)

  return (
    <div className="wrap max-w-[820px] pt-14">
      <h1 className="display text-[clamp(34px,6vw,52px)]">Bildnachweise</h1>
      <p className="mt-4 text-ink-dim">
        Die Landschaftsbilder auf dieser Seite sind Screenshots aus Minecraft. Ihre Urheber haben sie unter einer
        Creative-Commons-Lizenz veröffentlicht — danke dafür.
      </p>

      {shown.length === 0 ? (
        <p className="panel mt-8 px-4 py-7 text-center text-[14px] text-ink-dim">
          Alle Bilder dieser Seite stammen vom Betreiber selbst.
        </p>
      ) : (
        <ul className="mt-8 space-y-4">
          {shown.map((credit) => (
            <li key={credit.slot} className="panel grid gap-4 p-4 sm:grid-cols-[200px_1fr] sm:items-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imageUrl(credit.slot)}
                alt=""
                loading="lazy"
                className="block aspect-[16/9] w-full object-cover"
              />
              <div className="text-[14px]">
                <p className="text-[12px] uppercase tracking-[0.08em] text-ink-faint">
                  {PLACE[credit.slot] ?? `Welt-Bild ${credit.slot.replace('welt-', '')}`}
                </p>
                <p className="mt-1">
                  <a href={credit.sourceUrl} className="link font-semibold" rel="noopener noreferrer">
                    „{credit.title}“
                  </a>{' '}
                  von{' '}
                  <a href={credit.authorUrl} className="link" rel="noopener noreferrer">
                    {credit.author}
                  </a>
                </p>
                <p className="mt-1 text-ink-dim">
                  Lizenz:{' '}
                  <a href={credit.licenseUrl} className="link" rel="noopener noreferrer license">
                    {credit.license}
                  </a>{' '}
                  · Änderungen: {credit.changes}.
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-8 text-[14px] text-ink-dim">
        Die Lizenz der Urheber gilt für ihre Aufnahmen. Die Rechte am Spiel selbst — Blöcke, Texturen, Erscheinungsbild —
        liegen bei Mojang und Microsoft; gezeigt werden die Bilder im Rahmen der{' '}
        <a href="https://www.minecraft.net/de-de/usage-guidelines" className="link" rel="noopener noreferrer">
          Minecraft Usage Guidelines
        </a>
        .
      </p>
    </div>
  )
}
