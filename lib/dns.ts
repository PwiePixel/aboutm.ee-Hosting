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
    // oder mit dem Code 81044.
    const gone = response.status === 404 || envelope?.errors?.some((entry) => entry.code === 81044)
    if (gone) return { status: 404, result: null }
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
    await removeRecord(id)
    return false
  }
  return true
}

/**
 * Entfernt einen SRV-Eintrag. Klappt das gerade nicht, wird er vorgemerkt und später nachgeholt —
 * ein verwaister Eintrag würde sonst für immer auf einen Port zeigen, der längst neu vergeben sein kann.
 */
export async function removeRecord(recordId: string): Promise<void> {
  if (!dnsEnabled()) return
  try {
    await cloudflare('DELETE', `/dns_records/${encodeURIComponent(recordId)}`)
    db().prepare('DELETE FROM dns_cleanup WHERE record_id = ?').run(recordId)
  } catch (error) {
    db().prepare('INSERT OR IGNORE INTO dns_cleanup (record_id, created_at) VALUES (?, ?)').run(recordId, Date.now())
    console.error(`[aboutm.ee] DNS-Eintrag ${recordId} ließ sich nicht entfernen:`, error instanceof Error ? error.message : error)
  }
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

  const orphans = db().prepare('SELECT record_id FROM dns_cleanup ORDER BY created_at LIMIT 5').all() as Array<{
    record_id: string
  }>
  for (const orphan of orphans) await removeRecord(orphan.record_id)
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
