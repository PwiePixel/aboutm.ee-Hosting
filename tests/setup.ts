import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** Jeder Testlauf bekommt einen eigenen, leeren Datenordner. Muss vor allen lib-Importen stehen. */
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aboutmee-test-'))
process.env.RUNTIME_DRIVER = 'simulated'
process.env.TOTAL_SLOTS = '2'
