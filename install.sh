#!/usr/bin/env bash
#
# aboutm.ee Hosting — Installation auf einem frischen Debian- oder Ubuntu-Server.
#
#   sudo ./install.sh
#
# Das Skript installiert Docker, richtet Cloudflare ein (Tunnel für die Website, DNS für die
# Minecraft-Adressen, Turnstile-Schlüssel), startet alles und legt dein Admin-Konto an.
# Es lässt sich gefahrlos erneut ausführen: Vorhandenes wird wiederverwendet, nicht doppelt angelegt.
#
# Ohne Rückfragen (z. B. für Automatisierung) über Umgebungsvariablen:
#   AM_SITE_DOMAIN, AM_SERVER_DOMAIN, AM_ADMIN_EMAIL, AM_ADMIN_PASSWORD, AM_MODE (tunnel|caddy),
#   AM_CF_API_TOKEN  oder  AM_TURNSTILE_SITE_KEY + AM_TURNSTILE_SECRET_KEY (+ AM_TUNNEL_TOKEN),
#   AM_PUBLIC_IP, AM_DATA_PATH, AM_YES=1

set -Eeuo pipefail

REPO_URL="${AM_REPO_URL:-https://github.com/PwiePixel/aboutm.ee-Hosting.git}"
INSTALL_DIR="${AM_INSTALL_DIR:-/opt/aboutmee}"
CF_API="${AM_CF_API_BASE:-https://api.cloudflare.com/client/v4}"
TUNNEL_NAME="${AM_TUNNEL_NAME:-aboutmee}"
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
MANAGED_KEYS='SITE_DOMAIN SITE_URL SERVER_DOMAIN COMPOSE_PROFILES TUNNEL_TOKEN CLIENT_IP_HEADER TURNSTILE_SITE_KEY TURNSTILE_SECRET_KEY DATA_PATH TOTAL_SLOTS AUTO_PAUSE_MINUTES MC_CPUS SUPPORT_EMAIL'

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
TUNNEL_STATUS_PATH=''

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

