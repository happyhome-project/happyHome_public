import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  createReleaseComponentDigest,
  createReleaseBuildConfigurationDigest,
  createRuntimeFileManifest,
  collectComponentSourcePaths,
  verifyRuntimeFileManifest,
} from './release-component-digest.mjs'

test('build configuration digest binds effective values without exposing them', () => {
  const secret = 'sensitive-map-security-code'
  const digest = createReleaseBuildConfigurationDigest({ routerMode: 'history', mapSecurityCode: secret })
  assert.match(digest, /^[a-f0-9]{64}$/)
  assert.doesNotMatch(digest, new RegExp(secret))
  assert.equal(digest, createReleaseBuildConfigurationDigest({ mapSecurityCode: secret, routerMode: 'history' }))
  assert.notEqual(digest, createReleaseBuildConfigurationDigest({ routerMode: 'hash', mapSecurityCode: secret }))
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'happyhome-component-digest-'))
  await mkdir(join(root, 'src'), { recursive: true })
  await mkdir(join(root, 'dist'), { recursive: true })
  await writeFile(join(root, 'src', 'entry.ts'), 'export const value = 1\n')
  await writeFile(join(root, 'build.mjs'), 'export const builder = 1\n')
  await writeFile(join(root, 'package-lock.json'), '{"lockfileVersion":3}\n')
  await writeFile(join(root, 'dist', 'handler.js'), 'exports.main = async () => 1\n')
  await writeFile(join(root, 'dist', 'package.json'), '{"main":"index.js"}\n')
  return root
}

function digestInput(root, builderVersion = 'cloud-builder-v1+esbuild@1.2.3') {
  return {
    root,
    component: 'cloud:post',
    sourcePaths: ['src/entry.ts'],
    configPaths: ['build.mjs'],
    lockfilePath: 'package-lock.json',
    builderVersion,
  }
}

test('component digest is stable across roots input spelling and timestamps', async () => {
  const left = await fixture()
  const right = await fixture()
  await utimes(join(right, 'src', 'entry.ts'), new Date(1), new Date(2))
  const absoluteInput = {
    ...digestInput(left),
    sourcePaths: [join(left, 'src', 'entry.ts')],
    configPaths: [join(left, 'build.mjs')],
    lockfilePath: join(left, 'package-lock.json'),
  }
  assert.equal(await createReleaseComponentDigest(absoluteInput), await createReleaseComponentDigest(digestInput(right)))
})

test('source config lockfile and builder version each bind the component digest', async () => {
  const root = await fixture()
  const originals = Object.fromEntries(await Promise.all(
    ['src/entry.ts', 'build.mjs', 'package-lock.json'].map(async (path) => [path, await readFile(join(root, path))]),
  ))
  const original = await createReleaseComponentDigest(digestInput(root))
  for (const [path, value] of [
    ['src/entry.ts', 'export const value = 2\n'],
    ['build.mjs', 'export const builder = 2\n'],
    ['package-lock.json', '{"lockfileVersion":3,"changed":true}\n'],
  ]) {
    await writeFile(join(root, path), value)
    assert.notEqual(await createReleaseComponentDigest(digestInput(root)), original, path)
    await writeFile(join(root, path), originals[path])
  }
  assert.notEqual(await createReleaseComponentDigest(digestInput(root, 'cloud-builder-v2+esbuild@1.2.3')), original)
})

test('runtime manifest detects handler or wrapper tamper and excludes only release challenge identity', async () => {
  const root = await fixture()
  await writeFile(join(root, 'dist', 'index.js'), 'release wrapper')
  const manifest = await createRuntimeFileManifest(join(root, 'dist'), {
    exclude: ['__release.info.json'],
  })
  assert.equal(await verifyRuntimeFileManifest(join(root, 'dist'), manifest), true)
  await writeFile(join(root, 'dist', '__release.info.json'), '{"random":"changes-every-run"}')
  const rebuilt = await createRuntimeFileManifest(join(root, 'dist'), { exclude: ['__release.info.json'] })
  assert.equal(rebuilt.runtimeDigest, manifest.runtimeDigest)
  await writeFile(join(root, 'dist', 'index.js'), 'tampered wrapper')
  assert.equal(await verifyRuntimeFileManifest(join(root, 'dist'), manifest), false)
  await writeFile(join(root, 'dist', 'index.js'), 'release wrapper')
  await writeFile(join(root, 'dist', 'handler.js'), 'tampered')
  assert.equal(await verifyRuntimeFileManifest(join(root, 'dist'), manifest), false)
})

test('component source collection excludes generated and dependency directories', async () => {
  const root = await fixture()
  await mkdir(join(root, 'src', 'nested'), { recursive: true })
  await mkdir(join(root, 'dist'), { recursive: true })
  await mkdir(join(root, 'node_modules', 'pkg'), { recursive: true })
  await writeFile(join(root, 'src', 'nested', 'view.ts'), 'view')
  await writeFile(join(root, 'dist', 'generated.js'), 'generated')
  await writeFile(join(root, 'node_modules', 'pkg', 'index.js'), 'dependency')
  const paths = await collectComponentSourcePaths(root, { excludeDirectories: ['dist', 'node_modules'] })
  assert(paths.some((path) => path.endsWith('src/entry.ts') || path.endsWith('src\\entry.ts')))
  assert.equal(paths.some((path) => path.includes('dist')), false)
  assert.equal(paths.some((path) => path.includes('node_modules')), false)
})

test('component source collection can exclude a release-owned generated marker without excluding its directory', async () => {
  const root = await fixture()
  await mkdir(join(root, 'src', 'generated'), { recursive: true })
  await writeFile(join(root, 'src', 'generated', 'build-info.ts'), 'export const version = "release-owned"\n')
  await writeFile(join(root, 'src', 'generated', 'business.ts'), 'export const value = 1\n')
  const paths = await collectComponentSourcePaths(root, {
    excludeDirectories: ['dist', 'node_modules'],
    excludeFiles: ['src/generated/build-info.ts'],
  })
  assert.equal(paths.some((path) => path.endsWith('src\\generated\\build-info.ts') || path.endsWith('src/generated/build-info.ts')), false)
  assert(paths.some((path) => path.endsWith('src\\generated\\business.ts') || path.endsWith('src/generated/business.ts')))
  const input = { ...digestInput(root), sourcePaths: paths }
  const original = await createReleaseComponentDigest(input)
  await writeFile(join(root, 'src', 'generated', 'build-info.ts'), 'export const version = "next-release"\n')
  assert.equal(await createReleaseComponentDigest(input), original)
  await writeFile(join(root, 'src', 'generated', 'business.ts'), 'export const value = 2\n')
  assert.notEqual(await createReleaseComponentDigest(input), original)
})
