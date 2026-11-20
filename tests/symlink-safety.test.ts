import './setup'
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createBackup, deleteBackup, restoreBackup } from '@/lib/backups'
import { config } from '@/lib/config'
import { db } from '@/lib/db'
import { FileError, listDirectory, readTextFile, removeEntry, writeTextFile } from '@/lib/files'
import { backupDir, worldDir } from '@/lib/paths'
import { createWorld, deleteWorld, requestStart, writeManagedFiles, type World } from '@/lib/worlds'

/**
 * Der Inhalt eines Weltordners ist nicht vertrauenswürdig: Der Server darin kann Dateien jederzeit
 * durch Links auf Fremdes ersetzen — auch genau in dem Moment, in dem die Website zugreift.
 * Diese Tests spielen den Angreifer und prüfen, dass nie etwas außerhalb des Ordners gelesen,
 * geschrieben oder gelöscht wird.
 */

const FLIP = path.join(import.meta.dirname, 'helpers', 'flip.cjs')
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const INPUT = { name: 'Angriff', version: '26.3', gamemode: 'survival', difficulty: 'easy', seed: '', whitelist: false }

let counter = 0
function newWorld(): World {
  const id = `usr_angreifer${String(++counter).padStart(7, '0')}`
  db().prepare('INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)').run(id, `${id}@example.com`, 'x', Date.now())
  const world = createWorld(id, INPUT)
  fs.mkdirSync(worldDir(world.id), { recursive: true })
  return world
}

const flippers: ChildProcess[] = []
function flip(dir: string, name: string, real: string, link: string): void {
  flippers.push(spawn(process.execPath, [FLIP, dir, name, real, link]))
}
afterEach(() => {
  for (const child of flippers.splice(0)) child.kill('SIGKILL')
})

describe('Start einer Welt schreibt nie durch Links', () => {
  it('ersetzt einen Link an der Stelle von eula.txt, statt sein Ziel zu überschreiben', async () => {
    const world = newWorld()
    const dir = worldDir(world.id)
    const database = path.join(config.dataDir, 'aboutmee.sqlite')
    const sizeBefore = fs.statSync(database).size
    fs.symlinkSync(database, path.join(dir, 'eula.txt'))

    await requestStart(world)

    expect(fs.statSync(database).size).toBe(sizeBefore)
    expect(db().prepare('SELECT COUNT(*) AS n FROM users').get()).toBeTruthy() // Datenbank lebt
    expect(fs.lstatSync(path.join(dir, 'eula.txt')).isFile()).toBe(true)
    expect(fs.readFileSync(path.join(dir, 'eula.txt'), 'utf8')).toBe('eula=true\n')
    await deleteWorld(world)
  })

  it('legt über einen ins Leere zeigenden Link keine Datei außerhalb an', () => {
    const world = newWorld()
    const dir = worldDir(world.id)
    const outside = path.join(config.dataDir, 'von-aussen-angelegt.conf')
    fs.symlinkSync(outside, path.join(dir, 'server.properties'))

    writeManagedFiles(world)

    expect(fs.existsSync(outside)).toBe(false)
    expect(fs.lstatSync(path.join(dir, 'server.properties')).isFile()).toBe(true)
    expect(fs.readFileSync(path.join(dir, 'server.properties'), 'utf8')).toContain('online-mode=true')
  })

  it('liest fremde Dateien nicht in die server.properties ein', () => {
    const world = newWorld()
    const dir = worldDir(world.id)
    const secret = path.join(config.dataDir, 'geheim.txt')
    fs.writeFileSync(secret, 'passwort=streng-geheim\n')
    fs.symlinkSync(secret, path.join(dir, 'server.properties'))

    writeManagedFiles(world)

    expect(fs.readFileSync(path.join(dir, 'server.properties'), 'utf8')).not.toContain('streng-geheim')
    expect(fs.readFileSync(secret, 'utf8')).toBe('passwort=streng-geheim\n')
  })

  it('bleibt nicht an einer FIFO hängen', () => {
    const world = newWorld()
    const dir = worldDir(world.id)
    const made = spawn('mkfifo', [path.join(dir, 'server.properties')])
    return new Promise<void>((resolve, reject) => {
      made.on('close', () => {
        try {
          writeManagedFiles(world) // würde ohne Schutz für immer blockieren
          expect(fs.lstatSync(path.join(dir, 'server.properties')).isFile()).toBe(true)
          resolve()
        } catch (error) {
          reject(error)
        }
      })
    })
  }, 10_000)
})

