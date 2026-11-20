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
    await removeWorldRecord(world)
    return false
  }
  return true
}

/** Löscht alle SRV-Einträge unter dem Namen der Welt — auch einen, dessen Kennung nie gespeichert wurde. */
async function deleteByName(name: string): Promise<void> {
  const found = await cloudflare<DnsRecord[]>('GET', `/dns_records?type=SRV&name.exact=${encodeURIComponent(name)}`)
  for (const record of found.result ?? []) {
    if (record.type === 'SRV' && record.name === name) await cloudflare('DELETE', `/dns_records/${encodeURIComponent(record.id)}`)
  }
}

/**
 * Entfernt den SRV-Eintrag einer gelöschten Welt. Klappt das gerade nicht, wird er vorgemerkt und später
 * nachgeholt — und ihr Port bleibt so lange gesperrt (siehe pendingCleanupPorts). Ein verwaister Eintrag
 * würde sonst auf einen Port zeigen, den inzwischen eine fremde Welt hat.
 */
export async function removeWorldRecord(world: Pick<World, 'host_label' | 'port' | 'dns_record_id'>): Promise<void> {
  if (!dnsEnabled()) return
  const name = recordName(world)
  try {
    if (world.dns_record_id) await cloudflare('DELETE', `/dns_records/${encodeURIComponent(world.dns_record_id)}`)
    // Zusätzlich nach dem Namen suchen: Ein Eintrag kann bei Cloudflare angelegt worden sein, ohne dass seine
    // Kennung noch in der Datenbank ankam.
    await deleteByName(name)
    db().prepare('DELETE FROM dns_cleanup WHERE name = ?').run(name)
  } catch (error) {
    db()
      .prepare('INSERT OR REPLACE INTO dns_cleanup (name, record_id, port, created_at) VALUES (?, ?, ?, ?)')
      .run(name, world.dns_record_id, world.port, Date.now())
    console.error(`[aboutm.ee] DNS-Eintrag ${name} ließ sich nicht entfernen:`, error instanceof Error ? error.message : error)
  }
}

/** Ports, auf die noch ein nicht entfernter Eintrag einer gelöschten Welt zeigt — sie werden nicht neu vergeben. */
export function pendingCleanupPorts(): number[] {
  const rows = db().prepare('SELECT port FROM dns_cleanup WHERE port IS NOT NULL').all() as Array<{ port: number }>
  return rows.map((row) => row.port)
}

/** Holt nach, was beim ersten Versuch nicht geklappt hat: fehlende Einträge anlegen, verwaiste entfernen. */
export async function dnsMaintenance(): Promise<void> {
  if (!dnsEnabled()) return

  const missing = db()
    .prepare('SELECT * FROM worlds WHERE port IS NOT NULL AND dns_record_id IS NULL ORDER BY created_at LIMIT 5')
    .all() as World[]
  for (const world of missing) {
    try {
      await ensureWorldRecord(world)
    } catch (error) {
      console.error(`[aboutm.ee] DNS-Eintrag für ${world.id}:`, error instanceof Error ? error.message : error)
      break // vermutlich ein allgemeines Problem (Token, Netz) — nicht für jede Welt wiederholen
    }
  }

  const orphans = db().prepare('SELECT name, record_id, port FROM dns_cleanup ORDER BY created_at LIMIT 5').all() as Array<{
    name: string
    record_id: string | null
    port: number | null
  }>
  for (const orphan of orphans) {
    try {
      if (orphan.record_id) await cloudflare('DELETE', `/dns_records/${encodeURIComponent(orphan.record_id)}`)
      await deleteByName(orphan.name)
      db().prepare('DELETE FROM dns_cleanup WHERE name = ?').run(orphan.name)
    } catch {
      break // später noch einmal
    }
  }
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
