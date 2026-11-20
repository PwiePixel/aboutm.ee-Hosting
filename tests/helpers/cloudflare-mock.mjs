// Nachbau der Cloudflare-API-Aufrufe, die install.sh benutzt — nur für Tests.
// Hält Zonen, DNS-Einträge, Tunnel und Turnstile-Widgets im Speicher und schreibt jeden
// Aufruf mit, damit ein Test prüfen kann, was das Skript wirklich getan hat.
import http from 'node:http'

export function startCloudflareMock({ token = 'test-token', zones = ['example.com'], accountToken = false } = {}) {
  const state = {
    calls: [],
    zones: zones.map((name, index) => ({ id: `zone${index + 1}`, name, account: { id: 'acc1', name: 'Test' } })),
    dns: [],
    tunnels: [],
    tunnelConfigs: {},
    widgets: [],
    nextId: 1,
  }
  const id = (prefix) => `${prefix}${state.nextId++}`
  const ok = (result) => ({ success: true, errors: [], messages: [], result })
  const fail = (status, message) => ({ status, body: { success: false, errors: [{ code: 1000, message }], messages: [], result: null } })

  function route(method, url, body) {
    const path = url.pathname
    let match

    if (method === 'GET' && path === '/user/tokens/verify') {
      // Konto-Tokens kennen diesen Aufruf nicht.
      return accountToken ? fail(401, 'Invalid API Token') : ok({ id: 'tok1', status: 'active' })
    }

    if (method === 'GET' && path === '/zones') {
      const name = url.searchParams.get('name')
      return ok(state.zones.filter((zone) => !name || zone.name === name))
    }

    if ((match = path.match(/^\/zones\/([^/]+)\/dns_records$/))) {
      const zone = state.zones.find((entry) => entry.id === match[1])
      if (!zone) return fail(404, 'Zone not found')
      if (method === 'GET') {
        const name = url.searchParams.get('name.exact') ?? url.searchParams.get('name')
        const type = url.searchParams.get('type')
        return ok(state.dns.filter((r) => r.zone === zone.id && (!name || r.name === name) && (!type || r.type === type)))
      }
      if (method === 'POST') {
        const sameName = state.dns.filter((r) => r.zone === zone.id && r.name === body.name)
        // Wie bei Cloudflare: ein CNAME verträgt sich mit keinem anderen Eintrag desselben Namens.
        if (sameName.some((r) => r.type === 'CNAME' || body.type === 'CNAME')) {
          return fail(400, 'A record with the same name already exists (CNAME conflict).')
        }
        if (sameName.some((r) => r.type === body.type && r.content === body.content)) {
          return fail(400, 'An identical record already exists.')
        }
        const record = { id: id('rec'), zone: zone.id, ...body }
        state.dns.push(record)
        return ok(record)
      }
    }

    if ((match = path.match(/^\/zones\/([^/]+)\/dns_records\/([^/]+)$/)) && method === 'DELETE') {
      const before = state.dns.length
      state.dns = state.dns.filter((r) => !(r.zone === match[1] && r.id === match[2]))
      return before === state.dns.length ? fail(404, 'Record not found') : ok({ id: match[2] })
    }

    if ((match = path.match(/^\/accounts\/([^/]+)\/cfd_tunnel$/))) {
      if (method === 'GET') {
        const name = url.searchParams.get('name')
        // Bewusst großzügig (Teilstring): das Skript muss selbst genau vergleichen.
        return ok(state.tunnels.filter((t) => !t.deleted_at && (!name || t.name.includes(name))))
      }
      if (method === 'POST') {
        if (!body.name) return fail(400, 'name is required')
        if (state.tunnels.some((t) => t.name === body.name)) return fail(409, 'You already have a tunnel with this name')
        const tunnel = { id: `0000-${id('tun')}`, name: body.name, config_src: body.config_src, deleted_at: null }
        state.tunnels.push(tunnel)
        return ok(tunnel)
      }
    }

    if ((match = path.match(/^\/accounts\/([^/]+)\/cfd_tunnel\/([^/]+)$/)) && method === 'GET') {
      const tunnel = state.tunnels.find((t) => t.id === match[2])
      return tunnel ? ok({ ...tunnel, status: 'healthy' }) : fail(404, 'Tunnel not found')
    }

    if ((match = path.match(/^\/accounts\/([^/]+)\/cfd_tunnel\/([^/]+)\/token$/)) && method === 'GET') {
      return state.tunnels.some((t) => t.id === match[2]) ? ok(`tunneltoken.${match[2]}`) : fail(404, 'Tunnel not found')
    }

    if ((match = path.match(/^\/accounts\/([^/]+)\/cfd_tunnel\/([^/]+)\/configurations$/)) && method === 'GET') {
      if (!state.tunnels.some((t) => t.id === match[2])) return fail(404, 'Tunnel not found')
      return ok({ tunnel_id: match[2], config: state.tunnelConfigs[match[2]] ?? null })
    }

    if ((match = path.match(/^\/accounts\/([^/]+)\/cfd_tunnel\/([^/]+)\/configurations$/)) && method === 'PUT') {
      if (!state.tunnels.some((t) => t.id === match[2])) return fail(404, 'Tunnel not found')
      state.tunnelConfigs[match[2]] = body.config
      return ok({ tunnel_id: match[2], config: body.config })
    }

    if ((match = path.match(/^\/accounts\/([^/]+)\/challenges\/widgets$/)) && method === 'POST') {
      // Wie bei Cloudflare: Konto-Tokens dürfen Turnstile nicht verwalten.
      if (accountToken) return fail(403, 'Authentication error')
      if (!body.name || !Array.isArray(body.domains) || !body.mode) return fail(400, 'name, domains and mode are required')
      const widget = { sitekey: `0x4AAA${id('key')}`, secret: `0x4BBB${id('sec')}`, ...body }
      state.widgets.push(widget)
      return ok(widget)
    }

    if ((match = path.match(/^\/accounts\/([^/]+)\/challenges\/widgets\/([^/]+)$/))) {
      if (accountToken) return fail(403, 'Authentication error')
      const widget = state.widgets.find((entry) => entry.sitekey === match[2])
      if (!widget) return fail(404, 'Widget not found')
      if (method === 'GET') return ok(widget)
      if (method === 'PUT') {
        if (!body.name || !Array.isArray(body.domains) || !body.mode) return fail(400, 'name, domains and mode are required')
        Object.assign(widget, { name: body.name, domains: body.domains, mode: body.mode })
        return ok(widget)
      }
    }

    return fail(404, `No route for ${method} ${path}`)
  }

  const server = http.createServer((request, response) => {
    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => {
      const url = new URL(request.url, 'http://mock')
      const text = Buffer.concat(chunks).toString('utf8')
      const body = text ? JSON.parse(text) : undefined
      state.calls.push({ method: request.method, path: url.pathname, query: url.search, body })

      let result
      if (request.headers.authorization !== `Bearer ${token}`) result = fail(403, 'Invalid API token')
      else result = route(request.method, url, body)

      const status = result.status ?? 200
      response.writeHead(status, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify(result.body ?? result))
    })
  })

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ url: `http://127.0.0.1:${server.address().port}`, state, close: () => new Promise((done) => server.close(done)) })
    })
  })
}
