import './setup'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { FileError, createDirectory, listDirectory, readTextFile, removeEntry, writeTextFile } from '@/lib/files'
import { worldDir } from '@/lib/paths'

const WORLD = 'welt_testdateien0001'

describe('Dateizugriff bleibt im Weltordner', () => {
  it('lehnt Pfade ab, die nach außen führen', () => {
    for (const bad of ['../geheim', 'a/../../b', '/etc/passwd', 'a\\b', 'ordner/..', '.', 'a\0b']) {
      expect(() => listDirectory(WORLD, bad), bad).toThrow(FileError)
      expect(() => readTextFile(WORLD, bad), bad).toThrow(FileError)
      expect(() => writeTextFile(WORLD, bad, 'x', { create: true }), bad).toThrow(FileError)
    }
  })

  it('folgt keinen symbolischen Links', () => {
    const root = worldDir(WORLD)
    fs.mkdirSync(root, { recursive: true })
    const outside = path.join(root, '..', 'draussen.txt')
    fs.writeFileSync(outside, 'geheim')
    fs.symlinkSync(outside, path.join(root, 'link.txt'))
    fs.symlinkSync(path.dirname(root), path.join(root, 'linkordner'))

    expect(() => readTextFile(WORLD, 'link.txt')).toThrow(FileError)
    expect(() => listDirectory(WORLD, 'linkordner')).toThrow(FileError)
    expect(() => writeTextFile(WORLD, 'link.txt', 'überschrieben', { create: false })).toThrow(FileError)
    expect(fs.readFileSync(outside, 'utf8')).toBe('geheim')
    expect(listDirectory(WORLD, '').map((entry) => entry.name)).not.toContain('link.txt')
  })

  it('legt an, liest, ändert und löscht', () => {
    createDirectory(WORLD, 'plugins')
    writeTextFile(WORLD, 'plugins/notiz.txt', 'hallo', { create: true })
    expect(readTextFile(WORLD, 'plugins/notiz.txt')).toBe('hallo')
    writeTextFile(WORLD, 'plugins/notiz.txt', 'neu', { create: false })
    expect(readTextFile(WORLD, 'plugins/notiz.txt')).toBe('neu')
    expect(listDirectory(WORLD, 'plugins').map((entry) => entry.name)).toEqual(['notiz.txt'])
    removeEntry(WORLD, 'plugins')
    expect(() => listDirectory(WORLD, 'plugins')).toThrow(FileError)
    expect(() => removeEntry(WORLD, '')).toThrow(FileError)
  })

  it('öffnet keine Binärdateien und nichts über 512 KiB', () => {
    const root = worldDir(WORLD)
    fs.writeFileSync(path.join(root, 'level.dat'), Buffer.from([1, 2, 0, 3]))
    fs.writeFileSync(path.join(root, 'gross.log'), 'x'.repeat(512 * 1024 + 1))
    expect(() => readTextFile(WORLD, 'level.dat')).toThrow(FileError)
    expect(() => readTextFile(WORLD, 'gross.log')).toThrow(FileError)
    expect(() => writeTextFile(WORLD, 'zu-gross.txt', 'x'.repeat(512 * 1024 + 1), { create: true })).toThrow(FileError)
  })
})
