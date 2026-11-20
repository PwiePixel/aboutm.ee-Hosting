# aboutm.ee Hosting

Kostenlose Minecraft-Java-Server (Paper) für Freundesgruppen: Welt im Browser anlegen, starten, Adresse teilen,
spielen. Jede Welt läuft als eigener Docker-Container; pausierte Welten belegen keinen Arbeitsspeicher.

## Was drin ist

- **Startseite**, Anmeldung und Registrierung mit Cloudflare-Sicherheitsprüfung (Turnstile)
- **Deine Welten**: bis zu 3 Welten pro Konto, eine davon gleichzeitig online
- **Welt-Seite** mit Übersicht (Starten / Pausieren / Neustarten, Spieler, CPU, RAM), Konsole, Dateien, Backups und
  Einstellungen (Name, Spielmodus, Schwierigkeit, Whitelist, Versionswechsel, Löschen)
- **Serverplätze und Warteschlange**: laufen schon so viele Welten wie erlaubt, wartet der nächste Start in der Schlange
- **Auto-Pause** nach 30 Minuten ohne Spieler
- **Admin-Bereich** (`/admin`): laufende Server live, Limit für gleichzeitige Server, Statistik der letzten 14 Tage,
  alle Welten, Konten, Nachrichten aus dem Hilfe-Formular, Bild-Upload
- **Statistik**: Spielstunden, Spieler gleichzeitig, Server-Starts und erstellte Server
- Jedes Konto sieht nur seine eigenen Welten — das wird bei jeder Abfrage auf dem Server geprüft

## Auf dem Server einrichten

Du brauchst einen Linux-Server (KVM) mit Debian oder Ubuntu und eine Domain, die bei Cloudflare liegt.

### Mit dem Install-Skript (empfohlen)

```bash
git clone https://github.com/PwiePixel/aboutm.ee-Hosting.git aboutmee && cd aboutmee
```

```bash
sudo ./install.sh
```

Das Skript fragt nach der Adresse der Website, deiner E-Mail-Adresse und einem Cloudflare-API-Token. Danach macht es
alles selbst:

1. installiert Docker
2. legt einen **Cloudflare-Tunnel** für die Website an — Port 80/443 müssen dafür nicht offen sein, und die Website
   verrät die IP des Servers nicht
3. setzt die DNS-Einträge: die Website über den Tunnel, `*.<Domain>` für die Minecraft-Adressen direkt auf den Server
4. erzeugt die Turnstile-Schlüssel für die Sicherheitsprüfung
5. öffnet Port 25565 in der Firewall (falls `ufw` aktiv ist)
6. baut und startet alles, lädt die Minecraft-Images vor
7. legt dein Admin-Konto an und zeigt dir einmalig das Passwort

Das Skript lässt sich jederzeit erneut starten (auch zum Aktualisieren): Vorhandenes wird wiederverwendet, und
bestehende DNS-Einträge überschreibt es nie ohne Rückfrage.

**Das API-Token** legst du im Cloudflare-Dashboard an: *Mein Profil → API-Token → Token erstellen →
Benutzerdefiniertes Token* mit diesen Berechtigungen:

| Bereich | Berechtigung | Stufe |
| --- | --- | --- |
| Konto | Cloudflare Tunnel | Bearbeiten |
| Konto | Turnstile | Bearbeiten |
| Zone | DNS | Bearbeiten |
| Zone | Zone | Lesen |

Das Token wird nur während der Installation benutzt und nirgends gespeichert. Du kannst es danach wieder löschen.

Ohne API-Token geht es auch: Dann fragt das Skript nach den Turnstile-Schlüsseln und optional nach einem
Tunnel-Token, und du trägst die DNS-Einträge selbst ein.

> Minecraft selbst läuft nicht durch den Tunnel — Cloudflare leitet Minecraft-Verbindungen im kostenlosen Tarif nicht
> durch. Spieler verbinden sich direkt mit dem Server über Port 25565; die IP des Servers ist über die
> Minecraft-Adressen also sichtbar.

