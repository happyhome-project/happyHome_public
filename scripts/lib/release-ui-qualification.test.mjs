import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  inspectReleaseUiQualification,
  writeReleaseUiQualification,
} from './release-ui-qualification.mjs'
import { computeDirectoryDigest } from './release-run-ledger.mjs'

const IDENTITY = {
  gitSha: 'a'.repeat(40),
  version: '1.0.2607141300',
  desc: 'public main aaaaaaa',
  devToolsVersion: '1.06.2504010',
}

const MARKERS = [
  'HH_RELEASE_HOME_COLD_START_NONEMPTY',
  'HH_RELEASE_HOME_IMAGES_RENDERED',
  'HH_RELEASE_HOME_ARCHIVE_TABS_STICKY',
  'HH_RELEASE_HOME_DETAIL_NONEMPTY',
  'HH_RELEASE_LOGIN_VERSION',
  'HH_RELEASE_PROFILE_LOGIN_CLEAN',
]

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'hh-ui-qualification-'))
  const packageRoot = join(root, 'miniprogram', 'dist', 'build', 'mp-weixin')
  const sourceBuildInfoPath = join(root, 'miniprogram', 'src', 'generated', 'build-info.ts')
  const distBuildInfoPath = join(packageRoot, 'generated', 'build-info.js')
  const uiEvidencePath = join(root, '.codex-local', 'ui-evidence.json')
  const outputPath = join(root, '.codex-local', 'ui-qualification.json')
  await mkdir(join(packageRoot, 'generated'), { recursive: true })
  await mkdir(join(root, 'miniprogram', 'src', 'generated'), { recursive: true })
  await mkdir(join(root, '.codex-local'), { recursive: true })
  const sourceBuildInfo = `export const version = '${IDENTITY.version}'\nexport const desc = '${IDENTITY.desc}'\nexport const build = 'mp-${IDENTITY.version}'\n`
  const distBuildInfo = `"use strict";exports.BUILD_INFO={version:"${IDENTITY.version}",desc:"${IDENTITY.desc}",buildId:"mp-${IDENTITY.version}"};\n`
  await writeFile(sourceBuildInfoPath, sourceBuildInfo)
  await writeFile(distBuildInfoPath, distBuildInfo)
  await writeFile(join(packageRoot, 'app.js'), 'App({})\n')
  const packageDigest = await computeDirectoryDigest(packageRoot)
  await writeFile(uiEvidencePath, `${JSON.stringify({
    gitSha: IDENTITY.gitSha,
    devToolsVersion: IDENTITY.devToolsVersion,
    projectPath: packageRoot,
    packageDigest,
    markers: MARKERS,
    homeColdStart: { passed: true },
    homeArchiveTabs: { passed: true },
    homeDetail: { passed: true, homeImagesRendered: true },
    profileLoginClean: { expectedVersion: IDENTITY.version, buildIdentityPassed: true, cleanPassed: true },
  }, null, 2)}\n`)
  return { root, packageRoot, sourceBuildInfoPath, distBuildInfoPath, uiEvidencePath, outputPath }
}

async function writeFixtureQualification(fixture) {
  return writeReleaseUiQualification({
    ...fixture,
    ...IDENTITY,
  })
}

async function inspectFixture(fixture, overrides = {}) {
  return inspectReleaseUiQualification({
    qualificationPath: fixture.outputPath,
    root: fixture.root,
    expected: {
      gitSha: IDENTITY.gitSha,
      version: IDENTITY.version,
      desc: IDENTITY.desc,
      ...(overrides.expected || {}),
    },
    currentDevToolsVersion: overrides.currentDevToolsVersion || IDENTITY.devToolsVersion,
  })
}

test('writes and inspects an exact reusable UI qualification', async () => {
  const fixture = await createFixture()
  const wrapper = await writeFixtureQualification(fixture)
  const inspected = await inspectFixture(fixture)
  assert.equal(inspected.packageDigest, wrapper.packageDigest)
  assert.equal(inspected.gitSha, IDENTITY.gitSha)
  const persisted = await readFile(fixture.outputPath, 'utf8')
  assert.doesNotMatch(persisted, /token|openid/i)
})

