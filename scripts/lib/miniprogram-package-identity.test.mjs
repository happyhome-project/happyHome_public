import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  parseMiniprogramPackageIdentity,
  readMiniprogramPackageIdentity,
} from './miniprogram-package-identity.mjs'

const COMPILED_BUILD_INFO = '"use strict";exports.BUILD_INFO={version:"1.0.2607141912",desc:"current-main-914cee5",buildId:"mp-1.0.2607141912"};\n'

test('parses the exact compiled mini-program package identity', () => {
  assert.deepEqual(parseMiniprogramPackageIdentity(COMPILED_BUILD_INFO), {
    version: '1.0.2607141912',
    desc: 'current-main-914cee5',
    buildId: 'mp-1.0.2607141912',
  })
})

test('reads package identity from the selected dist project', async () => {
  const projectPath = await mkdtemp(join(tmpdir(), 'hh-mp-package-identity-'))
  await mkdir(join(projectPath, 'generated'))
  await writeFile(join(projectPath, 'generated', 'build-info.js'), COMPILED_BUILD_INFO)

  assert.deepEqual(await readMiniprogramPackageIdentity(projectPath), {
    version: '1.0.2607141912',
    desc: 'current-main-914cee5',
    buildId: 'mp-1.0.2607141912',
  })
})

test('rejects incomplete package identity', () => {
  assert.throws(
    () => parseMiniprogramPackageIdentity('exports.BUILD_INFO={version:"1.0.1"}'),
    /compiled build-info is missing desc/i,
  )
})

test('rejects a buildId that does not describe the compiled version', () => {
  assert.throws(
    () => parseMiniprogramPackageIdentity('exports.BUILD_INFO={version:"1.0.1",desc:"release",buildId:"mp-1.0.0"}'),
    /buildId mismatch/i,
  )
})
