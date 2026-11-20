import { config } from './config'
import { db } from './db'
import type { World } from './runtime/types'

/**
 * Eigene Adresse je Welt über einen SRV-Eintrag bei Cloudflare.
 *
 * Jede Welt lauscht auf einem eigenen Port dieses Servers. Damit Spieler trotzdem nur
 * „mc-abc123.<domain>“ eintippen müssen, bekommt jede Welt beim Anlegen den Eintrag
 *   _minecraft._tcp.mc-abc123.<domain>  SRV  0 5 <port> <nodeHost>
 * Minecraft Java schlägt ihn nach, wenn kein Port angegeben ist, und verbindet sich dann mit
 * <nodeHost>:<port>. Beim Löschen der Welt verschwindet der Eintrag wieder.
 *
 * Ohne API-Zugang (CLOUDFLARE_API_TOKEN und CLOUDFLARE_ZONE_ID) passiert hier nichts; die Welt
 * ist dann über <nodeHost>:<port> erreichbar.
 */

export class DnsError extends Error {}

export function dnsEnabled(): boolean {
  return Boolean(config.cloudflare.token && config.cloudflare.zoneId)
}

/** Name des SRV-Eintrags einer Welt. */
export function recordName(world: Pick<World, 'host_label'>): string {
  return `_minecraft._tcp.${world.host_label}.${config.serverDomain}`
}

type Envelope<T> = { success?: boolean; errors?: Array<{ code?: number; message?: string }>; result?: T }
type DnsRecord = { id: string; name: string; type: string; data?: { port?: number; target?: string } }

