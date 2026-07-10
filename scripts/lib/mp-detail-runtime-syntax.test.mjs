import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'

import { scanCriticalRuntimeSyntax } from './mp-critical-runtime-syntax.mjs'

async function writeFixture(root, relativePath, content) {
  const target = join(root, relativePath)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, content, 'utf8')
}

async function createCriticalPageFixture() {
  const root = await mkdtemp(join(tmpdir(), 'hh-mp-runtime-'))
  await writeFixture(root, 'pages/detail/index.js', 'require("../../utils/onboarding-nav.js")')
  await writeFixture(root, 'pages/detail/index.json', JSON.stringify({
    usingComponents: {
      'guide-route-detail-view': '/components/GuideRouteDetailView',
    },
  }))
  await writeFixture(root, 'pages/profile/index.js', '')
  await writeFixture(root, 'pages/profile/index.json', '{}')
  await writeFixture(root, 'utils/onboarding-nav.js', 'require("./community-share.js")')
  await writeFixture(root, 'utils/community-share.js', 'const copy = (items) => [...items]')
  await writeFixture(root, 'components/GuideRouteDetailView.js', 'const safe = true')
  return root
}

test('rejects forbidden syntax in a transitive detail dependency', async () => {
  const fixture = await createCriticalPageFixture()
  try {
    const result = scanCriticalRuntimeSyntax(fixture)
    assert.ok(result.findings.some((finding) =>
      finding.file === 'utils/community-share.js' && finding.rule === 'collection spread'))
  } finally {
    await rm(fixture, { recursive: true, force: true })
  }
})

test('scans root-relative usingComponents dependencies', async () => {
  const fixture = await createCriticalPageFixture()
  try {
    await writeFixture(fixture, 'utils/community-share.js', 'const copy = (items) => items.slice()')
    await writeFixture(fixture, 'components/GuideRouteDetailView.js', 'const copy = (items) => [...items]')
    const result = scanCriticalRuntimeSyntax(fixture)
    assert.ok(result.findings.some((finding) =>
      finding.file === 'components/GuideRouteDetailView.js' && finding.rule === 'collection spread'))
  } finally {
    await rm(fixture, { recursive: true, force: true })
  }
})

test('accepts safe dependencies and ignores syntax-like strings or comments', async () => {
  const fixture = await createCriticalPageFixture()
  try {
    await writeFixture(fixture, 'utils/community-share.js', [
      'const text = "Object.values(fake) ?? require(\\"./missing.js\\")"',
      '// const copy = (items) => [...items]',
      'const copy = (items) => items.slice()',
    ].join('\n'))
    const result = scanCriticalRuntimeSyntax(fixture)
    assert.deepEqual(result.findings, [])
  } finally {
    await rm(fixture, { recursive: true, force: true })
  }
})
