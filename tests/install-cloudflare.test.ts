import { spawn } from 'node:child_process'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
// @ts-expect-error — reines JavaScript-Hilfsmodul ohne Typen
import { startCloudflareMock } from './helpers/cloudflare-mock.mjs'

type Call = { method: string; path: string; query: string; body?: Record<string, unknown> }
type DnsRecord = { id: string; type: string; name: string; content: string; proxied: boolean }
type Mock = {
  url: string
  close: () => Promise<void>
  state: {
    calls: Call[]
    dns: DnsRecord[]
    tunnels: Array<{ id: string; name: string; config_src: string }>
    tunnelConfigs: Record<string, { ingress: Array<{ hostname?: string; service: string }> }>
    widgets: Array<{ name: string; domains: string[]; mode: string; sitekey: string; secret: string }>
    ssl: string
    failDns: boolean
  }
}

const ROOT = path.join(import.meta.dirname, '..')

/** Liest install.sh ein, ohne es zu starten, und ruft nur den Cloudflare-Teil auf. */
function runCloudflareSetup(
  mock: Mock,
  vars: Record<string, string>,
  token = 'test-token',
): Promise<{ code: number; stdout: string; stderr: string; result: Record<string, string> | null }> {
  const script = `
    AM_SOURCE_ONLY=1 source ./install.sh
    WORK_DIR="$(mktemp -d)"
    CF_HEADERS="$WORK_DIR/headers"
    printf 'Authorization: Bearer %s\\n' "$TEST_TOKEN" > "$CF_HEADERS"
    : "\${TURNSTILE_SITE_KEY:=}" "\${TURNSTILE_SECRET_KEY:=}" "\${CADDY_TLS:=internal}" "\${ADMIN_EMAIL:=chef@example.com}"
    cloudflare_setup >&2
    jq -n --arg zone "$CLOUDFLARE_ZONE_ID" --arg site "$TURNSTILE_SITE_KEY" --arg secret "$TURNSTILE_SECRET_KEY" --arg tls "$CADDY_TLS" \\
      '{zone: $zone, site: $site, secret: $secret, tls: $tls}'
  `
  return new Promise((resolve) => {
    // detached löst das Terminal ab — wie beim Start über cron oder eine Pipe ohne Rückfragemöglichkeit.
    const child = spawn('bash', ['-c', script], {
      cwd: ROOT,
      env: { ...process.env, AM_CF_API_BASE: mock.url, TEST_TOKEN: token, AM_YES: '', ...vars },
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()))
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
    child.on('close', (code) => {
      let result: Record<string, string> | null = null
      try {
        result = JSON.parse(stdout) as Record<string, string>
      } catch {
        // Bei einem Abbruch gibt es keine Ausgabe.
      }
      resolve({ code: code ?? 1, stdout, stderr, result })
    })
  })
}

const BASE = {
  SITE_DOMAIN: 'hosting.example.com',
  SERVER_DOMAIN: 'example.com',
  NODE_HOST: 'node.example.com',
  PUBLIC_IP: '203.0.113.7',
}
const records = (mock: Mock) => mock.state.dns.map(({ type, name, content, proxied }) => ({ type, name, content, proxied }))