describe('Dateimanager verliert den Wettlauf gegen ausgetauschte Links nie', () => {
  it('liest, schreibt und löscht nichts außerhalb des eigenen Weltordners', async () => {
    const attacker = newWorld()
    const victim = newWorld()
    const own = worldDir(attacker.id)
    const other = worldDir(victim.id)

    fs.writeFileSync(path.join(other, 'ops.json'), 'OPFER-GEHEIMNIS')
    fs.mkdirSync(path.join(other, 'plugins'))
    fs.writeFileSync(path.join(other, 'plugins', 'bleibt.txt'), 'bleibt')
    const outside = path.join(config.dataDir, 'ausserhalb.js')
    fs.writeFileSync(outside, 'ORIGINAL')

    // Der Angreifer tauscht „x“ zwischen Ordner und Link auf den Elternordner, „f“ zwischen Datei und Link nach außen.
    fs.mkdirSync(path.join(own, 'xdir'))
    fs.symlinkSync('..', path.join(own, 'xlink'))
    fs.writeFileSync(path.join(own, 'freal'), 'harmlos')
    fs.symlinkSync(outside, path.join(own, 'flink'))
    flip(own, 'x', 'xdir', 'xlink')
    flip(own, 'f', 'freal', 'flink')
    await sleep(300)

    let tries = 0
    let listed = 0
    let read = 0
    const end = Date.now() + 5000
    while (Date.now() < end) {
      tries++
      try {
        if (listDirectory(attacker.id, 'x').some((entry) => entry.name === victim.id)) listed++
      } catch {}
      try {
        if (readTextFile(attacker.id, `x/${victim.id}/ops.json`).includes('OPFER')) read++
      } catch {}
      try {
        if (readTextFile(attacker.id, 'f') !== 'harmlos' && readTextFile(attacker.id, 'f').includes('ORIGINAL')) read++
      } catch {}
      try {
        writeTextFile(attacker.id, 'f', 'ÜBERNOMMEN', { create: false })
      } catch {}
      try {
        removeEntry(attacker.id, `x/${victim.id}/plugins`)
      } catch {}
      if (tries % 100 === 0) await sleep(0)
    }

    expect(tries).toBeGreaterThan(500)
    expect(listed, 'fremder Ordner wurde aufgelistet').toBe(0)
    expect(read, 'fremde Datei wurde gelesen').toBe(0)
    expect(fs.readFileSync(outside, 'utf8'), 'Datei außerhalb wurde überschrieben').toBe('ORIGINAL')
    expect(fs.existsSync(path.join(other, 'plugins', 'bleibt.txt')), 'fremder Ordner wurde gelöscht').toBe(true)
    expect(fs.readFileSync(path.join(other, 'ops.json'), 'utf8')).toBe('OPFER-GEHEIMNIS')
  }, 30_000)

  it('zeigt Links im Dateimanager gar nicht erst an und öffnet sie nicht', () => {
    const world = newWorld()
    const dir = worldDir(world.id)
    fs.writeFileSync(path.join(config.dataDir, 'fremd.txt'), 'fremd')
    fs.symlinkSync(path.join(config.dataDir, 'fremd.txt'), path.join(dir, 'link.txt'))
    fs.symlinkSync(config.dataDir, path.join(dir, 'linkordner'))
    expect(listDirectory(world.id, '').map((entry) => entry.name)).toEqual([])
    expect(() => readTextFile(world.id, 'link.txt')).toThrow(FileError)
    expect(() => listDirectory(world.id, 'linkordner')).toThrow(FileError)
    expect(() => writeTextFile(world.id, 'link.txt', 'x', { create: false })).toThrow(FileError)
    expect(() => writeTextFile(world.id, 'link.txt', 'x', { create: true })).toThrow(FileError)
    removeEntry(world.id, 'linkordner') // entfernt den Link, nicht sein Ziel
    expect(fs.existsSync(path.join(config.dataDir, 'aboutmee.sqlite'))).toBe(true)
  })
})

