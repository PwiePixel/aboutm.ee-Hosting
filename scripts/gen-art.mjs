// Erzeugt die Block-Landschaften unter public/art/ — eigene Grafiken, keine Spiel-Screenshots.
// Aufruf: node scripts/gen-art.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'art')
const PX = 4

function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hex(color) {
  const n = Number.parseInt(color.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function mix(a, b, t) {
  const [ar, ag, ab] = hex(a)
  const [br, bg, bb] = hex(b)
  const c = (x, y) => Math.round(x + (y - x) * t)
  return `#${[c(ar, br), c(ag, bg), c(ab, bb)].map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

function noise1d(random, points) {
  const values = Array.from({ length: points + 2 }, () => random())
  return (x) => {
    const scaled = x * points
    const i = Math.floor(scaled)
    const f = scaled - i
    const s = f * f * (3 - 2 * f)
    return values[i] + (values[i + 1] - values[i]) * s
  }
}

const THEMES = {
  day: {
    sky: ['#3d86d8', '#6fb0ea', '#b9dcf5', '#e9f4fb'],
    orb: '#fff6c9',
    halo: '#fffbe6',
    cloud: '#ffffff',
    cloudOpacity: 0.92,
    far: '#7fa9a6',
    mid: '#3f8a4d',
    grass: '#5fb646',
    grassDark: '#4c9c3a',
    grassLight: '#7fd05f',
    dirt: '#7a5236',
    dirtDark: '#64422b',
    leaves: '#2f7a37',
    leavesLight: '#44994a',
    trunk: '#5a3d26',
    water: '#3f7fd0',
    waterLight: '#79aeea',
    stars: false,
  },
  dusk: {
    sky: ['#2c2a5e', '#7a4a86', '#e0795f', '#fbc37a'],
    orb: '#ffe2a3',
    halo: '#ffd08a',
    cloud: '#ffd9c2',
    cloudOpacity: 0.8,
    far: '#6a5a7e',
    mid: '#2f6046',
    grass: '#4a9443',
    grassDark: '#3b7c38',
    grassLight: '#64ad52',
    dirt: '#6a4631',
    dirtDark: '#553726',
    leaves: '#265f33',
    leavesLight: '#357a40',
    trunk: '#4a3221',
    water: '#5a5fa8',
    waterLight: '#e39a86',
    stars: false,
  },
  night: {
    sky: ['#070b1c', '#0e1734', '#1a2a55', '#2a3f73'],
    orb: '#e9eefc',
    halo: '#aebbe6',
    cloud: '#5b6a99',
    cloudOpacity: 0.55,
    far: '#22305a',
    mid: '#173a3a',
    grass: '#235c3f',
    grassDark: '#1b4a34',
    grassLight: '#2f7450',
    dirt: '#3a2a27',
    dirtDark: '#2d201e',
    leaves: '#143d2c',
    leavesLight: '#1d5239',
    trunk: '#2a1e19',
    water: '#1c2f6b',
    waterLight: '#4a63b3',
    stars: true,
  },
}

function landscape({ seed, theme: themeName, width, height }) {
  const theme = THEMES[themeName]
  const random = mulberry32(seed)
  const columns = Math.ceil(width / PX)
  const out = []
  const rect = (x, y, w, h, fill, opacity) =>
    out.push(
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"${opacity === undefined ? '' : ` opacity="${opacity}"`}/>`,
    )
  const snap = (value) => Math.round(value / PX) * PX

  // Himmel in Streifen
  const bands = Math.ceil((height * 0.8) / (PX * 2))
  for (let i = 0; i < bands; i++) {
    const t = i / (bands - 1)
    const stops = theme.sky
    const position = t * (stops.length - 1)
    const index = Math.min(stops.length - 2, Math.floor(position))
    rect(0, i * PX * 2, width, PX * 2, mix(stops[index], stops[index + 1], position - index))
  }
  rect(0, bands * PX * 2, width, height - bands * PX * 2, theme.sky.at(-1))

  if (theme.stars) {
    for (let i = 0; i < 70; i++) {
      rect(snap(random() * width), snap(random() * height * 0.55), PX / 2, PX / 2, '#ffffff', 0.35 + random() * 0.6)
    }
  }

  // Sonne oder Mond
  const orb = snap(height * 0.14)
  const orbX = snap(width * (0.58 + random() * 0.22))
  const orbY = snap(height * (themeName === 'dusk' ? 0.36 : 0.12))
  rect(orbX - PX * 2, orbY - PX * 2, orb + PX * 4, orb + PX * 4, theme.halo, 0.25)
  rect(orbX, orbY, orb, orb, theme.orb)

  // Wolken
  const clouds = 5 + Math.floor(random() * 4)
  for (let i = 0; i < clouds; i++) {
    const x = snap(random() * width)
    const y = snap(height * (0.06 + random() * 0.3))
    const w = snap(40 + random() * 70)
    rect(x, y, w, PX * 2, theme.cloud, theme.cloudOpacity)
    rect(x + PX * 3, y - PX * 2, snap(w * 0.55), PX * 2, theme.cloud, theme.cloudOpacity)
    if (random() > 0.5) rect(x - PX * 2, y + PX * 2, snap(w * 0.5), PX, theme.cloud, theme.cloudOpacity * 0.7)
  }

  // Eine Geländeschicht aus zusammengefassten Spalten
  const layer = (heightAt, paint) => {
    let start = 0
    let current = heightAt(0)
    for (let c = 1; c <= columns; c++) {
      const next = c < columns ? heightAt(c) : Number.NaN
      if (next !== current) {
        paint(start * PX, current, (c - start) * PX)
        start = c
        current = next
      }
    }
  }

  const farNoise = noise1d(random, 5)
  const farAt = (c) => snap(height * (0.42 + farNoise(c / columns) * 0.2))
  layer(farAt, (x, y, w) => rect(x, y, w, height - y, theme.far))

  const midA = noise1d(random, 6)
  const midB = noise1d(random, 18)
  const midAt = (c) => snap(height * (0.52 + midA(c / columns) * 0.18 + midB(c / columns) * 0.04))
  layer(midAt, (x, y, w) => {
    rect(x, y, w, height - y, theme.mid)
    rect(x, y, w, PX, mix(theme.mid, theme.grassLight, 0.35))
  })

  const frontA = noise1d(random, 4)
  const frontB = noise1d(random, 14)
  const waterLevel = snap(height * 0.8)
  const frontAt = (c) => snap(height * (0.64 + frontA(c / columns) * 0.2 + frontB(c / columns) * 0.05))

  // Bäume auf der mittleren Schicht
  const tree = (x, ground, scale) => {
    const trunkHeight = PX * (2 + scale)
    rect(x, ground - trunkHeight, PX, trunkHeight, theme.trunk)
    const size = PX * (3 + scale)
    rect(x - size / 2 + PX / 2 - PX / 2, ground - trunkHeight - size + PX, size, size - PX, theme.leaves)
    rect(x - size / 2 + PX, ground - trunkHeight - size, size - PX * 2, PX, theme.leaves)
    rect(x - size / 2 + PX, ground - trunkHeight - size + PX, PX, PX, theme.leavesLight)
    rect(x + PX, ground - trunkHeight - size / 2, PX, PX, theme.leavesLight)
  }
  for (let c = 3; c < columns - 3; c += 4 + Math.floor(random() * 9)) {
    if (random() > 0.35) tree(c * PX, midAt(c), random() > 0.6 ? 2 : 1)
  }

  // Wasser hinter dem Vordergrund
  rect(0, waterLevel, width, height - waterLevel, theme.water)
  for (let i = 0; i < 16; i++) {
    rect(snap(random() * width), waterLevel + PX + snap(random() * height * 0.12), snap(12 + random() * 28), PX / 2, theme.waterLight, 0.6)
  }

  // Vordergrund: Gras auf Erde
  layer(frontAt, (x, y, w) => {
    if (y >= waterLevel) return
    rect(x, y + PX, w, height - y - PX, theme.dirt)
    rect(x, y, w, PX, theme.grass)
    rect(x, y + PX, w, PX / 2, theme.grassDark)
  })
  for (let c = 0; c < columns; c++) {
    const y = frontAt(c)
    if (y >= waterLevel) continue
    const x = c * PX
    if (random() > 0.55) rect(x, y, PX / 2, PX / 2, theme.grassLight)
    if (random() > 0.6) rect(x + PX / 2, y + PX * (2 + Math.floor(random() * 5)), PX / 2, PX / 2, theme.dirtDark)
    if (random() > 0.93) rect(x, y - PX / 2, PX / 2, PX / 2, random() > 0.5 ? '#f4d35e' : '#ee6c6c')
    if (random() > 0.9) tree(x, y, 2)
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" shape-rendering="crispEdges" role="img">${out.join('')}</svg>\n`
}

fs.mkdirSync(OUT, { recursive: true })
const files = [
  ['hero.svg', { seed: 20261120, theme: 'day', width: 960, height: 420 }],
  ['welt-1.svg', { seed: 11, theme: 'day', width: 960, height: 320 }],
  ['welt-2.svg', { seed: 27, theme: 'dusk', width: 960, height: 320 }],
  ['welt-3.svg', { seed: 43, theme: 'night', width: 960, height: 320 }],
  ['welt-4.svg', { seed: 58, theme: 'day', width: 960, height: 320 }],
  ['welt-5.svg', { seed: 72, theme: 'dusk', width: 960, height: 320 }],
  ['welt-6.svg', { seed: 96, theme: 'night', width: 960, height: 320 }],
]
for (const [name, options] of files) {
  const svg = landscape(options)
  fs.writeFileSync(path.join(OUT, name), svg)
  console.log(`${name}: ${(svg.length / 1024).toFixed(1)} KiB`)
}
