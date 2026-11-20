#!/usr/bin/env bash
#
# aboutm.ee Hosting — Installation auf einem frischen Debian- oder Ubuntu-Server.
#
#   sudo ./install.sh
#
# Das Skript installiert Docker, richtet mit deinem Cloudflare-API-Token die DNS-Einträge und die
# Turnstile-Schlüssel ein, startet alles und legt dein Admin-Konto an. Die Website läuft direkt über
# diesen Server (HTTPS per Caddy). Jede Welt bekommt später ihren eigenen Port und — über dasselbe
# API-Token — automatisch ihren eigenen SRV-Eintrag.
# Es lässt sich gefahrlos erneut ausführen: Vorhandenes wird wiederverwendet, nicht doppelt angelegt.
#
# Ohne Rückfragen (z. B. für Automatisierung) über Umgebungsvariablen:
#   AM_SITE_DOMAIN, AM_SERVER_DOMAIN, AM_NODE_HOST, AM_ADMIN_EMAIL, AM_ADMIN_PASSWORD,
#   AM_CF_API_TOKEN  oder  AM_TURNSTILE_SITE_KEY + AM_TURNSTILE_SECRET_KEY,
#   AM_PUBLIC_IP, AM_DATA_PATH, AM_PORT_MIN, AM_PORT_MAX, AM_CADDY_TLS, AM_ORIGIN_ALLOW,
#   AM_SITE_PROXIED=true|false, AM_YES=1

set -Eeuo pipefail

REPO_URL="${AM_REPO_URL:-https://github.com/PwiePixel/aboutm.ee-Hosting.git}"
INSTALL_DIR="${AM_INSTALL_DIR:-/opt/aboutmee}"
CF_API="${AM_CF_API_BASE:-https://api.cloudflare.com/client/v4}"
WIDGET_NAME="${AM_WIDGET_NAME:-aboutm.ee Hosting}"

# ─────────────────────────── Ausgabe und Eingabe ───────────────────────────

if [[ -t 1 ]]; then
  BOLD=$'\033[1m' DIM=$'\033[2m' GREEN=$'\033[32m' YELLOW=$'\033[33m' RED=$'\033[31m' RESET=$'\033[0m'
else
  BOLD='' DIM='' GREEN='' YELLOW='' RED='' RESET=''
fi

step() { printf '\n%s▸ %s%s\n' "$BOLD" "$*" "$RESET"; }
ok() { printf '  %s✓%s %s\n' "$GREEN" "$RESET" "$*"; }
note() { printf '  %s%s%s\n' "$DIM" "$*" "$RESET"; }
warn() { printf '  %s! %s%s\n' "$YELLOW" "$*" "$RESET" >&2; }
die() {
  trap - ERR # die eigene Meldung reicht — nicht noch „Abgebrochen in Zeile …“ hinterher
  printf '\n%s✗ %s%s\n' "$RED" "$*" "$RESET" >&2
  exit 1
}

WORK_DIR=''
cleanup() {
  trap - ERR
  if [[ -n "$WORK_DIR" && -d "$WORK_DIR" ]]; then rm -rf -- "$WORK_DIR"; fi
}
trap cleanup EXIT
trap 'die "Abgebrochen in Zeile $LINENO. Du kannst das Skript einfach noch einmal starten."' ERR

# Gibt es ein Terminal, an dem jemand antworten kann? (Die Datei /dev/tty existiert auch ohne.)
has_tty() { { : </dev/tty; } 2>/dev/null; }

# Fragt am Terminal nach — auch wenn das Skript per Pipe gestartet wurde.
ask() { # ask <Variable> <Frage> [Vorgabe]
  local __var="$1" __question="$2" __default="${3:-}" __answer=''
  if [[ "${AM_YES:-}" == 1 ]]; then
    [[ -n "$__default" ]] || die "Angabe fehlt und AM_YES=1 ist gesetzt: $__question"
    printf -v "$__var" '%s' "$__default"
    return
  fi
  has_tty || die "Kein Terminal für Rückfragen. Setze die AM_…-Variablen (siehe Kopf des Skripts)."
  if [[ -n "$__default" ]]; then
    read -r -p "  $__question [$__default]: " __answer </dev/tty
  else
    read -r -p "  $__question: " __answer </dev/tty
  fi
  printf -v "$__var" '%s' "${__answer:-$__default}"
}

ask_secret() { # ask_secret <Variable> <Frage>
  local __var="$1" __question="$2" __answer=''
  [[ "${AM_YES:-}" == 1 ]] && die "Angabe fehlt und AM_YES=1 ist gesetzt: $__question"
  has_tty || die "Kein Terminal für Rückfragen. Setze die AM_…-Variablen (siehe Kopf des Skripts)."
  read -r -s -p "  $__question: " __answer </dev/tty
  printf '\n' >/dev/tty
  printf -v "$__var" '%s' "$__answer"
}

confirm() { # confirm <Frage>  → 0 bei Ja
  local answer=''
  [[ "${AM_YES:-}" == 1 ]] && return 0
  has_tty || return 1
  read -r -p "  $1 [j/N]: " answer </dev/tty
  [[ "$answer" =~ ^[jJyY]$ ]]
}

is_domain() { [[ "$1" =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$ ]]; }
is_email() { [[ "$1" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$ ]]; }

