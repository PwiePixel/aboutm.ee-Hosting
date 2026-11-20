// Gibt einem Konto Admin-Rechte — und legt es an, falls es noch nicht existiert.
//
//   node scripts/make-admin.mjs du@example.com              bestehendes Konto zum Admin machen
//   node scripts/make-admin.mjs du@example.com --entfernen  Admin-Rechte wieder wegnehmen
//   ADMIN_PASSWORD='…' node scripts/make-admin.mjs du@example.com
//                                                           Konto mit diesem Passwort anlegen, falls es fehlt
//
// Das Passwort kommt absichtlich aus der Umgebung und nicht als Argument: Argumente sind für
// andere Benutzer des Servers in der Prozessliste sichtbar.
import { randomBytes, randomInt, scryptSync } from 'node:crypto'
import path from 'node:path'
import Database from 'better-sqlite3'

const [rawEmail, flag] = process.argv.slice(2)
if (!rawEmail || (flag && flag !== '--entfernen')) {
  console.error('Aufruf: node scripts/make-admin.mjs <e-mail> [--entfernen]')
  process.exit(1)
}
const email = rawEmail.trim().toLowerCase()
if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
  console.error(`"${rawEmail}" ist keine gültige E-Mail-Adresse.`)
  process.exit(1)
}

// Muss zu lib/password.ts und lib/ids.ts passen — tests/admin-script.test.ts prüft das.
const N = 2 ** 15
const R = 8
const P = 1
function hashPassword(password) {
  const salt = randomBytes(16)
  const key = scryptSync(password.normalize('NFKC'), salt, 64, { N, r: R, p: P, maxmem: 128 * N * R * 2 })
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`
}
function newUserId() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789'
  let id = 'usr_'
  for (let i = 0; i < 16; i++) id += alphabet[randomInt(alphabet.length)]
  return id
}

const file = path.join(path.resolve(process.env.DATA_DIR ?? './data'), 'aboutmee.sqlite')
let db
try {
  db = new Database(file, { fileMustExist: true })
} catch {
  console.error(`Datenbank ${file} nicht gefunden. Die Website muss mindestens einmal gestartet worden sein.`)
  process.exit(1)
}
db.pragma('busy_timeout = 5000')

const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email)

if (flag === '--entfernen') {
  if (!existing) {
    console.error(`Kein Konto mit der E-Mail ${email} gefunden.`)
    process.exit(1)
  }
  db.prepare('UPDATE users SET is_admin = 0 WHERE id = ?').run(existing.id)
  console.log(`${email} ist kein Admin mehr.`)
  process.exit(0)
}

if (existing) {
  db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(existing.id)
  console.log(`${email} ist jetzt Admin.`)
  process.exit(0)
}

const password = process.env.ADMIN_PASSWORD ?? ''
if (!password) {
  console.error(
    `Kein Konto mit der E-Mail ${email} gefunden. Erst auf der Website registrieren — oder ADMIN_PASSWORD setzen, dann wird das Konto angelegt.`,
  )
  process.exit(1)
}
if (password.length < 10 || password.length > 200) {
  console.error('Das Passwort braucht 10 bis 200 Zeichen.')
  process.exit(1)
}
db.prepare('INSERT INTO users (id, email, password_hash, created_at, is_admin) VALUES (?, ?, ?, ?, 1)').run(
  newUserId(),
  email,
  hashPassword(password),
  Date.now(),
)
console.log(`Admin-Konto ${email} angelegt.`)
