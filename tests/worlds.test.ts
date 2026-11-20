import './setup'
import { beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { hashPassword, verifyPassword } from '@/lib/password'
import { runtime } from '@/lib/runtime'
import { setLimit } from '@/lib/settings'
import {
  WorldError,
  createWorld,
  getWorld,
  queuePosition,
  requestStart,
  requestStop,
  slotsFree,
  tick,
  type World,
} from '@/lib/worlds'

const INPUT = { name: 'Test', version: '26.3', gamemode: 'survival', difficulty: 'easy', seed: '', whitelist: false }

function user(id: string): string {
  db().prepare('INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)').run(id, `${id}@example.com`, 'x', Date.now())
  return id
}

const fresh = (world: World) => getWorld(world.user_id, world.id)!

/** Lässt den Taktgeber laufen, bis die Welt den gewünschten Status hat. */
async function until(world: World, status: string, timeoutMs = 15_000): Promise<void> {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    await tick()
    if (fresh(world).status === status) return
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`Status ${status} nicht erreicht — ist ${fresh(world).status}`)
}

describe('Welten', () => {
  let anna: string
  let ben: string
  let cara: string

  beforeAll(() => {
    anna = user('usr_annaannaannaanna')
    ben = user('usr_benbenbenbenbenb')
    cara = user('usr_caracaracaracara')
  })

  it('zeigt eine Welt nur dem Konto, dem sie gehört', () => {
    const world = createWorld(anna, INPUT)
    expect(getWorld(anna, world.id)?.id).toBe(world.id)
    expect(getWorld(ben, world.id)).toBeUndefined()
  })

  it('begrenzt die Zahl der Welten pro Konto', () => {
    createWorld(anna, INPUT)
    createWorld(anna, INPUT)
    expect(() => createWorld(anna, INPUT)).toThrow(WorldError)
  })

  it('lässt pro Konto nur eine Welt gleichzeitig laufen', async () => {
    const [first, second] = [createWorld(ben, INPUT), createWorld(ben, INPUT)]
    expect(await requestStart(first)).toBe('starting')
    await expect(requestStart(second)).rejects.toThrow(WorldError)
    await requestStop(first)
    await until(first, 'paused')
  }, 30_000)

  it('stellt Starts in die Warteschlange, wenn alle Plätze belegt sind, und rückt nach', async () => {
    setLimit('totalSlots', 1)
    const mine = createWorld(ben, INPUT)
    const theirs = createWorld(cara, INPUT)

    expect(await requestStart(mine)).toBe('starting')
    expect(slotsFree()).toBe(0)
    expect(await requestStart(theirs)).toBe('queued')
    expect(queuePosition(fresh(theirs))).toBe(1)

    await until(mine, 'online')
    expect(fresh(theirs).status).toBe('queued')

    await requestStop(mine)
    await until(mine, 'paused')
    await until(theirs, 'online')

    await requestStop(theirs)
    await until(theirs, 'paused')
    setLimit('totalSlots', 2)
  }, 60_000)

  it('pausiert eine Welt, in der zu lange niemand spielt', async () => {
    const world = createWorld(cara, INPUT)
    await requestStart(world)
    await until(world, 'online')
    // So tun, als sei seit über 30 Minuten niemand da gewesen.
    db().prepare('UPDATE worlds SET last_active_at = ? WHERE id = ?').run(Date.now() - 31 * 60_000, world.id)
    await tick()
    expect(fresh(world).status).toBe('stopping')
    await until(world, 'paused')
    expect(fresh(world).pause_reason).toBe('idle')
    expect(await runtime().state(fresh(world))).toBe('stopped')
  }, 60_000)
})

describe('Passwörter', () => {
  it('werden gehasht und geprüft', async () => {
    const hash = await hashPassword('ein-langes-passwort-42')
    expect(hash).not.toContain('ein-langes-passwort-42')
    expect(await verifyPassword('ein-langes-passwort-42', hash)).toBe(true)
    expect(await verifyPassword('ein-langes-passwort-43', hash)).toBe(false)
    expect(await verifyPassword('egal', 'kaputt')).toBe(false)
  })
})
