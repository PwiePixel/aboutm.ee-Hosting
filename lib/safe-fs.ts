import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'

/**
 * Dateizugriff auf Weltordner, der symbolischen Links nie folgt.
 *
 * Warum das nötig ist: Der Inhalt eines Weltordners ist nicht vertrauenswürdig. Der Minecraft-Server
 * darin läuft mit Code, den der Besitzer der Welt beeinflussen kann, und kann jederzeit — auch
 * während die Website gerade zugreift — eine Datei oder einen Ordner durch einen Link auf etwas
 * außerhalb ersetzen. „Erst prüfen, dann über den Pfad zugreifen“ lässt sich so überlisten.
 *
 * Deshalb wird jeder Ordner einzeln geöffnet (O_DIRECTORY | O_NOFOLLOW) und alles Weitere nur noch
 * relativ zu diesem geöffneten Ordner angesprochen, über /proc/self/fd/<nr>/<name>. Der geöffnete
 * Ordner bleibt derselbe, egal was mit seinem Pfad passiert, und der Name darunter wird mit
 * O_NOFOLLOW geöffnet. Damit gibt es keinen Moment, in dem ein untergeschobener Link verfolgt würde.
 *
 * Ohne /proc (macOS in der Entwicklung) fällt der Zugriff auf normale Pfade zurück — dort laufen
 * keine fremden Server.
 */

const C = fs.constants
const DIR_FLAGS = C.O_RDONLY | C.O_DIRECTORY | C.O_NOFOLLOW
const PROC = '/proc/self/fd'
const PINNED = fs.existsSync(PROC)

export class UnsafeEntryError extends Error {}

/** Wem neu angelegte Dateien gehören sollen (der Benutzer des Minecraft-Servers) — nur als root wirksam. */
export type Owner = { uid: number; gid: number }

function isRoot(): boolean {
  return process.getuid?.() === 0
}

export class Dir {
  private constructor(
    readonly fd: number,
    /** Nur zur Anzeige und für den Rückfall ohne /proc — nie für sicherheitsrelevante Zugriffe unter Linux. */
    readonly displayPath: string,
  ) {}

  /** Öffnet den Wurzelordner. Sein Pfad ist vertrauenswürdig (liegt außerhalb der Reichweite des Servers). */
  static open(root: string): Dir {
    return new Dir(fs.openSync(root, DIR_FLAGS), root)
  }

  /** Pfad, über den ein Eintrag dieses Ordners angesprochen wird, ohne den Ordner neu aufzulösen. */
  at(name: string): string {
    assertName(name)
    return PINNED ? `${PROC}/${this.fd}/${name}` : path.join(this.displayPath, name)
  }

  private self(): string {
    return PINNED ? `${PROC}/${this.fd}` : this.displayPath
  }

  /** Öffnet einen Unterordner — schlägt fehl, wenn dort ein Link oder etwas anderes liegt. */
  openDir(name: string): Dir {
    try {
      return new Dir(fs.openSync(this.at(name), DIR_FLAGS), path.join(this.displayPath, name))
    } catch (error) {
      throw translate(error)
    }
  }

  close(): void {
    try {
      fs.closeSync(this.fd)
    } catch {
      // schon geschlossen
    }
  }

  /** Einträge mit ihrem tatsächlichen Typ (Links werden als Links gemeldet, nicht verfolgt). */
  entries(): Array<{ name: string; stat: fs.Stats }> {
    const out: Array<{ name: string; stat: fs.Stats }> = []
    for (const name of fs.readdirSync(this.self())) {
      if (name === '.' || name === '..' || name.includes('/')) continue
      const stat = fs.lstatSync(this.at(name), { throwIfNoEntry: false })
      if (stat) out.push({ name, stat })
    }
    return out
  }

  lstat(name: string): fs.Stats | undefined {
    return fs.lstatSync(this.at(name), { throwIfNoEntry: false })
  }

  /** Öffnet eine vorhandene reguläre Datei zum Lesen. Links, FIFOs und Geräte werden abgelehnt. */
  private openRegular(name: string, flags: number): number {
    let fd: number
    try {
      // O_NONBLOCK: an einer FIFO würde das Öffnen sonst für immer hängen.
      fd = fs.openSync(this.at(name), flags | C.O_NOFOLLOW | C.O_NONBLOCK)
    } catch (error) {
      throw translate(error)
    }
    if (!fs.fstatSync(fd).isFile()) {
      fs.closeSync(fd)
      throw new UnsafeEntryError('Das ist keine normale Datei.')
    }
    return fd
  }