### Von Hand

1. **DNS bei Cloudflare:** `*.aboutm.ee` als A-Eintrag auf die IP des Servers, Proxy **aus** (graue Wolke). Für die
   Website entweder einen Tunnel einrichten (öffentlicher Hostname → `http://web:3000`) oder einen A-Eintrag mit
   Proxy an und SSL/TLS-Modus **Full**.
2. **Turnstile:** Cloudflare-Dashboard → Turnstile → Widget hinzufügen → Site Key und Secret Key notieren.
3. `cp .env.example .env` und ausfüllen. `COMPOSE_PROFILES=tunnel` (mit `TUNNEL_TOKEN`) oder `COMPOSE_PROFILES=caddy`.
4. `docker compose up -d --build`
5. Admin-Konto anlegen:

```bash
ADMIN_PASSWORD='dein-passwort' docker compose exec -e ADMIN_PASSWORD web node scripts/make-admin.mjs deine@mail.de
```

Gibt es das Konto schon, bekommt es nur die Admin-Rechte dazu; mit `--entfernen` am Ende nimmst du sie wieder weg.

### Vor dem Start erledigen

- **Impressum** und **Datenschutz** ausfüllen: `app/(site)/impressum/page.tsx` und `app/(site)/datenschutz/page.tsx`.
  Die gelb markierten Stellen sind Platzhalter. Mojang verlangt außerdem, dass klar ist, wer die Seite betreibt und
  wie man ihn erreicht — eine echte Kontaktadresse (`SUPPORT_EMAIL` in `.env`) gehört also dazu.

## Bilder

