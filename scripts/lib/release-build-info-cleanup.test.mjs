import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'

import {
  GENERATED_BUILD_INFO_PATH,
  renderReleaseBuildInfo,
  restoreReleaseOwnedBuildInfo,
} from './release-build-info-cleanup.mjs'

async function fixture(current) {
  const root = await mkdtemp(join(tmpdir(), 'happyhome-release-build-info-'))
  const path = join(root, ...GENERATED_BUILD_INFO_PATH.split('/'))
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, current)
  return { path, root }
}

test('restores the tracked source marker after an exact release-owned build', async () => {
  const release = renderReleaseBuildInfo({ version: '1.0.9', desc: 'actual-desc' })
  const tracked = renderReleaseBuildInfo({ version: '1.0.1', desc: 'tracked-main' })
  const { path, root } = await fixture(release)

  const result = restoreReleaseOwnedBuildInfo({
    root,
    version: '1.0.9',
    desc: 'actual-desc',
    readTrackedFile: () => tracked,
  })

  assert.deepEqual(result, { path, status: 'restored' })
  assert.equal(await readFile(path, 'utf8'), tracked)
})

test('is idempotent when the source marker is already tracked and clean', async () => {
  const tracked = renderReleaseBuildInfo({ version: '1.0.1', desc: 'tracked-main' })
  const { path, root } = await fixture(tracked)

  const result = restoreReleaseOwnedBuildInfo({
    root,
    version: '1.0.9',
    desc: 'actual-desc',
    readTrackedFile: () => tracked,
  })

  assert.deepEqual(result, { path, status: 'unchanged' })
  assert.equal(await readFile(path, 'utf8'), tracked)
})

test('refuses to overwrite a marker that is not owned by the exact release identity', async () => {
  const unexpected = `${renderReleaseBuildInfo({ version: '1.0.9', desc: 'actual-desc' })}// user edit\n`
  const tracked = renderReleaseBuildInfo({ version: '1.0.1', desc: 'tracked-main' })
  const { path, root } = await fixture(unexpected)

  assert.throws(() => restoreReleaseOwnedBuildInfo({
    root,
    version: '1.0.9',
    desc: 'actual-desc',
    readTrackedFile: () => tracked,
  }), /does not exactly match/)
  assert.equal(await readFile(path, 'utf8'), unexpected)
})