describe('Backups nehmen nichts von außerhalb mit', () => {
  it('kopiert einen untergeschobenen Link nie als Dateiinhalt', async () => {
    const world = newWorld()
    const dir = worldDir(world.id)
    const secret = path.join(config.dataDir, 'datenbank-geheim.bin')
    fs.writeFileSync(secret, 'STRENG-GEHEIMER-INHALT')
    fs.writeFileSync(path.join(dir, 'lreal'), 'harmlos')
    fs.symlinkSync(secret, path.join(dir, 'llink'))
    fs.mkdirSync(path.join(dir, 'dreal'))
    fs.symlinkSync(config.dataDir, path.join(dir, 'dlink'))
    for (let i = 0; i < 150; i++) fs.writeFileSync(path.join(dir, `ballast-${i}`), 'x'.repeat(4096))
    flip(dir, 'leak', 'lreal', 'llink')
    flip(dir, 'ordner', 'dreal', 'dlink')
    await sleep(300)

    let leaked = 0
    for (let i = 0; i < 40; i++) {
      const backup = await createBackup(world, 'manual')
      const root = backupDir(world.id, backup.id)
      for (const file of fs.readdirSync(root, { recursive: true }) as string[]) {
        const full = path.join(root, file)
        const stat = fs.lstatSync(full)
        expect(stat.isSymbolicLink(), `Link im Backup: ${file}`).toBe(false)
        if (stat.isFile() && stat.size < 200 && fs.readFileSync(full, 'utf8').includes('STRENG-GEHEIM')) leaked++
        if (file.includes('aboutmee.sqlite')) leaked++
      }
      deleteBackup(world, backup.id)
    }
    expect(leaked).toBe(0)
  }, 60_000)

  it('stellt ein Backup wieder her und lässt dabei feste Links aus', async () => {
    const world = newWorld()
    const dir = worldDir(world.id)
    fs.mkdirSync(path.join(dir, 'world'))
    fs.writeFileSync(path.join(dir, 'world', 'level.dat'), Buffer.from([1, 2, 0, 3]))
    fs.writeFileSync(path.join(dir, 'server.properties'), 'motd=vorher\n')
    fs.symlinkSync(config.dataDir, path.join(dir, 'raus'))

    const backup = await createBackup(world, 'manual')
    fs.writeFileSync(path.join(dir, 'server.properties'), 'motd=nachher\n')
    fs.rmSync(path.join(dir, 'world'), { recursive: true })

    await restoreBackup(world, backup.id)
    expect(fs.readFileSync(path.join(dir, 'server.properties'), 'utf8')).toBe('motd=vorher\n')
    expect([...fs.readFileSync(path.join(dir, 'world', 'level.dat'))]).toEqual([1, 2, 0, 3])
    expect(fs.existsSync(path.join(dir, 'raus'))).toBe(false)
  })
})

describe('Löschen einer Welt', () => {
  it('entfernt den Ordner, ohne Links nach außen zu folgen', async () => {
    const world = newWorld()
    const dir = worldDir(world.id)
    const keep = path.join(config.dataDir, 'muss-bleiben')
    fs.mkdirSync(keep)
    fs.writeFileSync(path.join(keep, 'wichtig.txt'), 'wichtig')
    fs.symlinkSync(keep, path.join(dir, 'link'))
    await deleteWorld(world)
    expect(fs.existsSync(dir)).toBe(false)
    expect(fs.readFileSync(path.join(keep, 'wichtig.txt'), 'utf8')).toBe('wichtig')
  })
})
