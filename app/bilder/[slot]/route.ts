import fs from 'node:fs'
import { customImage, isImageSlot } from '@/lib/art'

export const dynamic = 'force-dynamic'

/** Liefert ein im Admin-Bereich hochgeladenes Bild aus. */
export async function GET(_request: Request, { params }: { params: Promise<{ slot: string }> }) {
  const { slot } = await params
  const image = isImageSlot(slot) ? customImage(slot) : null
  if (!image) return new Response('Nicht gefunden', { status: 404 })
  return new Response(new Uint8Array(fs.readFileSync(image.file)), {
    headers: {
      'Content-Type': image.type,
      // Die Adresse enthält ?v=<Änderungszeit> — ein neues Bild bekommt eine neue Adresse.
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
