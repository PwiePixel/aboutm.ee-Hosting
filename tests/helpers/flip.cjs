// Spielt einen Angreifer im Weltordner: tauscht einen Eintrag pausenlos zwischen einer echten
// Datei (oder einem Ordner) und einem symbolischen Link aus.
//   node flip.cjs <ordner> <name> <echterName> <linkName>
const fs = require('node:fs')
const path = require('node:path')
const [dir, name, real, link] = process.argv.slice(2)
const at = (entry) => path.join(dir, entry)
for (;;) {
  try { fs.renameSync(at(real), at(name)) } catch {}
  try { fs.renameSync(at(name), at(real)) } catch {}
  try { fs.renameSync(at(link), at(name)) } catch {}
  try { fs.renameSync(at(name), at(link)) } catch {}
}
