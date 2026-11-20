import type { Metadata } from 'next'
import { LegalPage, Todo } from '@/components/legal'

export const metadata: Metadata = { title: 'Impressum' }

export default function ImprintPage() {
  return (
    <LegalPage title="Impressum">
      <p className="border border-st-starting p-3 text-st-starting">
        Vorlage — die markierten Angaben müssen vor dem Start durch deine echten Daten ersetzt werden.
      </p>
      <h2>Angaben gemäß § 5 DDG</h2>
      <p>
        <Todo>Vor- und Nachname bzw. Firma</Todo>
        <br />
        <Todo>Straße und Hausnummer</Todo>
        <br />
        <Todo>PLZ und Ort</Todo>
        <br />
        <Todo>Land</Todo>
      </p>
      <h2>Kontakt</h2>
      <p>
        E-Mail: <Todo>E-Mail-Adresse</Todo>
        <br />
        Telefon: <Todo>Telefonnummer, falls vorhanden</Todo>
      </p>
      <h2>Verantwortlich für den Inhalt</h2>
      <p>
        <Todo>Name und Anschrift wie oben</Todo>
      </p>
      <h2>Hinweis zu Minecraft</h2>
      <p>
        aboutm.ee ist kein offizielles Minecraft-Produkt und wird weder von Mojang noch von Microsoft genehmigt oder
        unterstützt. Minecraft ist eine Marke der Mojang Synergies AB.
      </p>
    </LegalPage>
  )
}
