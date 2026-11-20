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
2. legt die DNS-Einträge an: die Website (über Cloudflare, orange Wolke) und die Adresse des Servers für Minecraft
   (direkt, graue Wolke)
3. erzeugt die Turnstile-Schlüssel für die Sicherheitsprüfung
4. öffnet in der Firewall die Ports 80/443 und den Portbereich der Welten (falls `ufw` aktiv ist)
5. baut und startet die Website — zunächst ohne Verbindung nach außen
6. legt dein Admin-Konto an und zeigt dir einmalig das Passwort
7. schaltet die Website öffentlich und lädt die Minecraft-Images vor

Nach der Installation laufen echte Server: Jede Welt ist ein eigener Docker-Container. Das Skript lässt sich jederzeit
erneut starten (auch zum Aktualisieren): Vorhandenes wird wiederverwendet, eigene Zeilen in der `.env` bleiben
erhalten, und bestehende DNS-Einträge überschreibt es nie ohne Rückfrage.

**Das API-Token** legst du im Cloudflare-Dashboard an: *Mein Profil → API-Token → Token erstellen →
Benutzerdefiniertes Token* mit diesen Berechtigungen:

| Bereich | Berechtigung | Stufe |
| --- | --- | --- |
| Zone | DNS | Bearbeiten |
| Zone | Zone | Lesen |
| Konto | Turnstile | Bearbeiten |

Es muss ein persönliches Token sein — mit einem Konto-Token lässt Cloudflare kein Turnstile-Widget anlegen. Das Token
**bleibt auf dem Server gespeichert** (in `.env`, nur für root lesbar), weil die Website damit für jede neue Welt
einen DNS-Eintrag anlegt. Beschränke es auf diese eine Domain. Wer mag, trägt nach der Installation ein zweites,
engeres Token ein, das nur *Zone · DNS · Bearbeiten* darf.

Ohne API-Token geht es auch: Dann fragt das Skript nach den Turnstile-Schlüsseln, du trägst die DNS-Einträge selbst
ein, und Spieler verbinden sich über `<Server-Adresse>:<Port>` statt über einen eigenen Namen je Welt.

### Wie Spieler auf eine Welt kommen

Jede Welt bekommt beim Anlegen einen festen Port auf dem Server (aus `MC_PORT_MIN`–`MC_PORT_MAX`, Standard
25600–26599) und einen DNS-Eintrag bei Cloudflare:

```
_minecraft._tcp.mc-abc123.aboutm.ee   SRV   0 5 25612   node.aboutm.ee
```

Spieler tippen in Minecraft Java nur `mc-abc123.aboutm.ee` ein; das Spiel schlägt den Eintrag nach und verbindet sich
mit dem richtigen Port. Beim Löschen der Welt verschwindet der Eintrag wieder.

Gut zu wissen:

- **Cloudflare begrenzt die Zahl der DNS-Einträge je Domain**: 200 im kostenlosen Tarif (1.000 bei Domains, die vor
  September 2024 angelegt wurden), 3.500 im Pro-Tarif. Jede Welt braucht einen. Den Stand zeigt der Admin-Bereich.
  Ist die Grenze erreicht — oder Cloudflare gerade nicht erreichbar —, bleibt eine neue Welt trotzdem spielbar: Ihre
  Adresse ist dann `node.aboutm.ee:<Port>`, und der Eintrag wird nachgeholt, sobald es wieder geht.
- Die IP des Servers ist über die Minecraft-Adresse sichtbar. Cloudflare leitet nur Webseiten durch, kein Minecraft.
- Der Portbereich muss auch in einer etwaigen Firewall deines Anbieters offen sein.
- Minecraft Bedrock nutzt solche Einträge nicht — das Angebot ist für Java.

### Von Hand

1. **DNS bei Cloudflare:** die Website als A-Eintrag auf die IP des Servers, Proxy **an**; `node.aboutm.ee` als
   A-Eintrag auf dieselbe IP, Proxy **aus** (graue Wolke).
2. **Turnstile:** Cloudflare-Dashboard → Turnstile → Widget hinzufügen → Site Key und Secret Key notieren.
3. `cp .env.example .env` und ausfüllen.
4. Ports 80, 443 und den Portbereich der Welten in der Firewall freigeben.
5. `docker compose up -d --build`
6. Admin-Konto anlegen:

```bash
ADMIN_PASSWORD='dein-passwort' docker compose exec -e ADMIN_PASSWORD web node scripts/make-admin.mjs deine@mail.de
```

Gibt es das Konto schon, bekommt es nur die Admin-Rechte dazu; mit `--entfernen` am Ende nimmst du sie wieder weg.

### HTTPS

