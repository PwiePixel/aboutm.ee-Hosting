// Nachbau der Docker-Engine auf einem Unix-Socket — nur für Tests des Docker-Treibers.
// Kennt genau die Aufrufe, die lib/runtime/docker.ts benutzt, und schreibt jeden mit.
import fs from 'node:fs'
import http from 'node:http'

function frame(text) {
  const payload = Buffer.from(text)
  const header = Buffer.alloc(8)
  header[0] = 1
  header.writeUInt32BE(payload.length, 4)
  return Buffer.concat([header, payload])
}

export function startDockerMock(socketPath, { createDelayMs = 0, stopDelayMs = 50, players = '' } = {}) {
  const state = {
    calls: [],
    /** name -> { running, spec } */
    containers: new Map(),
    /** name -> Angaben beim Anlegen */
    networks: new Map(),
    createDelayMs,
    players,
    /** Auf true setzen, damit Stopp-Anfragen mit einem Fehler beantwortet werden. */
    failStops: false,
  }

  const server = http.createServer((request, response) => {
    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', async () => {
      const url = new URL(request.url, 'http://docker')
      const path = url.pathname
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined
      state.calls.push(`${request.method} ${path}`)
      const send = (status, payload) => {
        const data = payload === undefined ? '' : Buffer.isBuffer(payload) ? payload : JSON.stringify(payload)
        response.writeHead(status, { 'Content-Type': Buffer.isBuffer(payload) ? 'application/octet-stream' : 'application/json' })
        response.end(data)
      }
      let match

      if (request.method === 'GET' && path.startsWith('/networks/')) {
        const network = state.networks.get(decodeURIComponent(path.slice('/networks/'.length)))
        return network ? send(200, network) : send(404, { message: 'network not found' })
      }
      if (request.method === 'POST' && path === '/networks/create') {
        if (state.networks.has(body.Name)) return send(409, { message: 'network already exists' })
        state.networks.set(body.Name, body)
        return send(201, { Id: body.Name })
      }

      if (request.method === 'POST' && path === '/containers/create') {
        const name = url.searchParams.get('name')
        if (state.createDelayMs) await new Promise((resolve) => setTimeout(resolve, state.createDelayMs))
        state.containers.set(name, { running: false, spec: body })
        return send(201, { Id: name })
      }

      if ((match = path.match(/^\/containers\/([^/]+)\/start$/)) && request.method === 'POST') {
        const container = state.containers.get(match[1])
        if (!container) return send(404, { message: 'No such container' })
        container.running = true
        return send(204)
      }

      if ((match = path.match(/^\/containers\/([^/]+)\/stop$/)) && request.method === 'POST') {
        const container = state.containers.get(match[1])
        if (!container) return send(404, { message: 'No such container' })
        if (state.failStops) return send(500, { message: 'cannot stop container' })
        if (!container.running) return send(304)
        setTimeout(() => {
          container.running = false
        }, stopDelayMs)
        return send(204)
      }

      if ((match = path.match(/^\/containers\/([^/]+)\/json$/)) && request.method === 'GET') {
        const container = state.containers.get(match[1])
        if (!container) return send(404, { message: 'No such container' })
        return send(200, { State: { Running: container.running }, HostConfig: container.spec.HostConfig, Config: { Env: container.spec.Env } })
      }

      if ((match = path.match(/^\/containers\/([^/]+)\/logs$/)) && request.method === 'GET') {
        const container = state.containers.get(match[1])
        if (!container) return send(404, { message: 'No such container' })
        return send(200, frame('[12:00:00 INFO]: Starting minecraft server\n[12:00:01 INFO]: Done (1.000s)! For help, type "help"\n'))
      }

      if ((match = path.match(/^\/containers\/([^/]+)$/)) && request.method === 'DELETE') {
        return state.containers.delete(match[1]) ? send(204) : send(404, { message: 'No such container' })
      }

      if ((match = path.match(/^\/containers\/([^/]+)\/exec$/)) && request.method === 'POST') {
        if (!state.containers.get(match[1])?.running) return send(409, { message: 'container is not running' })
        return send(201, { Id: 'exec1' })
      }
      if (path === '/exec/exec1/start') {
        return send(200, frame(`There are ${state.players ? state.players.split(',').length : 0} of a max of 20 players online: ${state.players}\n`))
      }
      if (path === '/exec/exec1/json') return send(200, { ExitCode: 0 })

      if ((match = path.match(/^\/containers\/([^/]+)\/stats$/))) return send(200, {})

      return send(404, { message: `mock: no route for ${request.method} ${path}` })
    })
  })

  return new Promise((resolve) => {
    fs.rmSync(socketPath, { force: true })
    server.listen(socketPath, () => {
      resolve({ state, close: () => new Promise((done) => server.close(done)) })
    })
  })
}
