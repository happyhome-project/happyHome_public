import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'deploy.mjs'), 'utf8')

test('release probes quote the CloudBase CLI @payload-file argument on Windows', () => {
  assert.match(source, /const payloadArgument = `"@\$\{payloadPath\}"`/)
})