Die mitgelieferten Bilder in `public/art/` sind echte Minecraft-Screenshots, die ihr Urheber auf Flickr unter
[CC BY 2.0](https://creativecommons.org/licenses/by/2.0/deed.de) veröffentlicht hat. Die Lizenz verlangt, Urheber,
Quelle und Lizenz zu nennen — das macht die Seite `/bildnachweise` (Daten in `lib/credits.ts`).

Wichtig zu wissen: Minecraft-Bilder sind **nicht** lizenzfrei. Die Rechte am Spiel liegen bei Mojang und Microsoft;
deren [Usage Guidelines](https://www.minecraft.net/de-de/usage-guidelines) erlauben Screenshots unter Bedingungen,
unter anderem dem Hinweis „Not an official Minecraft service …“, der hier auf jeder Seite steht. Am saubersten sind
Screenshots, die du selbst aufgenommen hast: Unter **Admin → Bilder** lädst du sie hoch, sie ersetzen die
mitgelieferten sofort, und deren Eintrag verschwindet aus den Bildnachweisen.

## Statistik

Gezählt wird laufend und automatisch — als Gesamtwert und je Tag:

| Zahl | Bedeutung |
| --- | --- |
| Server erstellt | jede angelegte Welt |
| Server-Starts | jeder Start, der online ankommt (auch Neustarts) |
| Spielstunden | Zeit, in der Spieler verbunden waren — zwei Spieler eine Stunde lang sind zwei Stunden |
| Spieler gleichzeitig | Höchstwert über alle Welten, mit Datum des Rekords |
| Server gleichzeitig | Höchstwert gleichzeitig laufender Welten |
| Verschiedene Spieler | jeder Minecraft-Name einmal — gespeichert nur als nicht umkehrbarer Fingerabdruck |

Zu sehen auf der Startseite, unter `/zahlen`, im Admin-Bereich (mit den letzten 14 Tagen) und je Welt in der
Übersicht. Die Spielerzahl fragt die Website alle zehn Sekunden bei jedem laufenden Server ab.

## Die Cloudflare-Prüfung „Bestätigen Sie, dass Sie ein Mensch sind“

Es gibt zwei Ebenen:

1. **In den Formularen** (Login, Registrierung, Hilfe): eingebaut über Turnstile. Der Server prüft jedes Token selbst
   nach — ohne gültige Prüfung wird nichts angelegt.
2. **Vor der ganzen Seite**: das stellst du im Cloudflare-Dashboard ein, nicht im Code. Unter **Security → WAF →
   Custom rules** eine Regel mit der Aktion *Managed Challenge* anlegen (z. B. für `/login`, `/register` und `/app`),
   oder bei einem Angriff vorübergehend den *Under Attack Mode* einschalten.

## Betrieb

| Aufgabe | Befehl |
| --- | --- |
| Aktualisieren | `git pull && sudo ./install.sh` |
| Logs der Website | `docker compose logs -f web` |
| Laufende Welten | `docker ps --filter label=aboutmee.world` |
| Stoppen | `docker compose down` (laufende Welten vorher im Admin-Bereich pausieren) |

Alle Daten liegen unter `DATA_PATH` (Standard `/srv/aboutmee/data`): die Datenbank `aboutmee.sqlite`, `worlds/`,
`backups/` und `bilder/`. **Diesen Ordner solltest du regelmäßig extern sichern.**

Wie viele Welten gleichzeitig laufen dürfen, stellst du im Admin-Bereich ein. Als Faustregel: jede laufende Welt
kann bis zu 2,5 GiB Arbeitsspeicher belegen — bei 16 GB RAM also etwa 5 gleichzeitig, mit Luft für das System.

### Minecraft-Versionen pflegen

Die Liste steht in `lib/versions.ts`. Den aktuellen Paper-Build einer Version zeigt
`https://fill.papermc.io/v3/projects/paper/versions/<version>/builds/latest`.

## Sicherheit — gut zu wissen

- Die Website hat Zugriff auf den Docker-Socket und damit volle Kontrolle über den Server. Betreibe auf diesem Server
  nichts anderes Schützenswertes und halte ihn aktuell.
- Minecraft-Container laufen ohne Root-Rechte, ohne Zusatzrechte (`cap-drop ALL`) und mit festen Grenzen für RAM, CPU
  und Prozesse.
- Passwörter werden mit scrypt gehasht. Sitzungen liegen als Hash in der Datenbank; das Cookie ist `HttpOnly`.
- Im Datei-Editor lassen sich nur Textdateien im eigenen Weltordner öffnen — kein Upload, kein Download, keine
  symbolischen Links.

## Lokal entwickeln

```bash
npm install
```

```bash
npm run dev
```

Ohne weitere Einstellungen läuft der **Vorschau-Modus**: Welten lassen sich anlegen und bedienen, es startet aber
kein echter Minecraft-Server. In der Konsole einer laufenden Vorschau-Welt simulieren `testjoin Steve` und
`testleave Steve` einen Spieler — praktisch, um Statistik und Auto-Pause auszuprobieren. Mit `RUNTIME_DRIVER=docker npm run dev` werden echte Container gestartet (Docker muss
laufen).

```bash
npm test
```

## Aufbau

| Ordner | Inhalt |
| --- | --- |
| `app/` | Seiten: `(site)` öffentlich, `(auth)` Anmeldung, `app` Welten, `admin` Leitstand |
| `components/` | Bausteine der Oberfläche |
| `lib/` | Logik: Welten und Warteschlange (`worlds.ts`), Dateien, Backups, Anmeldung, Einstellungen |
| `lib/runtime/` | Wie Welten laufen: `docker.ts` (echte Container), `simulated.ts` (Vorschau) |
| `lib/actions/` | Alles, was Formulare und Knöpfe auf dem Server auslösen |

## Noch nicht enthalten

- Passwort zurücksetzen per E-Mail (dafür braucht es einen Mail-Versand)
- Bestätigung der E-Mail-Adresse bei der Registrierung
- Plugins, Mods, Bedrock, eigene Welten hochladen
- Eigenes Server-Icon in der Minecraft-Serverliste