Die Website liegt hinter Cloudflare; das öffentliche Zertifikat stellt Cloudflare. Für die Strecke von Cloudflare zu
deinem Server erzeugt Caddy selbst ein Zertifikat (`CADDY_TLS=internal`). Das passt zu den Cloudflare-Modi
*Flexible* und *Full*. Steht deine Domain auf *Full (strict)* oder willst du die Website ohne Cloudflare-Proxy
betreiben, setze in der `.env` `CADDY_TLS=<deine E-Mail>` — dann holt Caddy ein Zertifikat von Let's Encrypt.

### Vor dem Start erledigen

- **Impressum** und **Datenschutz** ausfüllen: `app/(site)/impressum/page.tsx` und `app/(site)/datenschutz/page.tsx`.
  Die gelb markierten Stellen sind Platzhalter. Mojang verlangt außerdem, dass klar ist, wer die Seite betreibt und
  wie man ihn erreicht — eine echte Kontaktadresse (`SUPPORT_EMAIL` in `.env`) gehört also dazu.
- **Bilder** hochladen: Admin → Bilder.

## Bilder

Die Seite bringt keine Bilder mit. Unter **Admin → Bilder** lädst du deine eigenen hoch — ein großes Bild für die
Startseite und bis zu sechs Welt-Bilder, die als Titelbild der Welten dienen. Solange ein Platz leer ist, zeigt die
Seite dort eine neutrale Fläche.

Nimm Screenshots, die du selbst aufgenommen hast (in Minecraft mit F2). Minecraft-Bilder sind nicht lizenzfrei: Die
Rechte am Spiel liegen bei Mojang und Microsoft, deren
[Usage Guidelines](https://www.minecraft.net/de-de/usage-guidelines) eigene Screenshots unter Bedingungen erlauben —
unter anderem mit dem Hinweis „Not an official Minecraft service …“, der hier auf jeder Seite steht. Fremde Bilder
aus dem Netz brauchen zusätzlich die Erlaubnis dessen, der sie gemacht hat.

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

Die Spielerliste meldet der Server der jeweiligen Welt. Gezählt werden nur gültige Minecraft-Namen, jeder einmal und
höchstens so viele, wie es Spielerplätze gibt.

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
`backups/` und `bilder/`. Je Welt sind bis zu 6 GiB Dateien und zusammen 12 GiB Backups möglich — plane den
Plattenplatz entsprechend. **Diesen Ordner solltest du regelmäßig extern sichern.**

Wie viele Welten gleichzeitig laufen dürfen, stellst du im Admin-Bereich ein. Als Faustregel: jede laufende Welt
kann bis zu 2,5 GiB Arbeitsspeicher belegen — bei 16 GB RAM also etwa 5 gleichzeitig, mit Luft für das System.

### Minecraft-Versionen pflegen

Die Liste steht in `lib/versions.ts`. Den aktuellen Paper-Build einer Version zeigt
`https://fill.papermc.io/v3/projects/paper/versions/<version>/builds/latest`.

## Sicherheit — gut zu wissen

- **Weltordner gelten als fremd.** Wer eine Welt besitzt, kann über Konfigurationsdateien eigenen Code in seinem
  Minecraft-Container ausführen. Die Website folgt deshalb in Weltordnern grundsätzlich keinen symbolischen Links —
  weder im Dateimanager noch beim Starten, Sichern, Wiederherstellen oder Löschen (`lib/safe-fs.ts`). Die Tests in
  `tests/symlink-safety.test.ts` spielen genau diese Angriffe durch.
- **Minecraft-Container** laufen ohne Root-Rechte, ohne Zusatzrechte (`cap-drop ALL`) und mit festen Grenzen für
  RAM, CPU und Prozesse. Untereinander können sie sich nicht erreichen; Internetzugang haben sie.
- **Die Website hat Zugriff auf den Docker-Socket** und damit volle Kontrolle über den Server. Betreibe auf diesem
  Server nichts anderes Schützenswertes und halte ihn aktuell.
- **Ohne Turnstile-Schlüssel bleiben Formulare im Live-Betrieb gesperrt** — ein vergessener Schlüssel öffnet die
  Seite nicht für Bots. (`ALLOW_NO_TURNSTILE=1` hebt das zum Ausprobieren auf.)
- **Die Adresse des Besuchers** (für Anmelde-Limits) wird nur aus der Kopfzeile gelesen, die Caddy selbst setzt.
  Caddy glaubt dabei nur Cloudflares Servern.
- Passwörter werden mit scrypt gehasht. Sitzungen liegen als Hash in der Datenbank; das Cookie ist `HttpOnly`.
- **Das Cloudflare-Token liegt auf dem Server** (`.env`). Wer den Server übernimmt, kann damit die DNS-Einträge
  der Domain ändern — deshalb das Token auf diese eine Domain und auf DNS beschränken.

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