# Legt einen DNS-Eintrag an oder aktualisiert ihn. Fragt nach, bevor ein fremder Eintrag ersetzt wird.
cf_dns_upsert() { # cf_dns_upsert <Typ> <Name> <Ziel> <proxied true|false> <Zone>
  local type="$1" name="$2" content="$3" proxied="$4" zone="$5" existing id current current_type body
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
  if [[ "$(jq 'length' <<<"$existing")" -eq 1 && "$current_type" == "$type" && "$current" == "$content" &&
    "$(jq -r '.[0].proxied' <<<"$existing")" == "$proxied" ]]; then
    ok "DNS: $name zeigt schon auf $content"
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

# Richtet Tunnel, DNS und Turnstile über die API ein. Setzt TUNNEL_TOKEN, TURNSTILE_SITE_KEY, TURNSTILE_SECRET_KEY.
cloudflare_setup() {
  local response tunnel_id widget
  step "Cloudflare einrichten"

  # Persönliche Tokens lassen sich so vorab prüfen. Konto-Tokens kennen diesen Aufruf nicht —
  # bei ihnen zeigt erst die Suche nach der Domain, ob das Token taugt.
  if response="$(cf_try GET '/user/tokens/verify')"; then
    [[ "$(jq -r '.result.status' <<<"$response")" == active ]] || die "Das API-Token ist nicht aktiv."
    ok "API-Token ist gültig"
  fi

  cf_find_zone "$SITE_DOMAIN"
  [[ -n "$ZONE_ID" ]] || die "Zu $SITE_DOMAIN gibt es in diesem Cloudflare-Konto keine Domain. Die Domain muss bei Cloudflare liegen und das Token muss sie lesen dürfen (Zone · Zone · Lesen)."
  ok "Domain gefunden: $ZONE_NAME"
  [[ "$ZONE_STATUS" == active ]] || warn "Die Domain ist bei Cloudflare noch nicht aktiv (Status: $ZONE_STATUS). Solange die Nameserver nicht umgestellt sind, ist die Website nicht erreichbar."
  local site_zone="$ZONE_ID" below_zone="${SITE_DOMAIN%"$ZONE_NAME"}"
  below_zone="${below_zone%.}"
  if [[ "$below_zone" == *.* ]]; then
    warn "$SITE_DOMAIN liegt zwei Ebenen unter $ZONE_NAME. Dafür stellt Cloudflare kein kostenloses Zertifikat aus —"
    warn "nimm lieber eine Adresse direkt unter der Domain (z. B. hosting.$ZONE_NAME)."
  fi

  # ── Tunnel für die Website ──
  if [[ "$MODE" == tunnel ]]; then
    response="$(cf GET "/accounts/$ACCOUNT_ID/cfd_tunnel?name=$TUNNEL_NAME&is_deleted=false")"
    # Der Namensfilter der API kann auch ähnliche Namen liefern — deshalb hier genau vergleichen.
    tunnel_id="$(jq -r --arg name "$TUNNEL_NAME" '[.result[] | select(.name == $name and .deleted_at == null)][0].id // empty' <<<"$response")"
    if [[ -z "$tunnel_id" ]]; then
      response="$(cf POST "/accounts/$ACCOUNT_ID/cfd_tunnel" "$(jq -n --arg name "$TUNNEL_NAME" '{name: $name, config_src: "cloudflare"}')")"
      tunnel_id="$(jq -r '.result.id' <<<"$response")"
      ok "Tunnel '$TUNNEL_NAME' angelegt"
    else
      ok "Tunnel '$TUNNEL_NAME' gibt es schon — wird weiterverwendet"
    fi
    # Der Aufruf ersetzt die gesamte Weiterleitung des Tunnels. Leitet er schon andere Adressen weiter,
    # gehört er vielleicht zu etwas anderem — dann erst fragen.
    local other_hosts=''
    if response="$(cf_try GET "/accounts/$ACCOUNT_ID/cfd_tunnel/$tunnel_id/configurations")"; then
      other_hosts="$(jq -r --arg host "$SITE_DOMAIN" '[.result.config.ingress[]?.hostname // empty | select(. != $host)] | unique | join(", ")' <<<"$response")"
    fi
    if [[ -n "$other_hosts" ]]; then
      warn "Der Tunnel '$TUNNEL_NAME' leitet bisher auch weiter: $other_hosts"
      confirm "Diese Weiterleitungen entfernen und den Tunnel nur noch für $SITE_DOMAIN verwenden?" ||
        die "Tunnel nicht geändert. Mit AM_TUNNEL_NAME=<anderer-name> legt das Skript einen eigenen Tunnel an."
    fi
    cf PUT "/accounts/$ACCOUNT_ID/cfd_tunnel/$tunnel_id/configurations" "$(jq -n --arg host "$SITE_DOMAIN" \
      '{config: {ingress: [{hostname: $host, service: "http://web:3000"}, {service: "http_status:404"}]}}')" >/dev/null
    ok "Tunnel leitet $SITE_DOMAIN an die Website"
    response="$(cf GET "/accounts/$ACCOUNT_ID/cfd_tunnel/$tunnel_id/token")"
    TUNNEL_TOKEN="$(jq -r '.result' <<<"$response")"
    [[ -n "$TUNNEL_TOKEN" && "$TUNNEL_TOKEN" != null ]] || die "Cloudflare hat kein Tunnel-Token geliefert."
    cf_dns_upsert CNAME "$SITE_DOMAIN" "$tunnel_id.cfargotunnel.com" true "$site_zone"
    TUNNEL_STATUS_PATH="/accounts/$ACCOUNT_ID/cfd_tunnel/$tunnel_id"
  else
    cf_dns_upsert A "$SITE_DOMAIN" "$PUBLIC_IP" true "$site_zone"
  fi

  # ── Minecraft-Adressen: direkt auf den Server, ohne Cloudflare-Proxy ──
  cf_find_zone "$SERVER_DOMAIN"
  [[ -n "$ZONE_ID" ]] || die "Zu $SERVER_DOMAIN gibt es in diesem Cloudflare-Konto keine Domain."
  cf_dns_upsert A "*.$SERVER_DOMAIN" "$PUBLIC_IP" false "$ZONE_ID"

  # ── Turnstile ──
  if [[ -n "$TURNSTILE_SITE_KEY" && -n "$TURNSTILE_SECRET_KEY" ]]; then
    ok "Turnstile-Schlüssel aus der vorhandenen .env werden weiterverwendet"
    # Ein Widget gilt nur für die Adressen, die bei ihm eingetragen sind. Hat sich die Adresse der
    # Website geändert, muss sie dazu — sonst lehnt Turnstile dort jede Prüfung ab.
    if widget="$(cf_try GET "/accounts/$ACCOUNT_ID/challenges/widgets/$TURNSTILE_SITE_KEY")"; then
      if [[ "$(jq -r --arg host "$SITE_DOMAIN" '[.result.domains[]? | select(. == $host)] | length' <<<"$widget")" -eq 0 ]]; then
        if cf_try PUT "/accounts/$ACCOUNT_ID/challenges/widgets/$TURNSTILE_SITE_KEY" "$(jq -c --arg host "$SITE_DOMAIN" \
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
    if widget="$(cf_try POST "/accounts/$ACCOUNT_ID/challenges/widgets" "$(jq -n --arg name "$WIDGET_NAME" --arg domain "$SITE_DOMAIN" \
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
    note "Welten bekommen Adressen wie mc-abc123.<Domain>. Dafür wird der Platzhalter-Eintrag *.<Domain> angelegt."
    local server_default
    server_default="$(env_value "$env_file" SERVER_DOMAIN)"
    ask SERVER_DOMAIN "Unter welcher Domain sollen die Welten erreichbar sein?" "${server_default:-$SITE_DOMAIN}"
  fi
  SERVER_DOMAIN="${SERVER_DOMAIN,,}"
  is_domain "$SERVER_DOMAIN" || die "'$SERVER_DOMAIN' ist keine gültige Domain."

  ADMIN_EMAIL="${AM_ADMIN_EMAIL:-}"
  [[ -n "$ADMIN_EMAIL" ]] || ask ADMIN_EMAIL "Deine E-Mail-Adresse für das Admin-Konto" ''
  ADMIN_EMAIL="${ADMIN_EMAIL,,}"
  is_email "$ADMIN_EMAIL" || die "'$ADMIN_EMAIL' ist keine gültige E-Mail-Adresse."

  DATA_PATH="${AM_DATA_PATH:-$(env_value "$env_file" DATA_PATH)}"
  DATA_PATH="${DATA_PATH:-/srv/aboutmee/data}"
  [[ "$DATA_PATH" == /* ]] || die "DATA_PATH muss ein absoluter Pfad sein."

  MODE="${AM_MODE:-$(env_value "$env_file" COMPOSE_PROFILES)}"
  TUNNEL_TOKEN="${AM_TUNNEL_TOKEN:-$(env_value "$env_file" TUNNEL_TOKEN)}"
  TURNSTILE_SITE_KEY="${AM_TURNSTILE_SITE_KEY:-$(env_value "$env_file" TURNSTILE_SITE_KEY)}"
  TURNSTILE_SECRET_KEY="${AM_TURNSTILE_SECRET_KEY:-$(env_value "$env_file" TURNSTILE_SECRET_KEY)}"

  local cf_token="${AM_CF_API_TOKEN:-}"
  if [[ -z "$cf_token" && "${AM_YES:-}" != 1 ]]; then
    printf '\n  Mit einem Cloudflare-API-Token richtet das Skript Tunnel, DNS und die Sicherheitsprüfung selbst ein.\n'
    printf '  Token anlegen: Cloudflare-Dashboard → Mein Profil → API-Token → Token erstellen → Benutzerdefiniert, mit:\n'
    printf '    Konto  · Cloudflare Tunnel · Bearbeiten\n'
    printf '    Konto  · Turnstile         · Bearbeiten\n'
    printf '    Zone   · DNS               · Bearbeiten   (für deine Domain)\n'
    printf '    Zone   · Zone              · Lesen        (für deine Domain)\n'
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
    # Lief die Website bisher direkt über diesen Server, nicht stillschweigend dabei bleiben:
    # Mit dem API-Token kann das Skript jetzt den Tunnel einrichten.
    if [[ -z "${AM_MODE:-}" && "$MODE" == caddy ]] &&
      confirm "Bisher läuft die Website direkt über diesen Server (Caddy). Auf den Cloudflare-Tunnel umstellen?"; then
      MODE=tunnel
    fi
    MODE="${MODE:-tunnel}"
    [[ "$MODE" == tunnel || "$MODE" == caddy ]] || die "Die Betriebsart muss tunnel oder caddy sein (AM_MODE oder COMPOSE_PROFILES in .env)."
    CF_HEADERS="$WORK_DIR/cf-headers"
    (umask 077 && printf 'Authorization: Bearer %s\n' "$cf_token" >"$CF_HEADERS")
    cloudflare_setup
  else
    step "Cloudflare von Hand"
    if [[ -z "$TURNSTILE_SITE_KEY" || -z "$TURNSTILE_SECRET_KEY" ]]; then
      note "Cloudflare-Dashboard → Turnstile → Widget hinzufügen → Domain $SITE_DOMAIN eintragen."
      ask TURNSTILE_SITE_KEY "Turnstile Site Key" ''
      ask_secret TURNSTILE_SECRET_KEY "Turnstile Secret Key"
    fi
    [[ -n "$TURNSTILE_SITE_KEY" && -n "$TURNSTILE_SECRET_KEY" ]] || die "Ohne Turnstile-Schlüssel gäbe es keine Sicherheitsprüfung. Bitte beide Schlüssel angeben."
    if [[ -z "$MODE" ]]; then
      if [[ -z "$TUNNEL_TOKEN" && "${AM_YES:-}" != 1 ]]; then
        note "Für einen Cloudflare-Tunnel: Zero Trust → Netzwerke → Tunnel → erstellen, öffentlichen Hostnamen"
        note "$SITE_DOMAIN auf http://web:3000 legen und das Token hier einfügen. Leer lassen = HTTPS direkt über diesen Server."
        ask_secret TUNNEL_TOKEN "Tunnel-Token (optional)"
      fi
      if [[ -n "$TUNNEL_TOKEN" ]]; then MODE=tunnel; else MODE=caddy; fi
    fi
    [[ "$MODE" == tunnel || "$MODE" == caddy ]] || die "Die Betriebsart muss tunnel oder caddy sein (AM_MODE oder COMPOSE_PROFILES in .env)."
    if [[ "$MODE" == tunnel && -z "$TUNNEL_TOKEN" ]]; then
      note "Für den Tunnel fehlt das Token: Zero Trust → Netzwerke → Tunnel → deinen Tunnel öffnen → Token kopieren."
      ask_secret TUNNEL_TOKEN "Tunnel-Token"
      [[ -n "$TUNNEL_TOKEN" ]] || die "Ohne Tunnel-Token geht die Betriebsart tunnel nicht. Mit AM_MODE=caddy läuft die Website direkt über diesen Server."
    fi
    warn "DNS bitte selbst eintragen:  *.$SERVER_DOMAIN  →  A  $PUBLIC_IP  (nur DNS, graue Wolke)"
    [[ "$MODE" == caddy ]] && warn "und:  $SITE_DOMAIN  →  A  $PUBLIC_IP"
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
  local ip_header=cf-connecting-ip
  [[ "$MODE" == caddy ]] && ip_header=x-real-ip
  (
    umask 077
    cat >"$env_file" <<EOF
# Von install.sh geschrieben. Erneutes Ausführen behält diese Werte und alle eigenen Zeilen bei.
SITE_DOMAIN=$SITE_DOMAIN
SITE_URL=https://$SITE_DOMAIN
SERVER_DOMAIN=$SERVER_DOMAIN

# tunnel = Website über Cloudflare-Tunnel, caddy = HTTPS direkt über diesen Server
COMPOSE_PROFILES=$MODE
TUNNEL_TOKEN=$TUNNEL_TOKEN
# Kopfzeile mit der Adresse des Besuchers — gesetzt vom Tunnel bzw. von Caddy
CLIENT_IP_HEADER=$ip_header

TURNSTILE_SITE_KEY=$TURNSTILE_SITE_KEY
TURNSTILE_SECRET_KEY=$TURNSTILE_SECRET_KEY

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
    ufw allow 25565/tcp >/dev/null
    ok "Port 25565 (Minecraft) geöffnet"
    if [[ "$MODE" == caddy ]]; then
      ufw allow 80/tcp >/dev/null
      ufw allow 443/tcp >/dev/null
      ok "Ports 80 und 443 (Website) geöffnet"
    fi
  else
    note "Keine aktive ufw-Firewall gefunden. Falls dein Anbieter eine eigene Firewall hat: Port 25565/TCP freigeben$([[ "$MODE" == caddy ]] && printf ' sowie 80 und 443')."
  fi

  # ── 8. Starten ──
  step "Website bauen und starten (das dauert beim ersten Mal ein paar Minuten)"
  # Beim Wechsel zwischen Tunnel und Caddy den jeweils anderen Dienst abräumen.
  if [[ "$MODE" == tunnel ]]; then
    docker compose --profile caddy rm --stop --force caddy >/dev/null 2>&1 || true
  else
    docker compose --profile tunnel rm --stop --force tunnel >/dev/null 2>&1 || true
  fi
  # Erst nur die Website und den Minecraft-Router starten — noch ohne Tunnel oder Caddy. So ist die
  # Seite von außen nicht erreichbar, bis das Admin-Konto steht, und niemand kann sich vorher unter
  # deiner Adresse registrieren.
  docker compose up -d --build web router
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
  ok "$([[ "$MODE" == tunnel ]] && printf 'Cloudflare-Tunnel gestartet' || printf 'Caddy gestartet (HTTPS-Zertifikat wird beim ersten Aufruf geholt)')"

  if [[ -n "$TUNNEL_STATUS_PATH" ]]; then
    local tunnel_state='' tunnel_waited=0 tunnel_response
    while ((tunnel_waited < 60)); do
      if tunnel_response="$(cf_try GET "$TUNNEL_STATUS_PATH")"; then
        tunnel_state="$(jq -r '.result.status // empty' <<<"$tunnel_response")"
        [[ "$tunnel_state" == healthy ]] && break
      fi
      tunnel_waited=$((tunnel_waited + 5))
      sleep 5
    done
    if [[ "$tunnel_state" == healthy ]]; then
      ok "Tunnel ist verbunden — https://$SITE_DOMAIN ist erreichbar"
    else
      warn "Der Tunnel meldet noch keine Verbindung (Status: ${tunnel_state:-unbekannt}). Der Server muss Cloudflare ausgehend auf Port 7844 erreichen. Logs: docker compose logs tunnel"
    fi
  fi

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
  printf '  Welten:       mc-….%s (Port 25565)\n\n' "$SERVER_DOMAIN"
  printf '  Noch zu tun:\n'
  printf '   • Impressum und Datenschutz ausfüllen (app/(site)/impressum und …/datenschutz), danach: docker compose up -d --build\n'
  printf '   • Im Cloudflare-Dashboard unter SSL/TLS den Modus „Full“ wählen%s\n' "$([[ "$MODE" == tunnel ]] && printf ' (beim Tunnel nicht nötig)')"
  printf '   • Den Ordner %s regelmäßig extern sichern\n\n' "$DATA_PATH"
  printf '  Aktualisieren: cd %s && git pull && sudo ./install.sh\n' "$INSTALL_DIR"
}

# Zum Testen einzelner Funktionen lässt sich das Skript mit AM_SOURCE_ONLY=1 einlesen, ohne dass es losläuft.
[[ "${AM_SOURCE_ONLY:-}" == 1 ]] || main "$@"