describe('install.sh — Cloudflare einrichten', () => {
  let mock: Mock
  beforeEach(async () => {
    mock = await startCloudflareMock({ zones: ['example.com'] })
  })
  afterEach(() => mock.close())

  it('legt die DNS-Einträge für Website und Server sowie die Turnstile-Schlüssel an', async () => {
    const run = await runCloudflareSetup(mock, BASE)
    expect(run.code, run.stderr).toBe(0)

    // Website über Cloudflare (mit Proxy), Minecraft-Adresse des Servers direkt (ohne Proxy)
    expect(records(mock)).toEqual([
      { type: 'A', name: 'hosting.example.com', content: '203.0.113.7', proxied: true },
      { type: 'A', name: 'node.example.com', content: '203.0.113.7', proxied: false },
    ])
    // Kein Tunnel, kein Platzhalter-Eintrag
    expect(mock.state.tunnels).toHaveLength(0)
    expect(mock.state.dns.some((record) => record.name.startsWith('*'))).toBe(false)

    expect(run.result!.zone).toBe('zone1')
    expect(mock.state.widgets).toHaveLength(1)
    expect(mock.state.widgets[0]).toMatchObject({ domains: ['hosting.example.com'], mode: 'managed' })
    expect(run.result!.site).toBe(mock.state.widgets[0]!.sitekey)
    expect(run.result!.secret).toBe(mock.state.widgets[0]!.secret)
  })

  it('legt bei einem zweiten Lauf nichts doppelt an', async () => {
    const first = await runCloudflareSetup(mock, BASE)
    const second = await runCloudflareSetup(mock, {
      ...BASE,
      TURNSTILE_SITE_KEY: first.result!.site!,
      TURNSTILE_SECRET_KEY: first.result!.secret!,
    })
    expect(second.code, second.stderr).toBe(0)
    expect(mock.state.dns).toHaveLength(2)
    expect(mock.state.widgets).toHaveLength(1)
    expect(second.result).toEqual(first.result)
  })

  it('ändert den SSL/TLS-Modus der Domain nicht — und nimmt bei „Full (strict)“ ein öffentliches Zertifikat', async () => {
    await mock.close()
    mock = await startCloudflareMock({ zones: ['example.com'], ssl: 'flexible' })
    const flexible = await runCloudflareSetup(mock, { ...BASE, CADDY_TLS: 'internal', ADMIN_EMAIL: 'chef@example.com' })
    expect(flexible.code, flexible.stderr).toBe(0)
    expect(mock.state.ssl).toBe('flexible')
    expect(flexible.result!.tls).toBe('internal')

    mock.state.ssl = 'strict'
    const strict = await runCloudflareSetup(mock, {
      ...BASE,
      CADDY_TLS: 'internal',
      ADMIN_EMAIL: 'chef@example.com',
      TURNSTILE_SITE_KEY: flexible.result!.site!,
      TURNSTILE_SECRET_KEY: flexible.result!.secret!,
    })
    expect(strict.code, strict.stderr).toBe(0)
    expect(mock.state.ssl).toBe('strict')
    expect(strict.result!.tls).toBe('chef@example.com')
    expect(mock.state.calls.some((call) => call.method === 'PATCH' && call.path.endsWith('/settings/ssl'))).toBe(false)
  })

  it('ersetzt einen fremden DNS-Eintrag nicht ohne Zustimmung', async () => {
    // Unter der gewünschten Adresse läuft schon etwas anderes.
    await fetch(`${mock.url}/zones/zone1/dns_records`, {
      method: 'POST',
      headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'A', name: 'hosting.example.com', content: '198.51.100.9', proxied: true }),
    })

    const refused = await runCloudflareSetup(mock, BASE)
    expect(refused.code).not.toBe(0)
    expect(refused.stderr).toContain('198.51.100.9')
    expect(mock.state.dns.map((r) => r.content)).toEqual(['198.51.100.9'])

    const agreed = await runCloudflareSetup(mock, { ...BASE, AM_YES: '1' })
    expect(agreed.code, agreed.stderr).toBe(0)
    const site = mock.state.dns.filter((r) => r.name === 'hosting.example.com')
    expect(site).toHaveLength(1)
    expect(site[0]).toMatchObject({ type: 'A', content: '203.0.113.7', proxied: true })
  })

  it('verlangt, dass die Server-Adresse in der Domain der Welten liegt', async () => {
    const run = await runCloudflareSetup(mock, { ...BASE, NODE_HOST: 'node.andere-domain.de' })
    expect(run.code).not.toBe(0)
    expect(run.stderr).toContain('node.andere-domain.de')
  })

  it('bricht mit der Meldung von Cloudflare ab, wenn das Token nicht stimmt oder die Domain fehlt', async () => {
    const badToken = await runCloudflareSetup(mock, BASE, 'falsches-token')
    expect(badToken.code).not.toBe(0)
    expect(badToken.stderr).toContain('Invalid API token')
    expect(badToken.stderr).not.toContain('keine Domain')
    expect(badToken.stderr).not.toContain('Abgebrochen in Zeile')
    expect(mock.state.dns).toHaveLength(0)

    const noZone = await runCloudflareSetup(mock, { ...BASE, SITE_DOMAIN: 'hosting.andere-domain.de' })
    expect(noZone.code).not.toBe(0)
    expect(noZone.stderr).toContain('keine Domain')
    expect(mock.state.dns).toHaveLength(0)
  })

  it('kommt mit einem Konto-Token zurecht — und fragt nach den Turnstile-Schlüsseln, die es nicht anlegen darf', async () => {
    await mock.close()
    mock = await startCloudflareMock({ zones: ['example.com'], accountToken: true })
    const withKeys = await runCloudflareSetup(mock, { ...BASE, TURNSTILE_SITE_KEY: 'vorhanden', TURNSTILE_SECRET_KEY: 'geheim' })
    expect(withKeys.code, withKeys.stderr).toBe(0)
    expect(mock.state.dns).toHaveLength(2)
    expect(withKeys.result).toMatchObject({ site: 'vorhanden', secret: 'geheim' })

    const withoutKeys = await runCloudflareSetup(mock, BASE)
    expect(withoutKeys.code).not.toBe(0)
    expect(withoutKeys.stderr).toContain('Turnstile')
    expect(mock.state.widgets).toHaveLength(0)
  })

  it('trägt eine geänderte Website-Adresse beim vorhandenen Turnstile-Widget nach', async () => {
    const first = await runCloudflareSetup(mock, BASE)
    const keys = { TURNSTILE_SITE_KEY: first.result!.site!, TURNSTILE_SECRET_KEY: first.result!.secret! }

    const moved = await runCloudflareSetup(mock, { ...BASE, ...keys, SITE_DOMAIN: 'play.example.com', AM_YES: '1' })
    expect(moved.code, moved.stderr).toBe(0)
    expect(mock.state.widgets).toHaveLength(1)
    expect(mock.state.widgets[0]!.domains).toEqual(['hosting.example.com', 'play.example.com'])
  })

  it('zeigt das Token nie in der Prozessliste', async () => {
    await runCloudflareSetup(mock, BASE)
    expect(mock.state.calls.length).toBeGreaterThan(5)
    const script = (await import('node:fs')).readFileSync(path.join(ROOT, 'install.sh'), 'utf8')
    expect(script).toContain('--header "@$CF_HEADERS"')
    expect(script).not.toMatch(/curl[^\n]*Bearer \$/)
  })
})

