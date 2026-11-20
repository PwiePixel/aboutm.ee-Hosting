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
    TUNNEL_TOKEN="" ; : "\${TURNSTILE_SITE_KEY:=}" "\${TURNSTILE_SECRET_KEY:=}"
    cloudflare_setup >&2
    jq -n --arg tunnel "$TUNNEL_TOKEN" --arg site "$TURNSTILE_SITE_KEY" --arg secret "$TURNSTILE_SECRET_KEY" \\
      '{tunnel: $tunnel, site: $site, secret: $secret}'
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

const BASE = { SITE_DOMAIN: 'hosting.example.com', SERVER_DOMAIN: 'example.com', MODE: 'tunnel', PUBLIC_IP: '203.0.113.7' }

describe('install.sh — Cloudflare einrichten', () => {
  let mock: Mock
  beforeEach(async () => {
    mock = await startCloudflareMock({ zones: ['example.com'] })
  })
  afterEach(() => mock.close())

  it('legt Tunnel, DNS und Turnstile an', async () => {
    const run = await runCloudflareSetup(mock, BASE)
    expect(run.code, run.stderr).toBe(0)

    // Tunnel: von Cloudflare verwaltet, leitet die Adresse an die Website, Rest 404
    expect(mock.state.tunnels).toHaveLength(1)
    const tunnel = mock.state.tunnels[0]!
    expect(tunnel).toMatchObject({ name: 'aboutmee', config_src: 'cloudflare' })
    expect(mock.state.tunnelConfigs[tunnel.id]!.ingress).toEqual([
      { hostname: 'hosting.example.com', service: 'http://web:3000' },
      { service: 'http_status:404' },
    ])
    expect(run.result!.tunnel).toBe(`tunneltoken.${tunnel.id}`)

    // DNS: Website über den Tunnel (mit Proxy), Welten direkt auf den Server (ohne Proxy)
    const dns = mock.state.dns.map(({ type, name, content, proxied }) => ({ type, name, content, proxied }))
    expect(dns).toContainEqual({ type: 'CNAME', name: 'hosting.example.com', content: `${tunnel.id}.cfargotunnel.com`, proxied: true })
    expect(dns).toContainEqual({ type: 'A', name: '*.example.com', content: '203.0.113.7', proxied: false })
    expect(dns).toHaveLength(2)

    // Turnstile
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
    expect(mock.state.tunnels).toHaveLength(1)
    expect(mock.state.dns).toHaveLength(2)
    expect(mock.state.widgets).toHaveLength(1)
    expect(second.result).toEqual(first.result)
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
    expect(site[0]).toMatchObject({ type: 'CNAME', proxied: true })
  })

  it('setzt ohne Tunnel einen A-Eintrag für die Website', async () => {
    const run = await runCloudflareSetup(mock, { ...BASE, MODE: 'caddy' })
    expect(run.code, run.stderr).toBe(0)
    expect(mock.state.tunnels).toHaveLength(0)
    expect(mock.state.dns.map(({ type, name, proxied }) => ({ type, name, proxied }))).toEqual([
      { type: 'A', name: 'hosting.example.com', proxied: true },
      { type: 'A', name: '*.example.com', proxied: false },
    ])
  })

  it('bricht mit der Meldung von Cloudflare ab, wenn das Token nicht stimmt oder die Domain fehlt', async () => {
    const badToken = await runCloudflareSetup(mock, BASE, 'falsches-token')
    expect(badToken.code).not.toBe(0)
    expect(badToken.stderr).toContain('Invalid API token')
    expect(mock.state.tunnels).toHaveLength(0)

    const noZone = await runCloudflareSetup(mock, { ...BASE, SITE_DOMAIN: 'hosting.andere-domain.de' })
    expect(noZone.code).not.toBe(0)
    expect(noZone.stderr).toContain('keine Domain')
    expect(mock.state.tunnels).toHaveLength(0)
    expect(mock.state.dns).toHaveLength(0)
  })

  it('verwechselt den Tunnel nicht mit einem ähnlich benannten', async () => {
    await fetch(`${mock.url}/accounts/acc1/cfd_tunnel`, {
      method: 'POST',
      headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'aboutmee-alt', config_src: 'cloudflare' }),
    })
    const run = await runCloudflareSetup(mock, BASE)
    expect(run.code, run.stderr).toBe(0)
    expect(mock.state.tunnels.map((t) => t.name).sort()).toEqual(['aboutmee', 'aboutmee-alt'])
    const own = mock.state.tunnels.find((t) => t.name === 'aboutmee')!
    const other = mock.state.tunnels.find((t) => t.name === 'aboutmee-alt')!
    expect(mock.state.tunnelConfigs[own.id]).toBeDefined()
    expect(mock.state.tunnelConfigs[other.id]).toBeUndefined() // der fremde Tunnel bleibt unangetastet
  })

  it('kommt auch mit einem Konto-Token zurecht, das sich nicht vorab prüfen lässt', async () => {
    await mock.close()
    mock = await startCloudflareMock({ zones: ['example.com'], accountToken: true })
    // Turnstile geht mit Konto-Tokens nicht — mit bereits vorhandenen Schlüsseln läuft trotzdem alles durch …
    const withKeys = await runCloudflareSetup(mock, { ...BASE, TURNSTILE_SITE_KEY: 'vorhanden', TURNSTILE_SECRET_KEY: 'geheim' })
    expect(withKeys.code, withKeys.stderr).toBe(0)
    expect(mock.state.tunnels).toHaveLength(1)
    expect(withKeys.result).toMatchObject({ site: 'vorhanden', secret: 'geheim' })

    // … und ohne Schlüssel fragt das Skript danach, statt mittendrin kommentarlos abzubrechen.
    const withoutKeys = await runCloudflareSetup(mock, BASE)
    expect(withoutKeys.code).not.toBe(0)
    expect(withoutKeys.stderr).toContain('Turnstile')
    expect(mock.state.widgets).toHaveLength(0)
  })

  it('findet bestehende Platzhalter-Einträge (Name mit Stern) wieder', async () => {
    await runCloudflareSetup(mock, BASE)
    const lookups = mock.state.calls.filter((call) => call.method === 'GET' && call.path.endsWith('/dns_records'))
    expect(lookups.some((call) => call.query.includes('name.exact=%2A.example.com'))).toBe(true)
  })

  it('trägt eine geänderte Website-Adresse beim vorhandenen Turnstile-Widget nach', async () => {
    const first = await runCloudflareSetup(mock, BASE)
    const keys = { TURNSTILE_SITE_KEY: first.result!.site!, TURNSTILE_SECRET_KEY: first.result!.secret! }

    const moved = await runCloudflareSetup(mock, { ...BASE, ...keys, SITE_DOMAIN: 'play.example.com', AM_YES: '1' })
    expect(moved.code, moved.stderr).toBe(0)
    expect(mock.state.widgets).toHaveLength(1)
    expect(mock.state.widgets[0]!.domains).toEqual(['hosting.example.com', 'play.example.com'])
    expect(moved.result).toMatchObject({ site: keys.TURNSTILE_SITE_KEY, secret: keys.TURNSTILE_SECRET_KEY })

    // Stimmt die Adresse schon, wird das Widget nicht angefasst.
    const puts = () => mock.state.calls.filter((call) => call.method === 'PUT' && call.path.includes('/challenges/widgets/')).length
    const before = puts()
    await runCloudflareSetup(mock, { ...BASE, ...keys, SITE_DOMAIN: 'play.example.com', AM_YES: '1' })
    expect(puts()).toBe(before)
  })

  it('überschreibt fremde Weiterleitungen eines gleichnamigen Tunnels nicht ohne Zustimmung', async () => {
    const headers = { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' }
    const created = await fetch(`${mock.url}/accounts/acc1/cfd_tunnel`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'aboutmee', config_src: 'cloudflare' }),
    })
    const tunnelId = ((await created.json()) as { result: { id: string } }).result.id
    const foreign = { ingress: [{ hostname: 'shop.example.com', service: 'http://shop:80' }, { service: 'http_status:404' }] }
    await fetch(`${mock.url}/accounts/acc1/cfd_tunnel/${tunnelId}/configurations`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ config: foreign }),
    })

    const refused = await runCloudflareSetup(mock, BASE)
    expect(refused.code).not.toBe(0)
    expect(refused.stderr).toContain('shop.example.com')
    expect(mock.state.tunnelConfigs[tunnelId]).toEqual(foreign)
    expect(mock.state.dns).toHaveLength(0)

    const agreed = await runCloudflareSetup(mock, { ...BASE, AM_YES: '1' })
    expect(agreed.code, agreed.stderr).toBe(0)
    expect(mock.state.tunnelConfigs[tunnelId]!.ingress[0]).toEqual({ hostname: 'hosting.example.com', service: 'http://web:3000' })
  })

  it('meldet einen API-Fehler bei der Domain-Suche als solchen — nicht als fehlende Domain', async () => {
    const run = await runCloudflareSetup(mock, BASE, 'falsches-token')
    expect(run.stderr).toContain('Invalid API token')
    expect(run.stderr).not.toContain('keine Domain')
    expect(run.stderr).not.toContain('Abgebrochen in Zeile')
  })

  it('zeigt das Token nie in der Prozessliste', async () => {
    await runCloudflareSetup(mock, BASE)
    // Jeder Aufruf kam mit dem Token an — übergeben wurde es aber nur per Datei.
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
      printf '%s\\n' '# Kommentar' 'SITE_DOMAIN=x.example.com' 'UMAMI_SRC=https://stats.example.com/script.js' 'TUNNEL_TOKEN=geheim' 'MC_UID=1001' '' 'CF_BEACON_TOKEN="abc"' > "$file"
      env_extras "$file"
    `)
    expect(out.trim().split('\n')).toEqual(['UMAMI_SRC=https://stats.example.com/script.js', 'MC_UID=1001', 'CF_BEACON_TOKEN="abc"'])
  })
})
