import path from 'node:path'

function int(value: string | undefined, fallback: number, min = 1): number {
  const n = Number.parseInt(value ?? '', 10)
  return Number.isFinite(n) && n >= min ? n : fallback
}

export const config = {
  brand: 'aboutm.ee',
  siteUrl: (process.env.SITE_URL ?? 'http://localhost:3000').replace(/\/+$/, ''),
  /** Welten sind unter <kennung>.<serverDomain> erreichbar. */
  serverDomain: process.env.SERVER_DOMAIN ?? 'aboutm.ee',
  supportEmail: process.env.SUPPORT_EMAIL ?? '',

  /**
   * Startwerte. Im laufenden Betrieb gelten die Werte aus dem Admin-Bereich
   * (siehe lib/settings.ts) — dort nachschlagen, nicht hier.
   */
  defaults: {
    totalSlots: int(process.env.TOTAL_SLOTS, 20),
    autoPauseMinutes: int(process.env.AUTO_PAUSE_MINUTES, 30),
    maxWorldsPerUser: 3,
  },
  maxPlayers: 20,
  ramMiB: 2560,
  diskGiB: 6,

  maxManualBackups: 5,
  maxAutoBackups: 5,
  /** Alle Backups einer Welt zusammen dürfen höchstens so viel belegen. */
  backupGiB: 12,
  /** Textdateien bis zu dieser Größe lassen sich im Browser öffnen. */
  maxEditableBytes: 512 * 1024,

  // Laufzeitdaten, kein Teil des Builds — deshalb vom Datei-Tracing ausgenommen.
  dataDir: path.resolve(/*turbopackIgnore: true*/ process.env.DATA_DIR ?? './data'),
  runtimeDriver: process.env.RUNTIME_DRIVER ?? 'simulated',

  /** Nur für RUNTIME_DRIVER=docker. */
  docker: {
    socket: process.env.DOCKER_SOCKET ?? '/var/run/docker.sock',
    /** Pfad des Datenordners auf dem Host — weicht nur ab, wenn die Website selbst im Container läuft. */
    hostDataDir: path.resolve(/*turbopackIgnore: true*/ process.env.HOST_DATA_DIR ?? process.env.DATA_DIR ?? './data'),
    network: process.env.MC_NETWORK ?? 'aboutmee-mc',
    imageJava21: process.env.MC_IMAGE_JAVA21 ?? 'itzg/minecraft-server:java21',
    imageJava25: process.env.MC_IMAGE_JAVA25 ?? 'itzg/minecraft-server:java25',
    /** Obergrenze an CPU-Kernen je Welt. */
    cpus: Number.parseFloat(process.env.MC_CPUS ?? '') || 2,
    /** Benutzer, unter dem der Minecraft-Server im Container läuft. */
    uid: int(process.env.MC_UID, 1000, 0),
    gid: int(process.env.MC_GID, 1000, 0),
  },

  turnstileSiteKey: process.env.TURNSTILE_SITE_KEY ?? '',
  turnstileSecret: process.env.TURNSTILE_SECRET_KEY ?? '',
  /** Nur zum Ausprobieren: Formulare im Live-Betrieb auch ohne Turnstile-Schlüssel annehmen. */
  allowNoTurnstile: process.env.ALLOW_NO_TURNSTILE === '1',

  /**
   * Kopfzeile, aus der die Adresse des Besuchers gelesen wird. Sie muss von einer Stelle gesetzt sein,
   * der wir trauen: hinter dem Cloudflare-Tunnel „cf-connecting-ip“, hinter Caddy „x-real-ip“.
   */
  clientIpHeader: (process.env.CLIENT_IP_HEADER ?? 'cf-connecting-ip').toLowerCase(),

  analytics: {
    umamiSrc: process.env.UMAMI_SRC ?? '',
    umamiWebsiteId: process.env.UMAMI_WEBSITE_ID ?? '',
    cloudflareBeaconToken: process.env.CF_BEACON_TOKEN ?? '',
  },

  sessionCookie: 'am_session',
  sessionDays: 30,
} as const

export const turnstileEnabled = Boolean(config.turnstileSiteKey && config.turnstileSecret)
