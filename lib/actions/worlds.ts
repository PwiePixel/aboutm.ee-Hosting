'use server'

import { revalidatePath } from 'next/cache'
import { notFound, redirect } from 'next/navigation'
import { requireUser } from '../auth'
import { allowAttempt } from '../ratelimit'
import {
  SEED_MAX,
  cleanCommand,
  cleanText,
  isDifficulty,
  isGamemode,
  isPlayerName,
  isVersion,
  worldNameProblem,
} from '../validation'
import {
  WorldError,
  addWhitelistPlayer,
  changeVersion,
  createWorld,
  deleteWorld,
  getWorld,
  removeWhitelistPlayer,
  renameWorld,
  requestRestart,
  requestStart,
  requestStop,
  sendCommand,
  setWhitelistEnabled,
  updateGameSettings,
  type World,
} from '../worlds'
import type { ActionState } from './state'

const UNEXPECTED = 'Das hat nicht geklappt. Versuch es gleich noch einmal.'

async function owned(worldId: unknown): Promise<World> {
  const user = await requireUser()
  if (typeof worldId !== 'string') notFound()
  const world = getWorld(user.id, worldId)
  if (!world) notFound()
  return world
}

function refresh(world: World): void {
  revalidatePath(`/app/welten/${world.id}`, 'layout')
  revalidatePath('/app')
}

/** Führt eine Änderung aus und übersetzt erwartbare Fehler in eine Meldung. */
async function attempt(world: World, run: () => Promise<void> | void, ok?: string): Promise<ActionState> {
  try {
    await run()
  } catch (error) {
    if (error instanceof WorldError) return { error: error.message }
    console.error(`[aboutm.ee] Aktion für ${world.id}:`, error)
    return { error: UNEXPECTED }
  }
  refresh(world)
  return ok ? { ok } : {}
}

export async function createWorldAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser()
  const name = cleanText(formData.get('name'))
  const version = formData.get('version')
  const gamemode = formData.get('gamemode')
  const difficulty = formData.get('difficulty')
  const seed = cleanText(formData.get('seed')).slice(0, SEED_MAX)
  const whitelist = formData.get('whitelist') === 'on'
  const values = {
    name,
    version: String(version ?? ''),
    gamemode: String(gamemode ?? ''),
    difficulty: String(difficulty ?? ''),
    seed,
    whitelist: whitelist ? 'on' : '',
  }

  const problem = worldNameProblem(name)
  if (problem) return { error: problem, values }
  if (!isVersion(version)) return { error: 'Wähle eine Minecraft-Version.', values }
  if (!isGamemode(gamemode)) return { error: 'Wähle einen Spielmodus.', values }
  if (!isDifficulty(difficulty)) return { error: 'Wähle eine Schwierigkeit.', values }
  if (!allowAttempt(`create-world:${user.id}`, 10, 60 * 60 * 1000)) {
    return { error: 'Du hast gerade viele Welten angelegt. Versuch es später noch einmal.', values }
  }

  let world: World
  try {
    world = createWorld(user.id, { name, version, gamemode, difficulty, seed, whitelist })
  } catch (error) {
    if (error instanceof WorldError) return { error: error.message, values }
    console.error('[aboutm.ee] Welt anlegen:', error)
    return { error: UNEXPECTED, values }
  }
  revalidatePath('/app')
  redirect(`/app/welten/${world.id}?neu=1`)
}

export async function startWorldAction(worldId: string): Promise<ActionState> {
  const world = await owned(worldId)
  return attempt(world, async () => {
    await requestStart(world)
  })
}

export async function stopWorldAction(worldId: string): Promise<ActionState> {
  const world = await owned(worldId)
  return attempt(world, () => requestStop(world))
}

export async function restartWorldAction(worldId: string): Promise<ActionState> {
  const world = await owned(worldId)
  return attempt(world, () => requestRestart(world))
}

export async function sendCommandAction(worldId: string, command: string): Promise<ActionState> {
  const world = await owned(worldId)
  const cleaned = cleanCommand(command)
  if (!cleaned) return { error: 'Gib einen Befehl ein.' }
  if (!allowAttempt(`command:${world.user_id}`, 40, 60 * 1000)) {
    return { error: 'Das waren viele Befehle auf einmal. Warte kurz.' }
  }
  return attempt(world, () => sendCommand(world, cleaned))
}

export async function renameWorldAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const world = await owned(formData.get('worldId'))
  const name = cleanText(formData.get('name'))
  const problem = worldNameProblem(name)
  if (problem) return { error: problem }
  return attempt(world, () => renameWorld(world, name), 'Gespeichert.')
}

export async function updateGameSettingsAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const world = await owned(formData.get('worldId'))
  const gamemode = formData.get('gamemode')
  const difficulty = formData.get('difficulty')
  if (!isGamemode(gamemode) || !isDifficulty(difficulty)) return { error: 'Ungültige Auswahl.' }
  return attempt(world, () => updateGameSettings(world, gamemode, difficulty), 'Gespeichert und im Spiel übernommen.')
}

export async function setWhitelistAction(worldId: string, enabled: boolean): Promise<ActionState> {
  const world = await owned(worldId)
  return attempt(world, () => setWhitelistEnabled(world, enabled === true))
}

export async function addWhitelistPlayerAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const world = await owned(formData.get('worldId'))
  const player = String(formData.get('player') ?? '').trim()
  if (!isPlayerName(player)) {
    return { error: 'Ein Minecraft-Name hat 3 bis 16 Zeichen: Buchstaben, Ziffern und Unterstrich.' }
  }
  return attempt(world, () => addWhitelistPlayer(world, player))
}

export async function removeWhitelistPlayerAction(worldId: string, player: string): Promise<ActionState> {
  const world = await owned(worldId)
  if (!isPlayerName(player)) return { error: 'Ungültiger Name.' }
  return attempt(world, () => removeWhitelistPlayer(world, player))
}

export async function changeVersionAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const world = await owned(formData.get('worldId'))
  const version = formData.get('version')
  if (!isVersion(version)) return { error: 'Wähle eine Version.' }
  return attempt(world, () => changeVersion(world, version), `Deine Welt läuft ab dem nächsten Start mit Minecraft ${version}.`)
}

export async function deleteWorldAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const world = await owned(formData.get('worldId'))
  const confirmation = cleanText(formData.get('confirm'))
  if (confirmation !== world.name) return { error: 'Der Name stimmt nicht überein.' }
  try {
    await deleteWorld(world)
  } catch (error) {
    console.error(`[aboutm.ee] Welt ${world.id} löschen:`, error)
    return { error: UNEXPECTED }
  }
  revalidatePath('/app')
  redirect('/app?geloescht=1')
}
