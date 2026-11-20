import type { ImageSlot } from './art'

/**
 * Herkunft der mitgelieferten Bilder in public/art/.
 *
 * Alle sind echte Minecraft-Screenshots, die ihr Urheber auf Flickr unter CC BY 2.0 veröffentlicht hat.
 * Die Lizenz erlaubt die Nutzung — auch kommerziell — unter der Bedingung, dass Urheber, Quelle und
 * Lizenz genannt und Änderungen kenntlich gemacht werden. Das erledigt die Seite /bildnachweise.
 * Wer ein Bild austauscht, muss diese Liste mitpflegen.
 */
export type Credit = {
  slot: ImageSlot
  title: string
  author: string
  authorUrl: string
  sourceUrl: string
  license: string
  licenseUrl: string
  changes: string
}

const AUTHOR = 'Minecraft Wallpaper'
const AUTHOR_URL = 'https://www.flickr.com/photos/127712323@N07/'
const LICENSE = 'CC BY 2.0'
const LICENSE_URL = 'https://creativecommons.org/licenses/by/2.0/deed.de'
const CHANGES = 'verkleinert, in WebP umgewandelt und auf der Seite zugeschnitten dargestellt'

function flickr(slot: ImageSlot, title: string, photoId: string): Credit {
  return {
    slot,
    title,
    author: AUTHOR,
    authorUrl: AUTHOR_URL,
    sourceUrl: `https://www.flickr.com/photos/127712323@N07/${photoId}`,
    license: LICENSE,
    licenseUrl: LICENSE_URL,
    changes: CHANGES,
  }
}

export const CREDITS: readonly Credit[] = [
  flickr('hero', 'Die Küste', '15814004745'),
  flickr('welt-1', 'Offene Lichtung', '15194035374'),
  flickr('welt-2', 'Segelschiff', '15817682661'),
  flickr('welt-3', 'Der Teich', '15790326316'),
  flickr('welt-4', 'Roter Meereshügel', '15634394437'),
  flickr('welt-5', 'Tal der Bäume', '15200135633'),
  flickr('welt-6', 'Bergespfad', '15634396787'),
]
