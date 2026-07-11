import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const __dirname = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(resolve(__dirname, '..', 'deploy.mjs'), 'utf8')

test('declared release actions use a non-blocking child process so the production heartbeat can renew', () => {
  const start = source.indexOf('function runDeclaredReleaseAction')
  const end = source.indexOf('async function runDeclaredReleaseMigration', start)
  const actionRunner = source.slice(start, end)
  assert.match(actionRunner, /await runReleaseNpmScript\(script\)/)
  assert.doesNotMatch(actionRunner, /execSync\(/)
})