describe('install.sh — Einstellungen lesen und behalten', () => {
  const bash = (script: string): Promise<string> =>
    new Promise((resolve, reject) => {
      const child = spawn('bash', ['-c', `AM_SOURCE_ONLY=1 source ./install.sh\n${script}`], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] })
      let out = ''
      let err = ''
      child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString()))
      child.stderr.on('data', (chunk: Buffer) => (err += chunk.toString()))
      child.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(err || `exit ${code}`))))
    })

  it('liest Werte auch mit Anführungszeichen, Leerraum und angehängtem Kommentar', async () => {
    const out = await bash(`
      file="$(mktemp)"
      printf '%s\\n' 'A=einfach' 'B="in Anführungszeichen"' "C='einfach gequotet'" 'D=wert   # Kommentar' '  E = mit-leerraum  ' 'F=' 'G=a#b' > "$file"
      for key in A B C D E F G FEHLT; do printf '%s=[%s]\\n' "$key" "$(env_value "$file" "$key")"; done
    `)
    expect(out.trim().split('\n')).toEqual([
      'A=[einfach]',
      'B=[in Anführungszeichen]',
      'C=[einfach gequotet]',
      'D=[wert]',
      'E=[mit-leerraum]',
      'F=[]',
      'G=[a#b]',
      'FEHLT=[]',
    ])
  })

  it('erkennt eigene Zeilen in der .env, damit ein erneuter Lauf sie nicht verliert', async () => {
    const out = await bash(`
      file="$(mktemp)"
      printf '%s\\n' '# Kommentar' 'SITE_DOMAIN=x.example.com' 'UMAMI_SRC=https://stats.example.com/script.js' 'CLOUDFLARE_API_TOKEN=geheim' 'MC_UID=1001' '' 'CF_BEACON_TOKEN="abc"' > "$file"
      env_extras "$file"
    `)
    expect(out.trim().split('\n')).toEqual(['UMAMI_SRC=https://stats.example.com/script.js', 'MC_UID=1001', 'CF_BEACON_TOKEN="abc"'])
  })
})
