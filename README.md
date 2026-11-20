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
- **Admin-Bereich** (`/admin`): laufende Server live, Limit für gleichzeitige Server, alle Welten, Konten, Nachrichten
  aus dem Hilfe-Formular, Bild-Upload
- Jedes Konto sieht nur seine eigenen Welten — das wird bei jeder Abfrage auf dem Server geprüft

## Auf dem Server einrichten

Du brauchst einen Linux-Server (KVM) mit [Docker](https://docs.docker.com/engine/install/) und eine Domain bei
Cloudflare.

### 1. DNS bei Cloudflare

| Eintrag | Typ | Ziel | Proxy |
| --- | --- | --- | --- |
| `aboutm.ee` | A | IP deines Servers | an (orange Wolke) |
| `*.aboutm.ee` | A | IP deines Servers | **aus** (graue Wolke, „Nur DNS“) |

Der Platzhalter-Eintrag ist für die Minecraft-Adressen (`mc-xxxx.aboutm.ee`). Er muss auf „Nur DNS“ stehen, weil
Cloudflare Minecraft-Verbindungen nicht durchleitet. Soll die Hauptdomain frei von Platzhaltern bleiben, nimm eine
Unterdomain: `SERVER_DOMAIN=play.aboutm.ee` und dazu den Eintrag `*.play.aboutm.ee`.

Unter **SSL/TLS** den Modus **Full** wählen.

### 2. Firewall

Offen sein müssen die Ports **80**, **443** (Website) und **25565** (Minecraft).

### 3. Turnstile-Schlüssel holen

Cloudflare-Dashboard → **Turnstile** → Widget hinzufügen → Domain eintragen. Du bekommst einen *Site Key* und einen
*Secret Key*.

### 4. Starten

```bash
git clone <dieses-repo> aboutmee && cd aboutmee
```

```bash
cp .env.example .env
```

In `.env` die Domain und die beiden Turnstile-Schlüssel eintragen, dann:

```bash
docker compose up -d --build
```

Beim ersten Start einer Welt lädt Docker das Minecraft-Image (ca. 1,4 GB) — das dauert einmalig ein paar Minuten.

### 5. Dich selbst zum Admin machen

Erst auf der Website ein Konto anlegen, dann auf dem Server:

```bash
docker compose exec web node scripts/make-admin.mjs deine@mail.de
```

Danach erscheint oben in der Leiste **Admin**. Mit `--entfernen` am Ende nimmst du die Rechte wieder weg.

### 6. Vor dem Start erledigen

- **Impressum** und **Datenschutz** ausfüllen: `app/(site)/impressum/page.tsx` und `app/(site)/datenschutz/page.tsx`.
  Die gelb markierten Stellen sind Platzhalter.
- **Eigene Bilder** hochladen: Admin → Bilder. Bis dahin zeigt die Seite mitgelieferte Pixel-Grafiken.

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
| Aktualisieren | `git pull && docker compose up -d --build` |
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
kein echter Minecraft-Server. Mit `RUNTIME_DRIVER=docker npm run dev` werden echte Container gestartet (Docker muss
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
