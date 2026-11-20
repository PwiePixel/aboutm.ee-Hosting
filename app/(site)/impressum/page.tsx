import type { Metadata } from 'next'
import { LegalPage, Todo } from '@/components/legal'
import { config } from '@/lib/config'
import { imprint, imprintComplete } from '@/lib/imprint'

export const metadata: Metadata = { title: 'Impressum' }
// Die Angaben kommen aus dem Admin-Bereich und sollen sofort sichtbar sein.
export const dynamic = 'force-dynamic'

const date = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Berlin' })

export default function ImprintPage() {
  const data = imprint()
  const mail = data.email ? <a href={`mailto:${data.email}`}>{data.email}</a> : <Todo>E-Mail-Adresse</Todo>

  return (
    <LegalPage title="Impressum">
      {!imprintComplete(data) && (
        <p className="border border-st-starting p-3 text-st-starting">
          Noch unvollständig — die markierten Angaben trägt der Betreiber im Admin-Bereich unter „Impressum“ ein.
        </p>
      )}
      {data.updatedAt && <p className="text-[13px] text-ink-faint">Stand: {date.format(new Date(data.updatedAt))}</p>}

      <h2>Anbieter</h2>
      <p>
        {config.brand} ist ein kostenloser Hosting-Dienst für kleine Minecraft-Welten. Verantwortlich für dieses Angebot
        im Sinne des § 5 DDG ist:
      </p>
      <p>
        <strong>{data.name || <Todo>Vor- und Nachname bzw. Firma</Todo>}</strong>
        <br />
        {data.street || <Todo>Straße und Hausnummer</Todo>}
        <br />
        {data.city || <Todo>PLZ und Ort</Todo>}
        <br />
        {data.country || <Todo>Land</Todo>}
      </p>

      <h2>Kontakt</h2>
      <p>
        E-Mail: {mail}
        {data.phone && (
          <>
            <br />
            Telefon: {data.phone}
          </>
        )}
      </p>

      <h2>Meldung rechtswidriger Inhalte</h2>
      <p>
        Auf unseren Servern liegen Inhalte, die Nutzerinnen und Nutzer selbst erstellen — ihre Welten, Dateien und
        Chat-Protokolle. Wenn du dort etwas für rechtswidrig hältst, melde es uns per E-Mail an {mail} (Meldung nach
        Art. 16 des Digital Services Act). Nenne dabei möglichst genau, worum es geht und wo es zu finden ist.
      </p>
      <p>
        Dieselbe Adresse ist unsere zentrale Kontaktstelle für Behörden sowie für Nutzerinnen und Nutzer (Art. 11 und
        12 DSA). Du kannst uns auf Deutsch oder Englisch schreiben.
      </p>
      <p>
        Wir sehen uns jede Meldung einzeln an. Ist sie berechtigt, sperren oder entfernen wir den Inhalt und sagen
        sowohl dir als auch der betroffenen Person, wie wir entschieden haben.
      </p>

      <h2>Verbraucherstreitbeilegung</h2>
      <p>
        Wir sind nicht bereit und nicht verpflichtet, an Streitbeilegungsverfahren vor einer
        Verbraucherschlichtungsstelle teilzunehmen.
      </p>

      <h2>Haftung für Inhalte und Links</h2>
      <p>Für unsere eigenen Inhalte auf diesen Seiten sind wir nach den allgemeinen Gesetzen verantwortlich.</p>
      <p>
        Für fremde Inhalte, die Nutzerinnen und Nutzer bei uns speichern, sind wir nach § 10 DDG und Art. 6 DSA nicht
        verantwortlich, solange wir von einer Rechtsverletzung nichts wissen. Erfahren wir von einer konkreten
        Rechtsverletzung, entfernen wir den Inhalt unverzüglich.
      </p>
      <p>
        Diese Seiten verweisen auf Websites anderer Anbieter. Auf deren Inhalte haben wir keinen Einfluss; für sie ist
        stets der jeweilige Anbieter verantwortlich.
      </p>

      <h2>Markenhinweis</h2>
      <p>
        {config.brand} ist kein offizieller Minecraft-Dienst. Wir sind nicht mit Mojang Studios oder Microsoft
        verbunden und werden von ihnen weder unterstützt noch geprüft. Für dieses Angebot ist allein der oben genannte
        Anbieter verantwortlich. Minecraft ist eine Marke der Mojang Synergies AB.
      </p>
    </LegalPage>
  )
}
