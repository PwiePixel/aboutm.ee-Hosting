import { ImageSlotCard } from '@/components/admin'
import { IMAGE_SLOTS, customImage, imageUrl } from '@/lib/art'
import { requireAdmin } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export default async function AdminImagesPage() {
  await requireAdmin()
  return (
    <>
      <p className="max-w-[680px] text-[14px] text-ink-dim">
        Lade hier deine eigenen Minecraft-Screenshots hoch (in Minecraft mit <kbd className="bg-panel-2 px-1.5 font-mono">F2</kbd>{' '}
        aufnehmen). JPG, PNG oder WebP bis 6 MB, am besten im Querformat mit mindestens 1920 Pixeln Breite. Nimm nur
        Bilder, die du selbst gemacht hast oder ausdrücklich verwenden darfst.
      </p>
      <ul className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {IMAGE_SLOTS.map((slot) => (
          <ImageSlotCard
            key={slot}
            slot={slot}
            title={slot === 'hero' ? 'Startseite' : `Welt-Bild ${slot.replace('welt-', '')}`}
            hint={
              slot === 'hero'
                ? 'Das große Bild auf der Startseite und über der leeren Weltenliste.'
                : 'Banner über einer Welt und Bild in der Weltenliste.'
            }
            url={imageUrl(slot)}
            custom={customImage(slot) !== null}
          />
        ))}
      </ul>
    </>
  )
}
