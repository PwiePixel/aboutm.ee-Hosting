/**
 * Pflichthinweis nach den Minecraft Usage Guidelines („Essential guidelines“): Er muss gut sichtbar
 * auf der Website stehen. Der englische Wortlaut folgt Mojangs Vorgabe, darunter die deutsche Fassung.
 */
export function Disclaimer({ className = '' }: { className?: string }) {
  return (
    <p className={`text-[13px] text-ink-dim ${className}`}>
      <span className="font-semibold uppercase tracking-[0.04em]">
        Not an official Minecraft service. Not approved by or associated with Mojang or Microsoft.
      </span>
      <br />
      Kein offizieller Minecraft-Dienst. Nicht von Mojang oder Microsoft genehmigt und nicht mit ihnen verbunden.
      Minecraft ist eine Marke der Mojang Synergies AB.
    </p>
  )
}

/** Schmale Fußzeile für den angemeldeten Bereich und die Anmeldeseiten. */
export function SlimFooter() {
  return (
    <footer className="border-t border-line">
      <div className="wrap flex flex-col gap-3 py-6">
        <Disclaimer />
        <nav aria-label="Rechtliches" className="flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-ink-faint">
          <a href="/impressum" className="hover:text-ink">
            Impressum
          </a>
          <a href="/datenschutz" className="hover:text-ink">
            Datenschutz
          </a>
          <a href="/hilfe" className="hover:text-ink">
            Feedback &amp; Hilfe
          </a>
        </nav>
      </div>
    </footer>
  )
}
