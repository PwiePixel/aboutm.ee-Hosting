import http from 'node:http'
import { config } from '../config'

/** Schlanker Zugriff auf die Docker-Engine über ihren Unix-Socket — ohne CLI, ohne Zusatzpaket. */

export type DockerResponse = { status: number; body: Buffer }

export class DockerError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

export function docker(
  method: string,
  path: string,
  options: { body?: unknown; timeoutMs?: number } = {},
): Promise<DockerResponse> {
  return new Promise((resolve, reject) => {
    const payload = options.body === undefined ? undefined : Buffer.from(JSON.stringify(options.body))
    const request = http.request(
      {
        socketPath: config.docker.socket,
        method,
        path,
        headers: payload
          ? { 'Content-Type': 'application/json', 'Content-Length': payload.length }
          : undefined,
        timeout: options.timeoutMs ?? 15_000,
      },
      (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks) }))
        response.on('error', reject)
      },
    )
    request.on('timeout', () => request.destroy(new Error(`Docker antwortet nicht (${method} ${path})`)))
    request.on('error', reject)
    if (payload) request.write(payload)
    request.end()
  })
}

export function json<T>(response: DockerResponse): T {
  return JSON.parse(response.body.toString('utf8')) as T
}

export function describeFailure(response: DockerResponse): string {
  try {
    return json<{ message?: string }>(response).message ?? `HTTP ${response.status}`
  } catch {
    return `HTTP ${response.status}`
  }
}

/** Wirft, wenn Docker einen Fehler meldet — außer bei den ausdrücklich erlaubten Statuscodes. */
export function expectOk(response: DockerResponse, what: string, allowed: number[] = []): DockerResponse {
  if (response.status >= 400 && !allowed.includes(response.status)) {
    throw new DockerError(`${what}: ${describeFailure(response)}`, response.status)
  }
  return response
}

/**
 * Docker liefert Ausgaben ohne TTY als Rahmen: 8 Byte Kopf (Kanal, Länge), dann Nutzdaten.
 * Hier werden stdout und stderr wieder zu einem Text zusammengesetzt.
 */
export function demux(buffer: Buffer): string {
  const parts: Buffer[] = []
  let offset = 0
  while (offset + 8 <= buffer.length) {
    const channel = buffer[offset]!
    if (channel > 2 || buffer[offset + 1] !== 0 || buffer[offset + 2] !== 0 || buffer[offset + 3] !== 0) {
      // Kein Rahmenformat (z. B. Container mit TTY) — unverändert zurückgeben.
      return buffer.toString('utf8')
    }
    const length = buffer.readUInt32BE(offset + 4)
    parts.push(buffer.subarray(offset + 8, offset + 8 + length))
    offset += 8 + length
  }
  return Buffer.concat(parts).toString('utf8')
}

// Farbcodes des Terminals und von Minecraft (§a) stören in der Webkonsole.
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b[@-_]/g
const SECTION = /§[0-9a-fk-orx]/gi

export function cleanOutput(text: string): string {
  return text.replace(ANSI, '').replace(SECTION, '').replace(/\r/g, '')
}

export async function exec(
  containerName: string,
  command: string[],
  timeoutMs = 10_000,
): Promise<{ output: string; exitCode: number | null }> {
  const created = expectOk(
    await docker('POST', `/containers/${containerName}/exec`, {
      body: { Cmd: command, AttachStdout: true, AttachStderr: true, Tty: false },
    }),
    'Befehl vorbereiten',
  )
  const id = json<{ Id: string }>(created).Id
  const started = expectOk(
    await docker('POST', `/exec/${id}/start`, { body: { Detach: false, Tty: false }, timeoutMs }),
    'Befehl ausführen',
  )
  const inspected = await docker('GET', `/exec/${id}/json`)
  const exitCode = inspected.status === 200 ? json<{ ExitCode: number | null }>(inspected).ExitCode : null
  return { output: cleanOutput(demux(started.body)), exitCode }
}