async function cloudflare<T>(method: string, path: string, body?: unknown): Promise<{ status: number; result: T | null }> {
  let response: Response
  try {
    response = await fetch(`${config.cloudflare.api}/zones/${config.cloudflare.zoneId}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${config.cloudflare.token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
      cache: 'no-store',
    })
  } catch (error) {
    throw new DnsError(`Cloudflare ist nicht erreichbar: ${error instanceof Error ? error.message : String(error)}`)
  }
  let envelope: Envelope<T> | null = null
  try {
    envelope = (await response.json()) as Envelope<T>
  } catch {
    // keine JSON-Antwort
  }
  if (!response.ok || envelope?.success !== true) {
    // Ein Eintrag, den es nicht (mehr) gibt, ist beim Löschen kein Fehler. Cloudflare meldet das als 404
    // oder mit dem Code 81044. Bei allen anderen Aufrufen bleibt „nicht gefunden“ ein Fehler.
    const gone = response.status === 404 || envelope?.errors?.some((entry) => entry.code === 81044)
    if (method === 'DELETE' && gone) return { status: 404, result: null }
    const reason = envelope?.errors?.map((entry) => entry.message).filter(Boolean).join('; ') || `HTTP ${response.status}`
    throw new DnsError(`Cloudflare lehnt ab (${method} ${path.split('?')[0]}): ${reason}`)
  }
  return { status: response.status, result: envelope.result ?? null }
}

function recordBody(world: Pick<World, 'host_label' | 'port'>): Record<string, unknown> {
  return {
    type: 'SRV',
    name: recordName(world),
    data: { priority: 0, weight: 5, port: world.port, target: config.nodeHost },
    ttl: 60,
    comment: 'aboutm.ee Hosting — Welt',
  }
}

/**
 * Legt den SRV-Eintrag einer Welt an, falls er fehlt. Gibt zurück, ob die Welt danach einen hat.
 * Gibt es unter dem Namen schon einen (etwa nach einer wiederhergestellten Datenbank), wird er
 * übernommen und auf den richtigen Port gestellt.
 */
export async function ensureWorldRecord(world: World): Promise<boolean> {
  if (!dnsEnabled() || world.port === null) return false
  if (world.dns_record_id) return true

  const name = recordName(world)
  const found = await cloudflare<DnsRecord[]>('GET', `/dns_records?type=SRV&name.exact=${encodeURIComponent(name)}`)
  const existing = found.result?.find((record) => record.type === 'SRV' && record.name === name)

  let id: string
  if (existing) {
    const correct = existing.data?.port === world.port && existing.data?.target === config.nodeHost
    if (!correct) await cloudflare<DnsRecord>('PATCH', `/dns_records/${existing.id}`, recordBody(world))
    id = existing.id
  } else {
    const created = await cloudflare<DnsRecord>('POST', '/dns_records', recordBody(world))
    if (!created.result?.id) throw new DnsError('Cloudflare hat keinen Eintrag zurückgegeben.')
    id = created.result.id
  }

  // Nur eintragen, wenn es die Welt noch gibt — sonst den eben angelegten Eintrag wieder wegräumen.
  const updated = db().prepare('UPDATE worlds SET dns_record_id = ? WHERE id = ?').run(id, world.id)
  if (updated.changes === 0) {
    await removeWorldRecord({ ...world, dns_record_id: id })
    return false
  }
  return true
}

/** Löscht alle SRV-Einträge unter einem Namen — auch einen, dessen Kennung nie gespeichert wurde. */
async function deleteByName(name: string): Promise<void> {
  const found = await cloudflare<DnsRecord[]>('GET', `/dns_records?type=SRV&name.exact=${encodeURIComponent(name)}`)
  for (const record of found.result ?? []) {
    if (record.type === 'SRV' && record.name === name) await cloudflare('DELETE', `/dns_records/${encodeURIComponent(record.id)}`)
  }
}

/** So lange bleibt ein Port nach dem Entfernen des Eintrags noch gesperrt — Resolver kennen den alten Eintrag noch kurz. */
const HOLD_MS = 5 * 60_000

type Removable = Pick<World, 'host_label' | 'port' | 'dns_record_id'>

/**
 * Merkt den SRV-Eintrag einer Welt zum Entfernen vor und sperrt ihren Port (siehe pendingCleanupPorts).
 * Läuft ohne Wartepunkt und gehört in dieselbe Transaktion, die die Welt löscht: So ist der Port zu
 * keinem Zeitpunkt frei, solange der alte Name noch auf ihn zeigen könnte — auch nicht, wenn Cloudflare
 * gerade nicht antwortet oder die Website mittendrin neu startet.
 * Gibt den vorgemerkten Namen zurück, oder null, wenn es nichts zu entfernen gibt.
 */
export function queueRecordRemoval(world: Removable): string | null {
  // Ohne Cloudflare-Zugang gibt es nur etwas zu tun, wenn früher ein Eintrag angelegt wurde.
  if (!dnsEnabled() && !world.dns_record_id) return null
  const name = recordName(world)
  db()
    .prepare('INSERT OR REPLACE INTO dns_cleanup (name, record_id, port, created_at, removed_at) VALUES (?, ?, ?, ?, NULL)')
    .run(name, world.dns_record_id, world.port, Date.now())
  return name
}

/** Ist das der aktuelle Name einer bestehenden Welt? */
function ownedByLiveWorld(name: string): boolean {
  const prefix = '_minecraft._tcp.'
  const suffix = `.${config.serverDomain}`
  if (!name.startsWith(prefix) || !name.endsWith(suffix)) return false
  const label = name.slice(prefix.length, name.length - suffix.length)
  return db().prepare('SELECT 1 FROM worlds WHERE host_label = ?').get(label) !== undefined
}

/** Entfernt einen vorgemerkten Eintrag bei Cloudflare. Wirft, wenn das gerade nicht klappt — die Vormerkung bleibt. */
async function removeQueued(name: string): Promise<void> {
  const row = db().prepare('SELECT record_id FROM dns_cleanup WHERE name = ? AND removed_at IS NULL').get(name) as
    | { record_id: string | null }
    | undefined
  if (!row) return
  // Niemals den Eintrag einer Welt löschen, die es gibt: Gehört der Name (wieder) einer bestehenden Welt —
  // etwa nach einem zurückgenommenen Domainwechsel —, ist die Vormerkung überholt.
  if (ownedByLiveWorld(name)) {
    db().prepare('DELETE FROM dns_cleanup WHERE name = ?').run(name)
    return
  }
  if (row.record_id) await cloudflare('DELETE', `/dns_records/${encodeURIComponent(row.record_id)}`)
  // Zusätzlich nach dem Namen suchen: Ein Eintrag kann bei Cloudflare angelegt worden sein, ohne dass seine
  // Kennung noch in der Datenbank ankam.
  await deleteByName(name)
  // Der Eintrag ist weg. Den Port noch kurz gesperrt lassen, bis ihn auch kein Resolver mehr kennt.
  db().prepare('UPDATE dns_cleanup SET removed_at = ? WHERE name = ?').run(Date.now(), name)
}

/**
 * Entfernt den SRV-Eintrag einer gelöschten Welt. Klappt das gerade nicht (oder fehlt der Cloudflare-Zugang),
 * bleibt er vorgemerkt und wird später nachgeholt — ihr Port bleibt so lange gesperrt. Ein verwaister Eintrag
 * würde sonst auf einen Port zeigen, den inzwischen eine fremde Welt hat.
 */
export async function removeWorldRecord(world: Removable): Promise<void> {
  await finishRecordRemoval(queueRecordRemoval(world))
}

/** Zweiter Schritt nach queueRecordRemoval: den vorgemerkten Eintrag jetzt bei Cloudflare entfernen. */
export async function finishRecordRemoval(name: string | null): Promise<void> {
  if (!name || !dnsEnabled()) return
  try {
    await removeQueued(name)
  } catch (error) {
    console.error(`[aboutm.ee] DNS-Eintrag ${name} ließ sich nicht entfernen:`, error instanceof Error ? error.message : error)
  }
}

/** Ports, auf die noch ein Eintrag einer gelöschten Welt zeigt oder gerade eben noch zeigte — sie werden nicht neu vergeben. */
export function pendingCleanupPorts(now = Date.now()): number[] {
  const rows = db()
    .prepare('SELECT port FROM dns_cleanup WHERE port IS NOT NULL AND (removed_at IS NULL OR removed_at > ?)')
    .all(now - HOLD_MS) as Array<{ port: number }>
  return rows.map((row) => row.port)
}

/** Wie viele Welten bzw. Einträge ein Durchlauf höchstens bearbeitet — weit unter den Grenzen der Cloudflare-API. */
const BATCH = 25

/** Holt nach, was beim ersten Versuch nicht geklappt hat: fehlende Einträge anlegen, verwaiste entfernen. */
export async function dnsMaintenance(now = Date.now()): Promise<void> {
  // Erledigte Vormerkungen fallen weg, sobald ihre Sperrfrist um ist.
  db().prepare('DELETE FROM dns_cleanup WHERE removed_at IS NOT NULL AND removed_at <= ?').run(now - HOLD_MS)
  if (!dnsEnabled()) return
  reconcileDnsConfig()

  const missing = db()
    .prepare('SELECT * FROM worlds WHERE port IS NOT NULL AND dns_record_id IS NULL ORDER BY created_at LIMIT ?')
    .all(BATCH) as World[]
  for (const world of missing) {
    try {
      await ensureWorldRecord(world)
    } catch (error) {
      console.error(`[aboutm.ee] DNS-Eintrag für ${world.id}:`, error instanceof Error ? error.message : error)
      break // vermutlich ein allgemeines Problem (Token, Netz, Grenze erreicht) — nicht für jede Welt wiederholen
    }
  }

  const orphans = db()
    .prepare('SELECT name FROM dns_cleanup WHERE removed_at IS NULL ORDER BY created_at LIMIT ?')
    .all(BATCH) as Array<{ name: string }>
  for (const orphan of orphans) {
    try {
      await removeQueued(orphan.name)
    } catch {
      break // später noch einmal
    }
  }
}

type DnsSignature = { serverDomain: string; nodeHost: string; zoneId: string }

/**
 * Passt gespeicherte Einträge an, wenn sich die Domain der Welten, die Adresse des Servers oder die
 * Cloudflare-Zone geändert hat: Die alten Einträge werden zum Entfernen vorgemerkt und die Welten
 * bekommen (über dnsMaintenance) neue. Ohne das zeigte die Website Namen an, die es nie geben wird.
 */
export function reconcileDnsConfig(): void {
  if (!dnsEnabled()) return
  const current: DnsSignature = { serverDomain: config.serverDomain, nodeHost: config.nodeHost, zoneId: config.cloudflare.zoneId }
  const stored = db().prepare(`SELECT value FROM settings WHERE key = 'dnsSignature'`).get() as { value: string } | undefined
  let previous: DnsSignature | null = null
  try {
    previous = stored ? (JSON.parse(stored.value) as DnsSignature) : null
  } catch {
    previous = null
  }
  const same =
    previous?.serverDomain === current.serverDomain && previous.nodeHost === current.nodeHost && previous.zoneId === current.zoneId
  if (same) return

  db().transaction(() => {
    if (previous) {
      const affected = db().prepare('SELECT host_label, dns_record_id, port FROM worlds WHERE dns_record_id IS NOT NULL').all() as Array<{
        host_label: string
        dns_record_id: string
        port: number | null
      }>
      const renamed = previous.serverDomain !== current.serverDomain
      const sameZone = previous.zoneId === current.zoneId
      if (renamed && sameZone) {
        // Die alten Namen gibt es noch — entfernen. Der Port steht mit dabei: Solange die Welt besteht, ändert
        // das nichts (er ist ohnehin belegt); wird sie gelöscht, bevor ihr alter Name weg ist, bleibt er gesperrt.
        const queue = db().prepare(
          'INSERT OR REPLACE INTO dns_cleanup (name, record_id, port, created_at, removed_at) VALUES (?, ?, ?, ?, NULL)',
        )
        for (const world of affected) {
          queue.run(`_minecraft._tcp.${world.host_label}.${previous.serverDomain}`, world.dns_record_id, world.port, Date.now())
        }
      } else if (!sameZone && affected.length > 0) {
        console.warn(
          `[aboutm.ee] Die Cloudflare-Zone hat sich geändert. ${affected.length} SRV-Einträge in der bisherigen Zone lassen sich von hier nicht entfernen — bitte dort von Hand löschen.`,
        )
      }
      // Kennungen vergessen: Die Einträge werden neu angelegt bzw. unter ihrem Namen gefunden und berichtigt.
      db().prepare('UPDATE worlds SET dns_record_id = NULL WHERE dns_record_id IS NOT NULL').run()
      if (affected.length > 0) {
        console.log(`[aboutm.ee] Adressen der Welten haben sich geändert — ${affected.length} SRV-Einträge werden neu angelegt.`)
      }
    }
    // Vormerkungen, die auf den jetzt gültigen Namen einer bestehenden Welt lauten, sind überholt (die Domain
    // wurde zurückgestellt, bevor sie abgearbeitet waren) — sie würden sonst den Eintrag der Welt löschen.
    const drop = db().prepare('DELETE FROM dns_cleanup WHERE name = ?')
    for (const world of db().prepare('SELECT host_label FROM worlds').all() as Array<{ host_label: string }>) {
      drop.run(`_minecraft._tcp.${world.host_label}.${current.serverDomain}`)
    }
    db()
      .prepare(`INSERT INTO settings (key, value) VALUES ('dnsSignature', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
      .run(JSON.stringify(current))
  })()
}

export type DnsUsage = { used: number; quota: number | null }

/**
 * Wie viele DNS-Einträge die Domain belegt und wie viele sie haben darf. Jede Welt braucht einen;
 * Cloudflare erlaubt je nach Tarif und Alter der Domain 200, 1.000 oder 3.500. Ist die Grenze erreicht,
 * bekommen neue Welten keinen eigenen Namen mehr und sind über <Server>:<Port> erreichbar.
 */
export async function dnsUsage(): Promise<DnsUsage | null> {
  if (!dnsEnabled()) return null
  try {
    const { result } = await cloudflare<{ record_quota?: number | null; record_usage?: number }>('GET', '/dns_records/usage')
    if (typeof result?.record_usage !== 'number') return null
    return { used: result.record_usage, quota: result.record_quota ?? null }
  } catch {
    return null
  }
}