const mutationCases = [
  {
    name: 'git SHA',
    pattern: /gitSha mismatch/i,
    mutate: async (fixture) => inspectFixture(fixture, { expected: { gitSha: 'b'.repeat(40) } }),
  },
  {
    name: 'package bytes',
    pattern: /package digest mismatch/i,
    mutate: async (fixture) => {
      await writeFile(join(fixture.packageRoot, 'app.js'), 'App({changed: true})\n')
      return inspectFixture(fixture)
    },
  },
  {
    name: 'dist build info',
    pattern: /dist build info.*mismatch/i,
    mutate: async (fixture) => {
      await writeFile(fixture.distBuildInfoPath, 'stale dist build info\n')
      return inspectFixture(fixture)
    },
  },
  {
    name: 'DevTools version',
    pattern: /DevTools version mismatch/i,
    mutate: async (fixture) => inspectFixture(fixture, { currentDevToolsVersion: '1.06.0000000' }),
  },
  {
    name: 'required marker',
    pattern: /missing marker HH_RELEASE_HOME_DETAIL_NONEMPTY/i,
    mutate: async (fixture) => {
      const evidence = JSON.parse(await readFile(fixture.uiEvidencePath, 'utf8'))
      evidence.markers = evidence.markers.filter((marker) => marker !== 'HH_RELEASE_HOME_DETAIL_NONEMPTY')
      evidence.homeDetail.passed = false
      await writeFile(fixture.uiEvidencePath, `${JSON.stringify(evidence, null, 2)}\n`)
      const qualification = JSON.parse(await readFile(fixture.outputPath, 'utf8'))
      qualification.uiEvidence.sha256 = await sha256File(fixture.uiEvidencePath)
      await writeFile(fixture.outputPath, `${JSON.stringify(qualification, null, 2)}\n`)
      return inspectFixture(fixture)
    },
  },
  {
    name: 'evidence SHA-256',
    pattern: /UI evidence SHA-256 mismatch/i,
    mutate: async (fixture) => {
      const qualification = JSON.parse(await readFile(fixture.outputPath, 'utf8'))
      qualification.uiEvidence.sha256 = '0'.repeat(64)
      await writeFile(fixture.outputPath, `${JSON.stringify(qualification, null, 2)}\n`)
      return inspectFixture(fixture)
    },
  },
  {
    name: 'evidence package digest',
    pattern: /UI evidence package digest mismatch/i,
    mutate: async (fixture) => {
      const evidence = JSON.parse(await readFile(fixture.uiEvidencePath, 'utf8'))
      evidence.packageDigest = 'f'.repeat(64)
      await writeFile(fixture.uiEvidencePath, `${JSON.stringify(evidence, null, 2)}\n`)
      const qualification = JSON.parse(await readFile(fixture.outputPath, 'utf8'))
      qualification.uiEvidence.sha256 = await sha256File(fixture.uiEvidencePath)
      await writeFile(fixture.outputPath, `${JSON.stringify(qualification, null, 2)}\n`)
      return inspectFixture(fixture)
    },
  },
  {
    name: 'nested UI result',
    pattern: /HH_RELEASE_HOME_DETAIL_NONEMPTY/i,
    mutate: async (fixture) => {
      const evidence = JSON.parse(await readFile(fixture.uiEvidencePath, 'utf8'))
      evidence.homeDetail.passed = false
      await writeFile(fixture.uiEvidencePath, `${JSON.stringify(evidence, null, 2)}\n`)
      const qualification = JSON.parse(await readFile(fixture.outputPath, 'utf8'))
      qualification.uiEvidence.sha256 = await sha256File(fixture.uiEvidencePath)
      await writeFile(fixture.outputPath, `${JSON.stringify(qualification, null, 2)}\n`)
      return inspectFixture(fixture)
    },
  },
  {
    name: 'evidence expected version',
    pattern: /UI evidence version mismatch/i,
    mutate: async (fixture) => {
      const evidence = JSON.parse(await readFile(fixture.uiEvidencePath, 'utf8'))
      evidence.profileLoginClean.expectedVersion = '1.0.stale'
      await writeFile(fixture.uiEvidencePath, `${JSON.stringify(evidence, null, 2)}\n`)
      const qualification = JSON.parse(await readFile(fixture.outputPath, 'utf8'))
      qualification.uiEvidence.sha256 = await sha256File(fixture.uiEvidencePath)
      await writeFile(fixture.outputPath, `${JSON.stringify(qualification, null, 2)}\n`)
      return inspectFixture(fixture)
    },
  },
  {
    name: 'project path',
    pattern: /project path.*package root/i,
    mutate: async (fixture) => {
      const other = join(fixture.root, 'other-package')
      await mkdir(other)
      const evidence = JSON.parse(await readFile(fixture.uiEvidencePath, 'utf8'))
      evidence.projectPath = other
      await writeFile(fixture.uiEvidencePath, `${JSON.stringify(evidence, null, 2)}\n`)
      const qualification = JSON.parse(await readFile(fixture.outputPath, 'utf8'))
      qualification.uiEvidence.sha256 = await sha256File(fixture.uiEvidencePath)
      await writeFile(fixture.outputPath, `${JSON.stringify(qualification, null, 2)}\n`)
      return inspectFixture(fixture)
    },
  },
]

test('reports restored source build info without invalidating immutable package evidence', async () => {
  const fixture = await createFixture()
  await writeFixtureQualification(fixture)
  await writeFile(fixture.sourceBuildInfoPath, 'restored checked-in source marker\n')

  const inspected = await inspectFixture(fixture)
  assert.equal(inspected.sourceBuildInfo.matchesQualification, false)
  assert.equal(inspected.sourceBuildInfo.identityMatchesQualification, false)
  assert.equal(inspected.sourceBuildInfo.sha256MatchesQualification, false)
})

for (const mutationCase of mutationCases) {
  test(`rejects changed ${mutationCase.name}`, async () => {
    const fixture = await createFixture()
    await writeFixtureQualification(fixture)
    await assert.rejects(() => mutationCase.mutate(fixture), mutationCase.pattern)
  })
}

async function sha256File(path) {
  const { createHash } = await import('node:crypto')
  return createHash('sha256').update(await readFile(path)).digest('hex')
}