  /** Liest eine reguläre Datei bis zu `maxBytes`. Gibt `null` zurück, wenn sie größer ist. */
  readFile(name: string, maxBytes: number): Buffer | null {
    const fd = this.openRegular(name, C.O_RDONLY)
    try {
      const size = fs.fstatSync(fd).size
      if (size > maxBytes) return null
      const buffer = Buffer.alloc(size)
      let offset = 0
      while (offset < size) {
        const read = fs.readSync(fd, buffer, offset, size - offset, offset)
        if (read === 0) break
        offset += read
      }
      return buffer.subarray(0, offset)
    } finally {
      fs.closeSync(fd)
    }
  }

  /** Überschreibt eine vorhandene reguläre Datei. */
  overwriteFile(name: string, content: string | Buffer): void {
    const fd = this.openRegular(name, C.O_WRONLY)
    try {
      fs.ftruncateSync(fd, 0)
      writeAll(fd, content)
    } finally {
      fs.closeSync(fd)
    }
  }

  /** Legt eine neue Datei an. Schlägt fehl, wenn unter dem Namen schon irgendetwas liegt — auch ein Link. */
  createFile(name: string, content: string | Buffer, owner?: Owner): void {
    let fd: number
    try {
      fd = fs.openSync(this.at(name), C.O_WRONLY | C.O_CREAT | C.O_EXCL | C.O_NOFOLLOW, 0o644)
    } catch (error) {
      throw translate(error)
    }
    try {
      writeAll(fd, content)
      if (owner && isRoot()) fs.fchownSync(fd, owner.uid, owner.gid)
    } finally {
      fs.closeSync(fd)
    }
  }

  /**
   * Setzt eine Datei auf einen neuen Inhalt, egal was vorher unter dem Namen lag: Es wird eine neue
   * Datei geschrieben und über den alten Eintrag geschoben. Ein Link an der Stelle wird dabei ersetzt,
   * nicht verfolgt.
   */
  replaceFile(name: string, content: string | Buffer, owner?: Owner): void {
    const existing = this.lstat(name)
    if (existing?.isDirectory()) this.remove(name)
    const temp = `.${name}.${randomBytes(6).toString('hex')}.neu`
    this.createFile(temp, content, owner)
    try {
      fs.renameSync(this.at(temp), this.at(name))
    } catch (error) {
      fs.rmSync(this.at(temp), { force: true })
      throw translate(error)
    }
  }

  mkdir(name: string, owner?: Owner): void {
    try {
      fs.mkdirSync(this.at(name), 0o755)
    } catch (error) {
      throw translate(error)
    }
    if (owner && isRoot()) {
      const created = this.openDir(name)
      try {
        fs.fchownSync(created.fd, owner.uid, owner.gid)
      } finally {
        created.close()
      }
    }
  }

  /** Löscht einen Eintrag samt Inhalt. Links werden entfernt, nie verfolgt. */
  remove(name: string): void {
    const stat = this.lstat(name)
    if (!stat) return
    if (stat.isDirectory()) {
      let child: Dir | undefined
      try {
        child = this.openDir(name)
      } catch {
        // Zwischen Prüfen und Öffnen ausgetauscht — dann ist es kein Ordner mehr.
      }
      if (child) {
        try {
          child.clear()
        } finally {
          child.close()
        }
        fs.rmdirSync(this.at(name))
        return
      }
    }
    // unlink entfernt den Eintrag selbst, auch wenn es ein Link ist.
    fs.unlinkSync(this.at(name))
  }

  /** Leert den Ordner. */
  clear(): void {
    for (const { name } of this.entries()) this.remove(name)
  }

  /** Summe der Größen aller regulären Dateien darunter. */
  size(): number {
    let total = 0
    for (const { name, stat } of this.entries()) {
      if (stat.isFile()) total += stat.size
      else if (stat.isDirectory()) {
        let child: Dir
        try {
          child = this.openDir(name)
        } catch {
          continue
        }
        try {
          total += child.size()
        } finally {
          child.close()
        }
      }
    }
    return total
  }

