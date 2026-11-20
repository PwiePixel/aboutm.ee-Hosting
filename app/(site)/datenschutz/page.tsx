import type { Metadata } from 'next'
import { LegalPage, Todo } from '@/components/legal'
import { config } from '@/lib/config'

export const metadata: Metadata = { title: 'Datenschutz' }

export default function PrivacyPage() {
  const analytics = Boolean(config.analytics.umamiSrc || config.analytics.cloudflareBeaconToken)
  return (
    <LegalPage title="Datenschutz">
      <p className="border border-st-starting p-3 text-st-starting">
        Vorlage — beschreibt, was diese Website technisch tatsächlich tut. Die markierten Angaben musst du ergänzen,
        und der Text ersetzt keine rechtliche Prüfung.
      </p>

      <h2>Wer ist verantwortlich?</h2>
      <p>
        <Todo>Name, Anschrift und E-Mail des Betreibers</Todo>
      </p>

      <h2>Was wir speichern, wenn du ein Konto anlegst</h2>
      <ul>
        <li>
          <strong>E-Mail-Adresse</strong> — zum Anmelden und um dich bei Problemen zu erreichen.
        </li>
        <li>
          <strong>Passwort</strong> — ausschließlich als nicht umkehrbarer Hash (scrypt), nie im Klartext.
        </li>
        <li>
          <strong>Deine Welten</strong> — Name, Einstellungen, Weltdateien, Backups und die Minecraft-Namen auf deiner
          Whitelist.
        </li>
      </ul>
      <p>Rechtsgrundlage ist die Erfüllung des Nutzungsvertrags (Art. 6 Abs. 1 lit. b DSGVO).</p>

      <h2>Cookies</h2>
      <p>
        Wir setzen ein einziges notwendiges Cookie (<code>am_session</code>), damit du angemeldet bleibst. Es läuft
        nach {config.sessionDays} Tagen ab und wird beim Abmelden gelöscht.
      </p>

      <h2>Schutz vor Bots (Cloudflare Turnstile)</h2>
      <p>
        Beim Anmelden, beim Anlegen eines Kontos und beim Hilfe-Formular prüft Cloudflare Turnstile, ob ein Mensch die
        Seite bedient. Dabei verarbeitet Cloudflare, Inc. technische Daten deines Browsers und deine IP-Adresse.
        Rechtsgrundlage ist unser berechtigtes Interesse am Schutz vor Missbrauch (Art. 6 Abs. 1 lit. f DSGVO).
      </p>

      <h2>Minecraft-Server</h2>
      <p>
        Wenn du oder deine Freunde sich mit einer Welt verbinden, verarbeitet der Server Minecraft-Name, Spieler-ID
        und IP-Adresse — das ist für den Spielbetrieb nötig. In der Webkonsole blenden wir IP-Adressen aus.
      </p>

      <h2>Statistik</h2>
      {analytics ? (
        <p>
          Nur wenn du zustimmst, messen wir, welche Seiten aufgerufen werden und wie schnell sie laden. Deine
          Entscheidung kannst du jederzeit über das Schild unten links ändern.
        </p>
      ) : (
        <p>Diese Website nutzt derzeit keine Statistik- oder Werbedienste.</p>
      )}

      <h2>Hosting</h2>
      <p>
        <Todo>Anbieter und Standort des Servers; Hinweis auf Cloudflare als vorgeschalteten Dienst, falls genutzt</Todo>
      </p>

      <h2>Konto und Daten löschen</h2>
      <p>
        Du kannst dein Konto jederzeit unter „Dein Konto“ selbst löschen. Dabei werden alle deine Welten, Dateien und
        Backups sofort entfernt.
      </p>

      <h2>Deine Rechte</h2>
      <p>
        Du hast das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung, Datenübertragbarkeit
        und Widerspruch sowie das Recht, dich bei einer Datenschutz-Aufsichtsbehörde zu beschweren. Schreib uns dazu an{' '}
        <Todo>E-Mail-Adresse</Todo>.
      </p>
    </LegalPage>
  )
}
