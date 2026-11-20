/**
 * Minecraft-Versionen, die sich beim Erstellen auswählen lassen — neueste zuerst.
 * `build` ist der festgelegte Paper-Build (Stand der Paper-Download-API am 20.11.2026).
 * Beim Aktualisieren: https://fill.papermc.io/v3/projects/paper/versions/<version>/builds/latest
 */
export type MinecraftVersion = {
  id: string
  build: number
  java: number
  recommended?: boolean
}

export const VERSIONS: readonly MinecraftVersion[] = [
  { id: '26.3', build: 256, java: 25, recommended: true },
  { id: '26.2', build: 135, java: 25 },
  { id: '26.1.2', build: 74, java: 25 },
  { id: '1.21.11', build: 132, java: 21 },
  { id: '1.21.1', build: 133, java: 21 },
  { id: '1.20.6', build: 151, java: 21 },
]

export const RECOMMENDED_VERSION = VERSIONS.find((v) => v.recommended) ?? VERSIONS[0]!

export function findVersion(id: string): MinecraftVersion | undefined {
  return VERSIONS.find((v) => v.id === id)
}

/** Versionen, die neuer sind als `id` — ein Wechsel geht nur nach oben. */
export function newerVersions(id: string): MinecraftVersion[] {
  const index = VERSIONS.findIndex((v) => v.id === id)
  if (index === -1) return [...VERSIONS]
  return VERSIONS.slice(0, index)
}

export const GAMEMODES = [
  { id: 'survival', label: 'Überleben' },
  { id: 'creative', label: 'Kreativ' },
  { id: 'adventure', label: 'Abenteuer' },
] as const

export const DIFFICULTIES = [
  { id: 'peaceful', label: 'Friedlich' },
  { id: 'easy', label: 'Einfach' },
  { id: 'normal', label: 'Normal' },
  { id: 'hard', label: 'Schwer' },
] as const

export type Gamemode = (typeof GAMEMODES)[number]['id']
export type Difficulty = (typeof DIFFICULTIES)[number]['id']

export function gamemodeLabel(id: string): string {
  return GAMEMODES.find((g) => g.id === id)?.label ?? id
}

export function difficultyLabel(id: string): string {
  return DIFFICULTIES.find((d) => d.id === id)?.label ?? id
}
