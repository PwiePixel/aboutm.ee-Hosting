import Link from 'next/link'

/** Wortmarke: der Punkt in „aboutm.ee“ trägt die Markenfarbe. */
export function Logo({ href = '/', className = '' }: { href?: string; className?: string }) {
  return (
    <Link
      href={href}
      aria-label="aboutm.ee – zur Startseite"
      className={`heading inline-flex items-baseline text-[21px] font-extrabold tracking-tight text-ink ${className}`}
    >
      aboutm<span className="text-accent">.</span>ee
    </Link>
  )
}
