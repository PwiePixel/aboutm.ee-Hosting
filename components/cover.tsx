/**
 * Titelbild einer Fläche. Solange im Admin-Bereich kein eigenes Bild hochgeladen wurde,
 * erscheint eine ruhige, einfarbig verlaufende Fläche — die Seite bringt selbst keine Bilder mit.
 */
export function Cover({
  src,
  alt = '',
  className = '',
  priority = false,
}: {
  src: string | null
  alt?: string
  className?: string
  priority?: boolean
}) {
  if (!src) return <div aria-hidden className={`cover-empty ${className}`} />
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      loading={priority ? 'eager' : 'lazy'}
      fetchPriority={priority ? 'high' : 'auto'}
      decoding="async"
      className={`block object-cover ${className}`}
    />
  )
}