# Liest einen Wert aus einer vorhandenen .env, damit ein zweiter Lauf nichts überschreibt.
# Verträgt auch von Hand geschriebene Zeilen: KEY="wert", KEY='wert' und KEY=wert   # Kommentar
env_value() { # env_value <Datei> <Schlüssel>
  [[ -f "$1" ]] || return 0
  local value
  value="$(sed -n "s/^[[:space:]]*$2[[:space:]]*=[[:space:]]*//p" "$1" | tail -n 1)"
  value="${value%$'\r'}"
  if [[ "$value" =~ ^\"([^\"]*)\" || "$value" =~ ^\'([^\']*)\' ]]; then
    value="${BASH_REMATCH[1]}"
  else
    value="${value%%[[:space:]]#*}"
    value="${value%"${value##*[![:space:]]}"}"
  fi
  printf '%s' "$value"
}

# Schlüssel, die dieses Skript in der .env selbst verwaltet. Alles andere bleibt unangetastet erhalten.
MANAGED_KEYS='SITE_DOMAIN SITE_URL SERVER_DOMAIN NODE_HOST MC_PORT_MIN MC_PORT_MAX CLOUDFLARE_API_TOKEN CLOUDFLARE_ZONE_ID TURNSTILE_SITE_KEY TURNSTILE_SECRET_KEY CADDY_TLS ORIGIN_ALLOW CLOUDFLARE_IPS DATA_PATH TOTAL_SLOTS AUTO_PAUSE_MINUTES MC_CPUS SUPPORT_EMAIL COMPOSE_PROFILES TUNNEL_TOKEN CLIENT_IP_HEADER'

# Gibt alle Einstellungen einer .env aus, die dieses Skript nicht selbst verwaltet (z. B. Statistik-Schlüssel).
env_extras() { # env_extras <Datei>
  [[ -f "$1" ]] || return 0
  awk -v managed="$MANAGED_KEYS" '
    BEGIN { n = split(managed, list, " "); for (i = 1; i <= n; i++) skip[list[i]] = 1 }
    /^[[:space:]]*[A-Za-z_][A-Za-z0-9_]*[[:space:]]*=/ {
      key = $0; sub(/^[[:space:]]*/, "", key); sub(/[[:space:]]*=.*/, "", key)
      if (!(key in skip)) print
    }' "$1"
}

# ─────────────────────────── Cloudflare-API ───────────────────────────

CF_HEADERS=''
ZONE_STATUS=''
CLOUDFLARE_ZONE_ID=''
# Ob die Website nach der Einrichtung über den Cloudflare-Proxy läuft (true/false) oder das offen ist (leer).
SITE_PROXIED=''
DNS_PROXIED=''

# Adressbereiche, aus denen Cloudflare diesen Server anspricht — Stand 20.11.2026. install.sh holt beim
# Lauf die aktuelle Liste und nimmt diese nur, wenn das nicht klappt.
CF_RANGES_BUILTIN='173.245.48.0/20 103.21.244.0/22 103.22.200.0/22 103.31.4.0/22 141.101.64.0/18 108.162.192.0/18 190.93.240.0/20 188.114.96.0/20 197.234.240.0/22 198.41.128.0/17 162.158.0.0/15 104.16.0.0/13 104.24.0.0/14 172.64.0.0/13 131.0.72.0/22 2400:cb00::/32 2606:4700::/32 2803:f800::/32 2405:b500::/32 2405:8100::/32 2a06:98c0::/29 2c0f:f248::/32'

# Gibt die aktuellen Adressbereiche von Cloudflare aus, durch Leerzeichen getrennt.
cloudflare_ranges() {
  local v4 v6 list
  v4="$(curl -fsS --max-time 10 "${AM_CF_IPS_BASE:-https://www.cloudflare.com}/ips-v4" 2>/dev/null || true)"
  v6="$(curl -fsS --max-time 10 "${AM_CF_IPS_BASE:-https://www.cloudflare.com}/ips-v6" 2>/dev/null || true)"
  list="$(printf '%s\n%s\n' "$v4" "$v6" | tr -d '\r' | grep -E '^[0-9a-fA-F:.]+/[0-9]{1,3}$' | tr '\n' ' ' || true)"
  list="${list% }"
  # Nur eine plausible Liste übernehmen — beide Arten von Adressen und nichts Abgeschnittenes.
  if [[ -n "$v4" && -n "$v6" && "$(wc -w <<<"$list")" -ge 10 && "$list" == *.*/* && "$list" == *:*/* ]]; then
    printf '%s' "$list"
  else
    printf '%s' "$CF_RANGES_BUILTIN"
  fi
}

# Ruft die Cloudflare-API auf und gibt die Antwort aus. Bricht mit der Meldung von Cloudflare ab,
# wenn der Aufruf scheitert. Das Token steht nur in einer Datei, nie in der Prozessliste.
cf() { # cf <METHODE> <Pfad> [JSON-Daten]
  local method="$1" path="$2" data="${3:-}" response
  local -a args=(--silent --show-error --max-time 30 --request "$method" --header "@$CF_HEADERS")
  [[ -n "$data" ]] && args+=(--header 'Content-Type: application/json' --data "$data")
  response="$(curl "${args[@]}" "$CF_API$path")" || die "Cloudflare ist nicht erreichbar ($method $path)."
  if [[ "$(jq -r '.success // false' <<<"$response" 2>/dev/null)" != true ]]; then
    die "Cloudflare meldet einen Fehler bei $method $path: $(jq -r '[.errors[]?.message] | join("; ")' <<<"$response" 2>/dev/null || printf '%s' "$response")"
  fi
  printf '%s' "$response"
}

# Wie cf, aber ohne Abbruch: gibt bei einem Fehler nur einen Status ungleich 0 zurück.
cf_try() { # cf_try <METHODE> <Pfad> [JSON-Daten]
  local response
  local -a args=(--silent --max-time 30 --request "$1" --header "@$CF_HEADERS")
  [[ -n "${3:-}" ]] && args+=(--header 'Content-Type: application/json' --data "$3")
  response="$(curl "${args[@]}" "$CF_API$2")" || return 1
  [[ "$(jq -r '.success // false' <<<"$response" 2>/dev/null)" == true ]] || return 1
  printf '%s' "$response"
}

# Findet die Zone zu einer Adresse: erst die Adresse selbst, dann Stück für Stück die übergeordnete Domain.
# Gibt es keine, bleibt ZONE_ID leer. Scheitert der Aufruf selbst (Token, Netz), endet das Skript mit
# der Meldung von Cloudflare — ausdrücklich, denn in einer Bedingung griffe „set -e“ hier nicht.
cf_find_zone() { # cf_find_zone <Adresse>  → setzt ZONE_ID, ZONE_NAME, ACCOUNT_ID
  local candidate="$1" response
  ZONE_ID=''
  while [[ "$candidate" == *.* ]]; do
    response="$(cf GET "/zones?name=$candidate")" || exit 1
    if [[ "$(jq -r '.result | length' <<<"$response")" -gt 0 ]]; then
      ZONE_ID="$(jq -r '.result[0].id' <<<"$response")"
      ZONE_NAME="$(jq -r '.result[0].name' <<<"$response")"
      ACCOUNT_ID="$(jq -r '.result[0].account.id' <<<"$response")"
      ZONE_STATUS="$(jq -r '.result[0].status // "active"' <<<"$response")"
      return 0
    fi
    candidate="${candidate#*.}"
  done
  return 0
}

# Prüft ohne Abbruch, ob das Token die Domain zu einer Adresse lesen darf.
# Rückgabe: 0 = ja · 1 = Cloudflare hat geantwortet, aber das Token darf es nicht · 2 = Cloudflare nicht erreichbar
cf_zone_visible() { # cf_zone_visible <Adresse>
  local candidate="$1" body code
  while [[ "$candidate" == *.* ]]; do
    body="$(curl --silent --max-time 30 --header "@$CF_HEADERS" --write-out '\n%{http_code}' "$CF_API/zones?name=$candidate")" || return 2
    code="${body##*$'\n'}"
    body="${body%$'\n'*}"
    case "$code" in
    200) ;;
    400 | 401 | 403) return 1 ;;
    *) return 2 ;;
    esac
    [[ "$(jq -r '.success // false' <<<"$body" 2>/dev/null)" == true ]] || return 2
    if [[ "$(jq -r '.result | length' <<<"$body")" -gt 0 ]]; then return 0; fi
    candidate="${candidate#*.}"
  done
  return 1
}

# Stellt ohne API fest, ob die Website über den Cloudflare-Proxy läuft: gibt true, false oder nichts aus.
detect_site_proxied() {
  if [[ -n "${AM_SITE_PROXIED:-}" ]]; then
    printf '%s' "$AM_SITE_PROXIED"
    return
  fi
  # Zeigt die Adresse direkt auf diesen Server, ist kein Proxy davor.
  if getent ahostsv4 "$SITE_DOMAIN" 2>/dev/null | awk '{print $1}' | grep -qxF "$PUBLIC_IP"; then
    printf 'false'
    return
  fi
  # Diese Seite beantwortet Cloudflare selbst — nur wenn die Adresse über seinen Proxy läuft.
  if curl -fsS --max-time 10 "https://$SITE_DOMAIN/cdn-cgi/trace" 2>/dev/null | grep -qxF "h=$SITE_DOMAIN"; then
    printf 'true'
  fi
}

# Legt einen DNS-Eintrag an oder aktualisiert ihn. Fragt nach, bevor ein fremder Eintrag ersetzt wird.
# Setzt DNS_PROXIED darauf, ob der Eintrag danach über den Cloudflare-Proxy läuft.
cf_dns_upsert() { # cf_dns_upsert <Typ> <Name> <Ziel> <proxied true|false> <Zone>
  local type="$1" name="$2" content="$3" proxied="$4" zone="$5" existing id current current_type current_proxied body
  DNS_PROXIED="$proxied"
  body="$(jq -n --arg type "$type" --arg name "$name" --arg content "$content" --argjson proxied "$proxied" \
    '{type: $type, name: $name, content: $content, proxied: $proxied, ttl: 1, comment: "aboutm.ee Hosting"}')"
  # Ein Name kann nur entweder A/AAAA- oder CNAME-Einträge haben — deshalb alle drei Arten prüfen.
  # Der Name wird kodiert übergeben — Platzhalter-Einträge enthalten ein "*".
  existing="$(cf GET "/zones/$zone/dns_records?name.exact=$(jq -rn --arg value "$name" '$value | @uri')&per_page=100")"
  existing="$(jq -c '[.result[] | select(.type == "A" or .type == "AAAA" or .type == "CNAME")]' <<<"$existing")"

  if [[ "$(jq 'length' <<<"$existing")" -eq 0 ]]; then
    cf POST "/zones/$zone/dns_records" "$body" >/dev/null
    ok "DNS: $name → $content angelegt"
    return
  fi

  current="$(jq -r '.[0].content' <<<"$existing")"
  current_type="$(jq -r '.[0].type' <<<"$existing")"
  id="$(jq -r '.[0].id' <<<"$existing")"
  current_proxied="$(jq -r '.[0].proxied // false' <<<"$existing")"
  if [[ "$(jq 'length' <<<"$existing")" -eq 1 && "$current_type" == "$type" && "$current" == "$content" ]]; then
    if [[ "$current_proxied" == "$proxied" ]]; then
      ok "DNS: $name zeigt schon auf $content"
      return
    fi
    if [[ "$proxied" == true ]]; then
      # Der Eintrag stimmt, nur der Cloudflare-Proxy ist bewusst aus — das bleibt so.
      DNS_PROXIED=false
      ok "DNS: $name zeigt schon auf $content"
      note "Der Cloudflare-Proxy ist für $name ausgeschaltet (graue Wolke) und bleibt es. Für den Schutz durch Cloudflare im Dashboard einschalten."
      return
    fi
    # Umgekehrt: Der Proxy ist an, darf es für Minecraft aber nicht sein — er leitet nur Webseiten durch.
    warn "Für $name ist der Cloudflare-Proxy eingeschaltet (orange Wolke). Minecraft-Verbindungen kommen so nicht an."
    confirm "Proxy für $name ausschalten?" ||
      die "DNS für $name nicht geändert. Schalte den Proxy für diesen Eintrag selbst aus oder gib mit AM_NODE_HOST=<Adresse> eine andere Adresse an."
    cf PATCH "/zones/$zone/dns_records/$id" '{"proxied": false}' >/dev/null
    ok "DNS: Proxy für $name ausgeschaltet"
    return
  fi

  warn "Für $name gibt es schon DNS-Einträge:"
  jq -r '.[] | "      \(.type) \(.name) → \(.content)"' <<<"$existing" >&2
  if ! confirm "Durch $type → $content ersetzen? (Bei Nein bleibt alles, wie es ist.)"; then
    die "DNS für $name nicht geändert. Wähle eine andere Adresse oder ändere den Eintrag selbst im Cloudflare-Dashboard."
  fi
  # Alle bisherigen Einträge dieses Namens entfernen, dann den neuen setzen.
  while read -r id; do
    cf DELETE "/zones/$zone/dns_records/$id" >/dev/null
  done < <(jq -r '.[].id' <<<"$existing")
  cf POST "/zones/$zone/dns_records" "$body" >/dev/null
  ok "DNS: $name → $content ersetzt"
}

# Richtet DNS und Turnstile über die API ein. Setzt CLOUDFLARE_ZONE_ID, TURNSTILE_SITE_KEY, TURNSTILE_SECRET_KEY.
cloudflare_setup() {
  local response widget
  step "Cloudflare einrichten"

  # Persönliche Tokens lassen sich so vorab prüfen. Konto-Tokens kennen diesen Aufruf nicht —
  # bei ihnen zeigt erst die Suche nach der Domain, ob das Token taugt.
  if response="$(cf_try GET '/user/tokens/verify')"; then
    [[ "$(jq -r '.result.status' <<<"$response")" == active ]] || die "Das API-Token ist nicht aktiv."
    ok "API-Token ist gültig"
  fi

  # Erst beide Domains suchen und alles prüfen — geändert wird erst, wenn die Angaben zusammenpassen.
  cf_find_zone "$SITE_DOMAIN"
  [[ -n "$ZONE_ID" ]] || die "Zu $SITE_DOMAIN gibt es in diesem Cloudflare-Konto keine Domain. Die Domain muss bei Cloudflare liegen und das Token muss sie lesen dürfen (Zone · Zone · Lesen)."
  ok "Domain gefunden: $ZONE_NAME"
  [[ "$ZONE_STATUS" == active ]] || warn "Die Domain ist bei Cloudflare noch nicht aktiv (Status: $ZONE_STATUS). Solange die Nameserver nicht umgestellt sind, ist die Website nicht erreichbar."
  local site_zone="$ZONE_ID" site_account="$ACCOUNT_ID" below_zone="${SITE_DOMAIN%"$ZONE_NAME"}"
  below_zone="${below_zone%.}"
  if [[ "$below_zone" == *.* ]]; then
    warn "$SITE_DOMAIN liegt zwei Ebenen unter $ZONE_NAME. Dafür stellt Cloudflare kein kostenloses Zertifikat aus —"
    warn "nimm lieber eine Adresse direkt unter der Domain (z. B. hosting.$ZONE_NAME)."
  fi

  cf_find_zone "$SERVER_DOMAIN"
  [[ -n "$ZONE_ID" ]] || die "Zu $SERVER_DOMAIN gibt es in diesem Cloudflare-Konto keine Domain."
  CLOUDFLARE_ZONE_ID="$ZONE_ID"
  [[ "$NODE_HOST" == "$ZONE_NAME" || "$NODE_HOST" == *".$ZONE_NAME" ]] ||
    die "$NODE_HOST gehört nicht zur Domain $ZONE_NAME. Die Adresse des Servers muss in derselben Domain liegen wie die Welten — mit AM_NODE_HOST=<Adresse> angeben oder NODE_HOST in .env ändern."

  # ── Website: über Cloudflare (orange Wolke), damit dessen Schutz davor liegt ──
  cf_dns_upsert A "$SITE_DOMAIN" "$PUBLIC_IP" true "$site_zone"
  SITE_PROXIED="$DNS_PROXIED"

  # Dieser Server verträgt die Cloudflare-Modi 'Flexible' und 'Full' ohne weiteres Zutun. Nur
  # 'Full (strict)' verlangt ein öffentlich gültiges Zertifikat — dann holt Caddy eines von Let's Encrypt.
  # Geändert wird der Modus hier nicht: Er gilt für die ganze Domain und damit auch für andere Seiten darauf.
  if response="$(cf_try GET "/zones/$site_zone/settings/ssl")"; then
    if [[ "$(jq -r '.result.value // empty' <<<"$response")" == strict && "$CADDY_TLS" == internal ]]; then
      CADDY_TLS="$ADMIN_EMAIL"
      note "Cloudflare steht auf 'Full (strict)' — Caddy holt deshalb ein Zertifikat von Let's Encrypt."
    fi
  elif [[ "$CADDY_TLS" == internal ]]; then
    note "Der SSL-Modus der Domain ließ sich nicht lesen (dem Token fehlt Zone · Zoneneinstellungen · Lesen)."
    note "Mit 'Flexible' oder 'Full' läuft alles. Steht er auf 'Full (strict)', in .env CADDY_TLS=<deine E-Mail> setzen."
  fi

  # ── Minecraft: Adresse dieses Servers, ohne Cloudflare-Proxy (der leitet nur Webseiten durch) ──
  cf_dns_upsert A "$NODE_HOST" "$PUBLIC_IP" false "$CLOUDFLARE_ZONE_ID"
  note "Welten bekommen beim Anlegen automatisch einen SRV-Eintrag unter $SERVER_DOMAIN, der auf $NODE_HOST zeigt."

  # ── Turnstile ──
  if [[ -n "$TURNSTILE_SITE_KEY" && -n "$TURNSTILE_SECRET_KEY" ]]; then
    ok "Turnstile-Schlüssel aus der vorhandenen .env werden weiterverwendet"
    # Ein Widget gilt nur für die Adressen, die bei ihm eingetragen sind. Hat sich die Adresse der
    # Website geändert, muss sie dazu — sonst lehnt Turnstile dort jede Prüfung ab.
    if widget="$(cf_try GET "/accounts/$site_account/challenges/widgets/$TURNSTILE_SITE_KEY")"; then
      if [[ "$(jq -r --arg host "$SITE_DOMAIN" '[.result.domains[]? | select(. == $host)] | length' <<<"$widget")" -eq 0 ]]; then
        if cf_try PUT "/accounts/$site_account/challenges/widgets/$TURNSTILE_SITE_KEY" "$(jq -c --arg host "$SITE_DOMAIN" \
          '{name: .result.name, mode: .result.mode, domains: ((.result.domains // []) + [$host])}' <<<"$widget")" >/dev/null; then
          ok "Turnstile-Widget um $SITE_DOMAIN ergänzt"
        else
          warn "Das Turnstile-Widget gilt noch nicht für $SITE_DOMAIN. Trage die Adresse im Cloudflare-Dashboard unter Turnstile beim Widget ein."
        fi
      fi
    else
      note "Das Widget ließ sich nicht prüfen. Achte darauf, dass $SITE_DOMAIN bei ihm eingetragen ist."
    fi
  else
    # Turnstile lässt sich nur mit einem persönlichen Token anlegen (nicht mit einem Konto-Token) und
    # braucht die Berechtigung Konto · Turnstile · Bearbeiten. Klappt es nicht, wird nach den Schlüsseln gefragt.
    if widget="$(cf_try POST "/accounts/$site_account/challenges/widgets" "$(jq -n --arg name "$WIDGET_NAME" --arg domain "$SITE_DOMAIN" \
      '{name: $name, domains: [$domain], mode: "managed"}')")"; then
      TURNSTILE_SITE_KEY="$(jq -r '.result.sitekey // empty' <<<"$widget")"
      TURNSTILE_SECRET_KEY="$(jq -r '.result.secret // empty' <<<"$widget")"
    fi
    if [[ -n "$TURNSTILE_SITE_KEY" && -n "$TURNSTILE_SECRET_KEY" ]]; then
      ok "Turnstile-Widget angelegt"
    else
      TURNSTILE_SITE_KEY='' TURNSTILE_SECRET_KEY=''
      warn "Das Turnstile-Widget ließ sich mit diesem Token nicht anlegen (fehlt die Berechtigung Konto · Turnstile · Bearbeiten?)."
      note "Lege es von Hand an: Cloudflare-Dashboard → Turnstile → Widget hinzufügen → Domain $SITE_DOMAIN."
      ask TURNSTILE_SITE_KEY "Turnstile Site Key" ''
      ask_secret TURNSTILE_SECRET_KEY "Turnstile Secret Key"
      [[ -n "$TURNSTILE_SITE_KEY" && -n "$TURNSTILE_SECRET_KEY" ]] || die "Ohne Turnstile-Schlüssel gäbe es keine Sicherheitsprüfung."
    fi
  fi
}

# ─────────────────────────── Ablauf ───────────────────────────

main() {
  printf '%saboutm.ee Hosting — Installation%s\n' "$BOLD" "$RESET"

  [[ "$(id -u)" -eq 0 ]] || die "Bitte mit Root-Rechten starten: sudo ./install.sh"
  command -v apt-get >/dev/null || die "Dieses Skript unterstützt Debian und Ubuntu. Auf anderen Systemen bitte nach README von Hand einrichten."

  WORK_DIR="$(mktemp -d)"
  chmod 700 "$WORK_DIR"

  # ── 1. Grundausstattung ──
  step "Pakete installieren"
  export DEBIAN_FRONTEND=noninteractive
  local -a missing=()
  local tool
  for tool in curl git jq openssl; do command -v "$tool" >/dev/null || missing+=("$tool"); done
  if ((${#missing[@]})); then
    apt-get update -qq
    apt-get install -y -qq ca-certificates "${missing[@]}" >/dev/null
  fi
  ok "curl, git, jq, openssl vorhanden"

  if ! command -v docker >/dev/null; then
    note "Docker wird installiert (offizielles Installationsskript von get.docker.com) …"
    curl -fsSL https://get.docker.com -o "$WORK_DIR/get-docker.sh"
    sh "$WORK_DIR/get-docker.sh" >/dev/null
  fi
  docker compose version >/dev/null 2>&1 || die "Docker Compose fehlt. Bitte Docker aktualisieren (Paket docker-compose-plugin)."
  if command -v systemctl >/dev/null && [[ -d /run/systemd/system ]]; then systemctl enable --now docker >/dev/null 2>&1 || true; fi
  docker info >/dev/null 2>&1 || die "Docker läuft nicht. Prüfe: systemctl status docker"
  ok "Docker läuft"

  # ── 2. Programmdateien ──
  step "Programmdateien"
  # Nur wenn das Skript als Datei aus seinem eigenen Ordner gestartet wurde, ist das die Installation.
  # Kommt es per Pipe (curl … | bash), sagt der aktuelle Ordner nichts — er könnte ein fremdes Projekt sein.
  local script_dir='' script_file="${BASH_SOURCE[0]:-}"
  if [[ -n "$script_file" && -f "$script_file" ]]; then
    script_dir="$(cd "$(dirname "$script_file")" 2>/dev/null && pwd || true)"
  fi
  if [[ -n "$script_dir" && -f "$script_dir/docker-compose.yml" && -f "$script_dir/scripts/make-admin.mjs" ]]; then
    INSTALL_DIR="$script_dir"
    ok "Verwende die Dateien in $INSTALL_DIR"
  elif [[ -d "$INSTALL_DIR/.git" ]]; then
    git -C "$INSTALL_DIR" pull --ff-only --quiet || warn "Aktualisieren per git pull hat nicht geklappt — es wird der vorhandene Stand verwendet."
    ok "Vorhandene Installation in $INSTALL_DIR"
  else
    local -a clone=(git clone --quiet)
    [[ -n "${AM_BRANCH:-}" ]] && clone+=(--branch "$AM_BRANCH")
    "${clone[@]}" "$REPO_URL" "$INSTALL_DIR" ||
      die "Das Repository ließ sich nicht laden. Ist es privat, dann zuerst selbst klonen und ./install.sh aus dem Ordner starten."
    [[ -f "$INSTALL_DIR/docker-compose.yml" ]] || die "Im geladenen Stand fehlt docker-compose.yml. Den richtigen Zweig mit AM_BRANCH=<name> angeben."
    ok "Nach $INSTALL_DIR geladen"
  fi
  cd "$INSTALL_DIR"
  local env_file="$INSTALL_DIR/.env"

  # ── 3. Angaben ──
  step "Ein paar Angaben"
  SITE_DOMAIN="${AM_SITE_DOMAIN:-}"
  [[ -n "$SITE_DOMAIN" ]] || ask SITE_DOMAIN "Unter welcher Adresse soll die Website laufen? (z. B. aboutm.ee oder hosting.aboutm.ee)" "$(env_value "$env_file" SITE_DOMAIN)"
  SITE_DOMAIN="${SITE_DOMAIN,,}"
  is_domain "$SITE_DOMAIN" || die "'$SITE_DOMAIN' ist keine gültige Adresse (ohne https:// und ohne Schrägstrich)."

  SERVER_DOMAIN="${AM_SERVER_DOMAIN:-}"
  if [[ -z "$SERVER_DOMAIN" ]]; then
    note "Welten bekommen Adressen wie mc-abc123.<Domain>."
    local server_default
    server_default="$(env_value "$env_file" SERVER_DOMAIN)"
    ask SERVER_DOMAIN "Unter welcher Domain sollen die Welten erreichbar sein?" "${server_default:-$SITE_DOMAIN}"
  fi
  SERVER_DOMAIN="${SERVER_DOMAIN,,}"
  is_domain "$SERVER_DOMAIN" || die "'$SERVER_DOMAIN' ist keine gültige Domain."

  # Adresse dieses Servers für Minecraft-Verbindungen. Auf sie zeigen die SRV-Einträge der Welten.
  local stored_server stored_node
  stored_server="$(env_value "$env_file" SERVER_DOMAIN)"
  stored_node="$(env_value "$env_file" NODE_HOST)"
  # Wurde die Domain der Welten geändert, zieht die Standard-Adresse des Servers mit um.
  if [[ -n "$stored_server" && "$stored_server" != "$SERVER_DOMAIN" && "$stored_node" == "node.$stored_server" ]]; then stored_node=''; fi
  NODE_HOST="${AM_NODE_HOST:-$stored_node}"
  NODE_HOST="${NODE_HOST:-node.$SERVER_DOMAIN}"
  NODE_HOST="${NODE_HOST,,}"
  is_domain "$NODE_HOST" || die "'$NODE_HOST' ist kein gültiger Hostname."
  [[ "$NODE_HOST" != "$SITE_DOMAIN" ]] || die "Die Adresse des Servers ($NODE_HOST) darf nicht dieselbe sein wie die der Website — die Website läuft über Cloudflare, Minecraft nicht."
  if [[ -n "$stored_server" && "$stored_server" != "$SERVER_DOMAIN" ]]; then
    warn "Die Domain der Welten ändert sich von $stored_server auf $SERVER_DOMAIN. Bestehende Welten bekommen neue Adressen;"
    warn "die Website legt ihre SRV-Einträge neu an und entfernt die alten."
  fi

  PORT_MIN="${AM_PORT_MIN:-$(env_value "$env_file" MC_PORT_MIN)}"
  PORT_MAX="${AM_PORT_MAX:-$(env_value "$env_file" MC_PORT_MAX)}"
  PORT_MIN="${PORT_MIN:-25600}"
  PORT_MAX="${PORT_MAX:-26599}"
  if ! [[ "$PORT_MIN" =~ ^[0-9]+$ && "$PORT_MAX" =~ ^[0-9]+$ ]] || ((PORT_MIN < 1024 || PORT_MAX > 65535 || PORT_MIN > PORT_MAX)); then
    die "Der Portbereich für Welten ist ungültig ($PORT_MIN–$PORT_MAX)."
  fi

  ADMIN_EMAIL="${AM_ADMIN_EMAIL:-}"
  [[ -n "$ADMIN_EMAIL" ]] || ask ADMIN_EMAIL "Deine E-Mail-Adresse für das Admin-Konto" ''
  ADMIN_EMAIL="${ADMIN_EMAIL,,}"
  is_email "$ADMIN_EMAIL" || die "'$ADMIN_EMAIL' ist keine gültige E-Mail-Adresse."

  DATA_PATH="${AM_DATA_PATH:-$(env_value "$env_file" DATA_PATH)}"
  DATA_PATH="${DATA_PATH:-/srv/aboutmee/data}"
  [[ "$DATA_PATH" == /* ]] || die "DATA_PATH muss ein absoluter Pfad sein."

  # internal = Caddy erzeugt sein Zertifikat selbst (passt hinter Cloudflare); eine E-Mail-Adresse = Let's Encrypt
  CADDY_TLS="${AM_CADDY_TLS:-$(env_value "$env_file" CADDY_TLS)}"
  CADDY_TLS="${CADDY_TLS:-internal}"

  TURNSTILE_SITE_KEY="${AM_TURNSTILE_SITE_KEY:-$(env_value "$env_file" TURNSTILE_SITE_KEY)}"
  TURNSTILE_SECRET_KEY="${AM_TURNSTILE_SECRET_KEY:-$(env_value "$env_file" TURNSTILE_SECRET_KEY)}"

  # Das API-Token bleibt auf dem Server gespeichert: Die Website legt damit für jede neue Welt einen
  # SRV-Eintrag an. Bei einem erneuten Lauf wird das gespeicherte Token weiterverwendet.
  local cf_token="${AM_CF_API_TOKEN:-}" token_stored=0
  if [[ -z "$cf_token" ]]; then
    cf_token="$(env_value "$env_file" CLOUDFLARE_API_TOKEN)"
    [[ -z "$cf_token" ]] || token_stored=1
  fi
  if [[ -z "$cf_token" && "${AM_YES:-}" != 1 ]]; then
    printf '\n  Mit einem Cloudflare-API-Token richtet das Skript DNS und Sicherheitsprüfung selbst ein, und die Website\n'
    printf '  legt später für jede neue Welt automatisch einen SRV-Eintrag an. Das Token wird dafür auf diesem Server\n'
    printf '  gespeichert (in .env, nur für root lesbar).\n\n'
    printf '  Token anlegen: Cloudflare-Dashboard → Mein Profil → API-Token → Token erstellen → Benutzerdefiniert, mit:\n'
    printf '    Zone   · DNS               · Bearbeiten   (für deine Domain)\n'
    printf '    Zone   · Zone              · Lesen        (für deine Domain)\n'
    printf '    Zone   · Zoneneinstellungen · Lesen       (für deine Domain; optional — erkennt den SSL-Modus)\n'
    printf '    Konto  · Turnstile         · Bearbeiten\n'
    ask_secret cf_token "API-Token einfügen (Eingabe bleibt unsichtbar; leer lassen, um alles von Hand einzutragen)"
  fi

  # ── 4. Öffentliche IP ──
  PUBLIC_IP="${AM_PUBLIC_IP:-}"
  if [[ -z "$PUBLIC_IP" ]]; then
    PUBLIC_IP="$(curl -4 -fsS --max-time 10 https://cloudflare.com/cdn-cgi/trace 2>/dev/null | sed -n 's/^ip=//p' || true)"
  fi
  [[ "$PUBLIC_IP" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || die "Die öffentliche IPv4-Adresse dieses Servers ließ sich nicht ermitteln. Mit AM_PUBLIC_IP=<Adresse> angeben."
  ok "Öffentliche Adresse dieses Servers: $PUBLIC_IP"

  # ── 5. Cloudflare ──
  if [[ -n "$cf_token" ]]; then
    CF_HEADERS="$WORK_DIR/cf-headers"
    (umask 077 && printf 'Authorization: Bearer %s\n' "$cf_token" >"$CF_HEADERS")
    local stored_zone
    stored_zone="$(env_value "$env_file" CLOUDFLARE_ZONE_ID)"
    # Erneuter Lauf mit dem gespeicherten Token: Es kann bewusst knapper gehalten sein (nur DNS bearbeiten) oder
    # inzwischen ersetzt worden sein. Hat sich an den Adressen nichts geändert, ist dann nichts einzurichten —
    # die Aktualisierung soll daran nicht scheitern.
    local unchanged=0 visible=0
    if ((token_stored)) && [[ -n "$stored_zone" && -n "$TURNSTILE_SITE_KEY" && -n "$TURNSTILE_SECRET_KEY" &&
      "$(env_value "$env_file" SITE_DOMAIN)" == "$SITE_DOMAIN" && "$stored_server" == "$SERVER_DOMAIN" &&
      "$(env_value "$env_file" NODE_HOST)" == "$NODE_HOST" ]]; then
      unchanged=1
      cf_zone_visible "$SITE_DOMAIN" || visible=$?
      if ((visible == 0)); then cf_zone_visible "$SERVER_DOMAIN" || visible=$?; fi
    fi
    if ((unchanged && visible != 0)); then
      step "Cloudflare"
      if ((visible == 1)); then
        warn "Das gespeicherte API-Token darf die Domain nicht (mehr) lesen — die Cloudflare-Einrichtung wird übersprungen."
        note "Um sie neu einzurichten: AM_CF_API_TOKEN=<Token mit allen Rechten> sudo -E ./install.sh"
      else
        warn "Cloudflare ist gerade nicht erreichbar — die Cloudflare-Einrichtung wird übersprungen."
        note "Hat sich etwas geändert (z. B. die IP-Adresse des Servers), das Skript später noch einmal starten."
      fi
      note "DNS-Einträge, Turnstile und die übrigen Einstellungen bleiben, wie sie sind."
      CLOUDFLARE_ZONE_ID="$stored_zone"
      SITE_PROXIED="$(detect_site_proxied)"
    else
      cloudflare_setup
      # Wurde für diesen Lauf ein anderes Token mitgegeben als das gespeicherte, und reicht das gespeicherte
      # (engere) für die Arbeit der Website weiter aus, bleibt es in der .env.
      local stored_token
      stored_token="$(env_value "$env_file" CLOUDFLARE_API_TOKEN)"
      if [[ -n "$stored_token" && "$stored_token" != "$cf_token" ]]; then
        (umask 077 && printf 'Authorization: Bearer %s\n' "$stored_token" >"$CF_HEADERS")
        if cf_try GET "/zones/$CLOUDFLARE_ZONE_ID/dns_records?per_page=1" >/dev/null; then
          cf_token="$stored_token"
          note "Das bisher gespeicherte Token bleibt in der .env — das mitgegebene wurde nur für diesen Lauf benutzt."
        else
          note "Das mitgegebene Token ersetzt das bisher gespeicherte in der .env (das alte funktioniert für diese Domain nicht mehr)."
        fi
      fi
    fi
  else
    step "Cloudflare von Hand"
    if [[ -z "$TURNSTILE_SITE_KEY" || -z "$TURNSTILE_SECRET_KEY" ]]; then
      note "Cloudflare-Dashboard → Turnstile → Widget hinzufügen → Domain $SITE_DOMAIN eintragen."
      ask TURNSTILE_SITE_KEY "Turnstile Site Key" ''
      ask_secret TURNSTILE_SECRET_KEY "Turnstile Secret Key"
    fi
    [[ -n "$TURNSTILE_SITE_KEY" && -n "$TURNSTILE_SECRET_KEY" ]] || die "Ohne Turnstile-Schlüssel gäbe es keine Sicherheitsprüfung. Bitte beide Schlüssel angeben."
    warn "Ohne API-Token bitte selbst eintragen:"
    warn "  $SITE_DOMAIN  →  A  $PUBLIC_IP  (mit Cloudflare-Proxy, orange Wolke)"
    warn "  $NODE_HOST  →  A  $PUBLIC_IP  (nur DNS, graue Wolke)"
    warn "Welten haben dann keine eigene Adresse; Spieler verbinden sich über $NODE_HOST:<Port>."
    SITE_PROXIED="$(detect_site_proxied)"
  fi

  # ── 6. Einstellungen schreiben ──
  step "Einstellungen speichern"
  mkdir -p "$DATA_PATH"
  local total_slots auto_pause mc_cpus support_email
  total_slots="$(env_value "$env_file" TOTAL_SLOTS)"
  auto_pause="$(env_value "$env_file" AUTO_PAUSE_MINUTES)"
  mc_cpus="$(env_value "$env_file" MC_CPUS)"
  support_email="$(env_value "$env_file" SUPPORT_EMAIL)"
  local extras=''
  if [[ -f "$env_file" ]]; then
    extras="$(env_extras "$env_file")"
    cp -p "$env_file" "$env_file.bak"
    chmod 600 "$env_file.bak" # enthält dieselben Geheimnisse wie die .env
  fi
  # Ohne Zone kann die Website keine Einträge anlegen — dann das Token gar nicht erst ablegen.
  [[ -n "$CLOUDFLARE_ZONE_ID" ]] || cf_token=''

  # Läuft die Website über den Cloudflare-Proxy, nimmt Caddy nur Anfragen von Cloudflare an. Sonst ließe
  # sich der Schutz von Cloudflare umgehen, indem man den Server direkt anspricht — seine Adresse ist über
  # die Minecraft-Adresse ja bekannt.
  local cf_ranges origin_allow
  cf_ranges="$(cloudflare_ranges)"
  case "$SITE_PROXIED" in
  true) origin_allow="$cf_ranges" ;;
  false) origin_allow='' ;;
  *)
    # Nicht feststellbar: die bisherige Einstellung bleibt. Stammt sie von diesem Skript (dieselbe Liste wie
    # CLOUDFLARE_IPS), wird sie aufgefrischt — eine von Hand gepflegte bleibt unangetastet.
    origin_allow="$(env_value "$env_file" ORIGIN_ALLOW)"
    if [[ -n "$origin_allow" && "$origin_allow" == "$(env_value "$env_file" CLOUDFLARE_IPS)" ]]; then origin_allow="$cf_ranges"; fi
    ;;
  esac
  [[ -z "${AM_ORIGIN_ALLOW+x}" ]] || origin_allow="$AM_ORIGIN_ALLOW"
  (
    umask 077
    cat >"$env_file" <<EOF
# Von install.sh geschrieben. Erneutes Ausführen behält diese Werte und alle eigenen Zeilen bei.
SITE_DOMAIN=$SITE_DOMAIN
SITE_URL=https://$SITE_DOMAIN
SERVER_DOMAIN=$SERVER_DOMAIN

# Adresse dieses Servers für Minecraft und der Portbereich, aus dem jede Welt ihren Port bekommt
NODE_HOST=$NODE_HOST
MC_PORT_MIN=$PORT_MIN
MC_PORT_MAX=$PORT_MAX

# Cloudflare-Zugang, mit dem die Website je Welt einen SRV-Eintrag anlegt und wieder löscht
CLOUDFLARE_API_TOKEN=$cf_token
CLOUDFLARE_ZONE_ID=$CLOUDFLARE_ZONE_ID

TURNSTILE_SITE_KEY=$TURNSTILE_SITE_KEY
TURNSTILE_SECRET_KEY=$TURNSTILE_SECRET_KEY

# Zertifikat des Servers: internal (hinter Cloudflare) oder eine E-Mail-Adresse für Let's Encrypt
CADDY_TLS=$CADDY_TLS
# Wer die Website auf diesem Server direkt ansprechen darf (leer = jeder) und wem die Besucheradresse
# geglaubt wird: die Adressbereiche von Cloudflare. Wird bei jedem Lauf von install.sh aufgefrischt.
ORIGIN_ALLOW="$origin_allow"
CLOUDFLARE_IPS="$cf_ranges"

DATA_PATH=$DATA_PATH
TOTAL_SLOTS=${total_slots:-20}
AUTO_PAUSE_MINUTES=${auto_pause:-30}
MC_CPUS=${mc_cpus:-2}
SUPPORT_EMAIL=${support_email:-}
EOF
    if [[ -n "$extras" ]]; then
      printf '\n# Weitere Einstellungen — aus der bisherigen .env übernommen\n%s\n' "$extras" >>"$env_file"
    fi
  )
  chmod 600 "$env_file"
  ok ".env geschrieben (nur für root lesbar)"

  # ── 7. Firewall ──
  if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q '^Status: active'; then
    step "Firewall"
    ufw allow 80/tcp >/dev/null
    ufw allow 443/tcp >/dev/null
    ok "Ports 80 und 443 (Website) geöffnet"
    ufw allow "$PORT_MIN:$PORT_MAX/tcp" >/dev/null
    ok "Ports $PORT_MIN–$PORT_MAX (Minecraft-Welten) geöffnet"
  else
    note "Keine aktive ufw-Firewall gefunden. Falls dein Anbieter eine eigene Firewall hat, dort freigeben: 80 und 443 (Website) sowie $PORT_MIN–$PORT_MAX/TCP (Minecraft-Welten)."
  fi

  # ── 8. Starten ──
  step "Website bauen und starten (das dauert beim ersten Mal ein paar Minuten)"
  # Dienste aus früheren Ständen (Tunnel, Minecraft-Router) abräumen — sie werden nicht mehr gebraucht.
  docker rm --force "$(basename "$INSTALL_DIR" | tr '[:upper:]' '[:lower:]')-tunnel-1" "$(basename "$INSTALL_DIR" | tr '[:upper:]' '[:lower:]')-router-1" >/dev/null 2>&1 || true
  # Das frühere gemeinsame Netz der Welten: verschwindet, sobald keine alte Welt mehr daran hängt.
  docker network rm aboutmee-mc >/dev/null 2>&1 || true
  # Erst nur die Website starten — noch ohne Caddy. So ist die Seite von außen nicht erreichbar, bis das
  # Admin-Konto steht, und niemand kann sich vorher unter deiner Adresse registrieren.
  docker compose up -d --build web
  local waited=0
  until docker compose exec -T web node -e "fetch('http://127.0.0.1:3000/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; do
    waited=$((waited + 3))
    ((waited < 180)) || die "Die Website antwortet nicht. Logs ansehen: docker compose logs web"
    sleep 3
  done
  ok "Website läuft (noch nicht öffentlich)"

  # ── 9. Admin-Konto ──
  step "Admin-Konto"
  local admin_password="${AM_ADMIN_PASSWORD:-}" generated=0 admin_output admin_state
  admin_state="$(docker compose exec -T web node scripts/make-admin.mjs "$ADMIN_EMAIL" --status)" ||
    die "Der Stand des Admin-Kontos ließ sich nicht abfragen."
  if [[ "$admin_state" == konto ]]; then
    # Ein gewöhnliches Konto mit dieser Adresse gibt es schon. Adressen werden bei der Registrierung nicht
    # bestätigt — es könnte also auch jemand anderes angelegt haben.
    warn "Unter $ADMIN_EMAIL gibt es schon ein Konto ohne Admin-Rechte."
    confirm "Ist das dein Konto? Dann bekommt es jetzt Admin-Rechte (das Passwort bleibt, wie es ist)." ||
      die "Admin-Rechte nicht vergeben. Starte das Skript mit einer anderen E-Mail-Adresse, oder lösche das Konto zuerst."
  fi
  if [[ -z "$admin_password" ]]; then
    admin_password="$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-20)"
    generated=1
  fi
  admin_output="$(ADMIN_PASSWORD="$admin_password" docker compose exec -T -e ADMIN_PASSWORD web node scripts/make-admin.mjs "$ADMIN_EMAIL")" ||
    die "Das Admin-Konto ließ sich nicht anlegen."
  ok "$admin_output"

  # ── 10. Öffentlich schalten ──
  step "Website öffentlich schalten"
  docker compose up -d --remove-orphans
  ok "Caddy gestartet"
  if [[ -n "$origin_allow" && "$origin_allow" == "$cf_ranges" ]]; then
    note "Die Website nimmt nur Anfragen an, die über Cloudflare kommen — ein direkter Aufruf über die IP-Adresse bleibt ohne Antwort."
  elif [[ -n "$origin_allow" ]]; then
    note "Die Website nimmt nur Anfragen aus den Adressbereichen an, die in ORIGIN_ALLOW stehen."
  elif [[ "$SITE_PROXIED" != false ]]; then
    warn "Der Server nimmt auch Anfragen an, die nicht über Cloudflare kommen (ORIGIN_ALLOW ist leer) — es ließ sich nicht"
    warn "feststellen, ob die Website schon über den Cloudflare-Proxy läuft. Sobald der DNS-Eintrag mit oranger Wolke steht,"
    warn "das Skript noch einmal starten: Dann wird der direkte Zugriff gesperrt."
  fi
  # Von außen nachsehen, ob die Seite wirklich ankommt — und bei den üblichen Stolpersteinen sagen, woran es liegt.
  local code='' tries=0
  while ((tries < 6)); do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "https://$SITE_DOMAIN/login" 2>/dev/null || true)"
    [[ "$code" != 200 ]] || break
    tries=$((tries + 1))
    sleep 5
  done
  case "$code" in
  200) ok "https://$SITE_DOMAIN ist erreichbar" ;;
  526)
    warn "Cloudflare lehnt das Zertifikat dieses Servers ab (Fehler 526): Die Domain steht auf 'Full (strict)'."
    warn "Entweder im Cloudflare-Dashboard unter SSL/TLS auf 'Full' stellen, oder in .env CADDY_TLS=$ADMIN_EMAIL setzen und: docker compose up -d"
    ;;
  521 | 522 | 523)
    warn "Cloudflare erreicht diesen Server nicht (Fehler $code). Sind die Ports 80 und 443 in der Firewall deines Anbieters offen?"
    ;;
  *)
    note "https://$SITE_DOMAIN antwortet von hier aus noch nicht (Antwort: ${code:-keine}). Neue DNS-Einträge brauchen oft ein paar Minuten —"
    note "probier es gleich im Browser. Bleibt es dabei: docker compose logs caddy"
    ;;
  esac

  step "Minecraft-Images vorab laden (damit der erste Start einer Welt schnell geht)"
  local image
  for image in itzg/minecraft-server:java25 itzg/minecraft-server:java21; do
    if docker pull --quiet "$image" >/dev/null; then ok "$image"; else warn "$image ließ sich nicht laden — wird beim ersten Start nachgeholt."; fi
  done

  # ── Fertig ──
  printf '\n%s%s✓ Fertig.%s\n\n' "$BOLD" "$GREEN" "$RESET"
  printf '  Website:      https://%s\n' "$SITE_DOMAIN"
  printf '  Admin:        https://%s/admin\n' "$SITE_DOMAIN"
  printf '  Anmelden mit: %s\n' "$ADMIN_EMAIL"
  if [[ "$admin_output" == *angelegt* ]]; then
    if ((generated)); then
      printf '  Passwort:     %s%s%s   ← jetzt notieren, es wird nicht noch einmal angezeigt\n' "$BOLD" "$admin_password" "$RESET"
    else
      printf '  Passwort:     das von dir angegebene\n'
    fi
  else
    printf '  Passwort:     dein bisheriges (das Konto gab es schon)\n'
  fi
  if [[ -n "$cf_token" ]]; then
    printf '  Welten:       mc-….%s — jede bekommt automatisch ihren SRV-Eintrag\n\n' "$SERVER_DOMAIN"
  else
    printf '  Welten:       %s:<Port>\n\n' "$NODE_HOST"
  fi
  printf '  Noch zu tun:\n'
  printf '   • Impressum ausfüllen: https://%s/admin/impressum (Name, Anschrift, E-Mail)\n' "$SITE_DOMAIN"
  printf '   • Datenschutzerklärung prüfen und die markierten Stellen ergänzen (app/(site)/datenschutz), danach: docker compose up -d --build\n'
  printf '   • Eigene Bilder hochladen: https://%s/admin/bilder\n' "$SITE_DOMAIN"
  printf '   • Den Ordner %s regelmäßig extern sichern\n\n' "$DATA_PATH"
  printf '  Aktualisieren: cd %s && git pull && sudo ./install.sh\n' "$INSTALL_DIR"
}

# Zum Testen einzelner Funktionen lässt sich das Skript mit AM_SOURCE_ONLY=1 einlesen, ohne dass es losläuft.
[[ "${AM_SOURCE_ONLY:-}" == 1 ]] || main "$@"
