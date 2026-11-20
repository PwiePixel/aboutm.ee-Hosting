// Gibt einem bestehenden Konto Admin-Rechte (oder nimmt sie mit --entfernen wieder weg).
//   node scripts/make-admin.mjs du@example.com
//   node scripts/make-admin.mjs du@example.com --entfernen
import path from 'node:path'
import Database from 'better-sqlite3'

const [email, flag] = process.argv.slice(2)
if (!email || (flag && flag !== '--entfernen')) {
  console.error('Aufruf: node scripts/make-admin.mjs <e-mail> [--entfernen]')
  process.exit(1)
}

const file = path.join(path.resolve(process.env.DATA_DIR ?? './data'), 'aboutmee.sqlite')
const db = new Database(file, { fileMustExist: true })
const value = flag === '--entfernen' ? 0 : 1
const result = db.prepare('UPDATE users SET is_admin = ? WHERE email = ?').run(value, email.trim().toLowerCase())

if (result.changes === 0) {
  console.error(`Kein Konto mit der E-Mail ${email} gefunden. Erst auf der Website registrieren, dann diesen Befehl ausführen.`)
  process.exit(1)
}
console.log(value ? `${email} ist jetzt Admin.` : `${email} ist kein Admin mehr.`)