  /** Überträgt Besitz auf alles darunter — über lchown, das Links selbst ändert statt ihr Ziel. */
  chownTree(owner: Owner): void {
    fs.fchownSync(this.fd, owner.uid, owner.gid)
    for (const { name, stat } of this.entries()) {
      if (stat.isDirectory()) {
        let child: Dir
        try {
          child = this.openDir(name)
        } catch {
          continue
        }
        try {
          child.chownTree(owner)
        } finally {
          child.close()
        }
      } else if (stat.uid !== owner.uid || stat.gid !== owner.gid) {
        fs.lchownSync(this.at(name), owner.uid, owner.gid)
      }
    }
  }

  /**
   * Kopiert alle Ordner und regulären Dateien nach `target` (ein vertrauenswürdiger, leerer Ordner).
   * Links, FIFOs und Geräte werden ausgelassen. Die Dateiinhalte fließen asynchron, damit große
   * Welten die Website nicht anhalten.
   */
  async copyTo(target: string): Promise<void> {
    fs.mkdirSync(target, { recursive: true })
    for (const { name, stat } of this.entries()) {
      const destination = path.join(target, name)
      if (stat.isDirectory()) {
        let child: Dir
        try {
          child = this.openDir(name)
        } catch {
          continue
        }
        try {
          await child.copyTo(destination)
        } finally {
          child.close()
        }
      } else if (stat.isFile()) {
        let fd: number
        try {
          fd = this.openRegular(name, C.O_RDONLY)
        } catch {
          continue // inzwischen ausgetauscht oder verschwunden
        }
        // Die Streams schließen den Dateizugriff selbst.
        await pipeline(
          fs.createReadStream('', { fd, autoClose: true }),
          fs.createWriteStream(destination, { flags: 'wx', mode: 0o644 }),
        )
      }
    }
  }
}

function writeAll(fd: number, content: string | Buffer): void {
  const buffer = typeof content === 'string' ? Buffer.from(content, 'utf8') : content
  let offset = 0
  while (offset < buffer.length) offset += fs.writeSync(fd, buffer, offset, buffer.length - offset, offset)
}

function assertName(name: string): void {
  if (name === '' || name === '.' || name === '..' || name.includes('/') || name.includes('\0')) {
    throw new UnsafeEntryError('Ungültiger Name.')
  }
}

function translate(error: unknown): Error {
  const code = (error as NodeJS.ErrnoException).code
  if (code === 'ELOOP' || code === 'EMLINK') return new UnsafeEntryError('Verknüpfungen werden nicht unterstützt.')
  if (code === 'ENOTDIR') return new UnsafeEntryError('Das ist kein Ordner.')
  if (code === 'ENXIO') return new UnsafeEntryError('Das ist keine normale Datei.')
  return error as Error
}

/**
 * Öffnet einen Ordner unterhalb von `root`, Schritt für Schritt, und ruft `use` damit auf.
 * `parts` sind einzelne, bereits geprüfte Namen. Existiert `root` nicht, wird `onMissingRoot` geliefert.
 */
export function withDir<T>(root: string, parts: string[], use: (dir: Dir) => T, onMissingRoot?: () => T): T {
  let current: Dir
  try {
    current = Dir.open(root)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' && onMissingRoot) return onMissingRoot()
    throw translate(error)
  }
  try {
    for (const part of parts) {
      const next = current.openDir(part)
      current.close()
      current = next
    }
    return use(current)
  } finally {
    current.close()
  }
}

/** Wie `withDir`, für asynchrone Arbeit. */
export async function withDirAsync<T>(root: string, use: (dir: Dir) => Promise<T>): Promise<T> {
  const dir = Dir.open(root)
  try {
    return await use(dir)
  } finally {
    dir.close()
  }
}

/** Löscht einen Ordner samt Inhalt, ohne dabei Links zu folgen. Fehlt er, passiert nichts. */
export function removeTree(root: string): void {
  let dir: Dir
  try {
    dir = Dir.open(root)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return
    // Liegt dort kein Ordner (sondern z. B. ein Link), wird nur dieser Eintrag entfernt.
    fs.rmSync(root, { force: true })
    return
  }
  try {
    dir.clear()
  } finally {
    dir.close()
  }
  fs.rmdirSync(root)
}
