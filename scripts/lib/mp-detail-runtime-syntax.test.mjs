import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'

import { hashNodeModulesDirectory, scanCriticalRuntimeSyntax } from './mp-critical-runtime-syntax.mjs'

async function writeFixture(root, relativePath, content) {
  const target = join(root, relativePath)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, content, 'utf8')
}

async function createCriticalPageFixture() {
  const root = await mkdtemp(join(tmpdir(), 'hh-mp-runtime-'))
  await writeFixture(root, 'app.json', JSON.stringify({
    pages: [
      'pages/index/index',
      'pages/detail/index',
      'pages/profile/index',
      'pages/search/index',
    ],
    lazyCodeLoading: 'requiredComponents',
  }))
  await writeFixture(root, 'project.config.json', JSON.stringify({
    libVersion: '3.15.1',
    setting: { es6: false, minified: false, enhance: false },
  }))
  await writeFixture(root, 'app.js', '')
  await writeFixture(root, 'pages/index/index.js', '')
  await writeFixture(root, 'pages/index/index.json', '{}')
  await writeFixture(root, 'pages/index/index.wxml', '<view />')
  await writeFixture(root, 'pages/detail/index.js', 'require("../../utils/onboarding-nav.js")')
  await writeFixture(root, 'pages/detail/index.json', JSON.stringify({
    usingComponents: {
      'guide-route-detail-view': '/components/GuideRouteDetailView',
    },
  }))
  await writeFixture(root, 'pages/detail/index.wxml', '<guide-route-detail-view />')
  await writeFixture(root, 'pages/profile/index.js', '')
  await writeFixture(root, 'pages/profile/index.json', '{}')
  await writeFixture(root, 'pages/profile/index.wxml', '<view />')
  await writeFixture(root, 'pages/search/index.js', '')
  await writeFixture(root, 'pages/search/index.json', '{}')
  await writeFixture(root, 'pages/search/index.wxml', '<view />')
  await writeFixture(root, 'utils/onboarding-nav.js', 'require("./community-share.js")')
  await writeFixture(root, 'utils/community-share.js', 'const copy = (items) => [...items]')
  await writeFixture(root, 'components/GuideRouteDetailView.js', 'const safe = true')
  await writeFixture(root, 'components/GuideRouteDetailView.json', '{"component":true}')
  await writeFixture(root, 'components/GuideRouteDetailView.wxml', '<view />')
  return root
}

test('requires WeChat required-components lazy code loading', async () => {
  const fixture = await createCriticalPageFixture()
  try {
    await writeFixture(fixture, 'app.json', JSON.stringify({
      pages: [
        'pages/index/index',
        'pages/detail/index',
        'pages/profile/index',
        'pages/search/index',
      ],
    }))
    const result = scanCriticalRuntimeSyntax(fixture, { expectedVendorHash: '' })
    assert.ok(result.findings.some((finding) =>
      finding.file === 'app.json' && finding.rule === 'requiredComponents lazy code loading'))
  } finally {
    await rm(fixture, { recursive: true, force: true })
  }
})

test('requires the uploaded dist project to pin a WeChat base library version', async () => {
  const fixture = await createCriticalPageFixture()
  try {
    await writeFixture(fixture, 'project.config.json', JSON.stringify({ libVersion: '' }))
    const result = scanCriticalRuntimeSyntax(fixture, { expectedVendorHash: '' })
    assert.ok(result.findings.some((finding) =>
      finding.file === 'project.config.json' && finding.rule === 'pinned WeChat base library'))
  } finally {
    await rm(fixture, { recursive: true, force: true })
  }
})

test('rejects an unreviewed WeChat base library version change', async () => {
  const fixture = await createCriticalPageFixture()
  try {
    await writeFixture(fixture, 'project.config.json', JSON.stringify({ libVersion: '3.15.2' }))
    const result = scanCriticalRuntimeSyntax(fixture, { expectedVendorHash: '' })
    assert.ok(result.findings.some((finding) =>
      finding.file === 'project.config.json' &&
      finding.rule === 'pinned WeChat base library' &&
      finding.snippet.includes('3.15.1')))
  } finally {
    await rm(fixture, { recursive: true, force: true })
  }
})

test('requires upload settings that preserve the scanned JavaScript', async () => {
  const fixture = await createCriticalPageFixture()
  try {
    await writeFixture(fixture, 'project.config.json', JSON.stringify({
      libVersion: '3.15.1',
      setting: { es6: true, minified: true },
    }))
    const result = scanCriticalRuntimeSyntax(fixture, { expectedVendorHash: '' })
    assert.ok(result.findings.some((finding) =>
      finding.file === 'project.config.json' && finding.rule === 'upload preserves scanned JavaScript'))
  } finally {
    await rm(fixture, { recursive: true, force: true })
  }
})

test('rejects the DevTools enhanced compiler after package scanning', async () => {
  const fixture = await createCriticalPageFixture()
  try {
    await writeFixture(fixture, 'project.config.json', JSON.stringify({
      libVersion: '3.15.1',
      setting: { es6: false, minified: false, enhance: true },
    }))
    const result = scanCriticalRuntimeSyntax(fixture, { expectedVendorHash: '' })
    assert.ok(result.findings.some((finding) =>
      finding.file === 'project.config.json' && finding.rule === 'upload preserves scanned JavaScript'))
  } finally {
    await rm(fixture, { recursive: true, force: true })
  }
})

test('rejects forbidden syntax in every page declared by app.json', async () => {
  const fixture = await createCriticalPageFixture()
  try {
    await writeFixture(fixture, 'pages/search/index.js', 'const values = Object.fromEntries([])')
    const result = scanCriticalRuntimeSyntax(fixture, { expectedVendorHash: '' })
    assert.ok(result.findings.some((finding) =>
      finding.file === 'pages/search/index.js' && finding.rule === 'Object.fromEntries'))
  } finally {
    await rm(fixture, { recursive: true, force: true })
  }
})

test('rejects a missing dependency reachable from any declared page', async () => {
  const fixture = await createCriticalPageFixture()
  try {
    await writeFixture(fixture, 'pages/search/index.js', 'require("../../utils/missing-search-helper.js")')
    assert.throws(
      () => scanCriticalRuntimeSyntax(fixture, { expectedVendorHash: '' }),
      /Missing mp-weixin critical dependency chunk.*missing-search-helper\.js/,
    )
  } finally {
    await rm(fixture, { recursive: true, force: true })
  }
})

test('rejects dynamic require calls whose package dependency cannot be proven', async () => {
  const fixture = await createCriticalPageFixture()
  try {
    await writeFixture(fixture, 'pages/search/index.js', 'const helper = "../../utils/search-helper.js"; require(helper)')
    assert.throws(
      () => scanCriticalRuntimeSyntax(fixture, { expectedVendorHash: '' }),
      /Dynamic require prevents mp-weixin dependency verification.*pages.search.index\.js/i,
    )
  } finally {
    await rm(fixture, { recursive: true, force: true })
  }
})

test('rejects bare and package-escaping require requests', async () => {
  const fixture = await createCriticalPageFixture()
  try {
    await writeFixture(fixture, 'pages/search/index.js', 'require("missing-bare")')
    assert.throws(
      () => scanCriticalRuntimeSyntax(fixture, { expectedVendorHash: '' }),
      /Unsupported bare mp-weixin dependency request.*missing-bare/i,
    )

    await writeFixture(fixture, 'pages/search/index.js', 'require("../../../outside.js")')
    assert.throws(
      () => scanCriticalRuntimeSyntax(fixture, { expectedVendorHash: '' }),
      /mp-weixin dependency escapes package root.*outside\.js/i,
    )
  } finally {
    await rm(fixture, { recursive: true, force: true })
  }
})

test('rejects dynamic import dependencies that cannot be proven', async () => {
  const fixture = await createCriticalPageFixture()
  try {
    await writeFixture(fixture, 'pages/search/index.js', 'import("../../utils/missing-dynamic.js")')
    assert.throws(
      () => scanCriticalRuntimeSyntax(fixture, { expectedVendorHash: '' }),
      /Missing mp-weixin critical dependency chunk.*missing-dynamic\.js/i,
    )
  } finally {
    await rm(fixture, { recursive: true, force: true })
  }
})

test('requires complete page and local component artifacts', async () => {
  const fixture = await createCriticalPageFixture()
  try {
    await rm(join(fixture, 'components/GuideRouteDetailView.wxml'))
    assert.throws(
      () => scanCriticalRuntimeSyntax(fixture, { expectedVendorHash: '' }),
      /Missing mp-weixin component template.*GuideRouteDetailView\.wxml/i,
    )
  } finally {
    await rm(fixture, { recursive: true, force: true })
  }
})

test('requires component metadata even when its JavaScript was already visited as a module', async () => {
  const fixture = await createCriticalPageFixture()
  try {
    const fsPromises = await import('node:fs/promises')
    const appConfig = JSON.parse(await fsPromises.readFile(join(fixture, 'app.json'), 'utf8'))
    appConfig.pages.push('pages/component-owner/index', 'pages/module-user/index')
    await writeFixture(fixture, 'app.json', JSON.stringify(appConfig))
    await writeFixture(fixture, 'pages/component-owner/index.js', '')
    await writeFixture(fixture, 'pages/component-owner/index.json', JSON.stringify({
      usingComponents: { foo: '/components/Foo' },
    }))
    await writeFixture(fixture, 'pages/component-owner/index.wxml', '<foo />')
    await writeFixture(fixture, 'pages/module-user/index.js', 'require("../../components/Foo.js")')
    await writeFixture(fixture, 'pages/module-user/index.json', '{}')
    await writeFixture(fixture, 'pages/module-user/index.wxml', '<view />')
    await writeFixture(fixture, 'components/Foo.js', 'const safe = true')

    assert.throws(
      () => scanCriticalRuntimeSyntax(fixture, { expectedVendorHash: '' }),
      /Missing mp-weixin component config.*Foo\.json/i,
    )
  } finally {
    await rm(fixture, { recursive: true, force: true })
  }
})

test('requires local component JSON to declare component true', async () => {
  const fixture = await createCriticalPageFixture()
  try {
    await writeFixture(fixture, 'components/GuideRouteDetailView.json', '{}')
    assert.throws(
      () => scanCriticalRuntimeSyntax(fixture, { expectedVendorHash: '' }),
      /Invalid mp-weixin component config.*component=true.*GuideRouteDetailView\.json/i,
    )
  } finally {
    await rm(fixture, { recursive: true, force: true })
  }
})

test('validates app-level global components', async () => {
  const fixture = await createCriticalPageFixture()
  try {
    const fsPromises = await import('node:fs/promises')
    const appConfig = JSON.parse(await fsPromises.readFile(join(fixture, 'app.json'), 'utf8'))
    appConfig.usingComponents = { 'global-shell': '/components/MissingGlobalShell' }
    await writeFixture(fixture, 'app.json', JSON.stringify(appConfig))
    assert.throws(
      () => scanCriticalRuntimeSyntax(fixture, { expectedVendorHash: '' }),
      /Missing mp-weixin critical dependency chunk.*MissingGlobalShell\.js/i,
    )
  } finally {
    await rm(fixture, { recursive: true, force: true })
  }
})

test('recursively validates WXML and WXSS dependencies', async () => {
  const fixture = await createCriticalPageFixture()
  try {
    await writeFixture(fixture, 'pages/search/index.wxml', [
      '<import src="../../templates/missing-card.wxml" />',
      '<wxs src="../../utils/missing-format.wxs" module="format" />',
    ].join('\n'))
    assert.throws(
      () => scanCriticalRuntimeSyntax(fixture, { expectedVendorHash: '' }),
      /Missing mp-weixin template dependency.*missing-(card|format)/i,
    )

    await writeFixture(fixture, 'pages/search/index.wxml', '<view />')
    await writeFixture(fixture, 'pages/search/index.wxss', '@import "../../styles/missing-theme.wxss";')
    assert.throws(
      () => scanCriticalRuntimeSyntax(fixture, { expectedVendorHash: '' }),
      /Missing mp-weixin style dependency.*missing-theme\.wxss/i,
    )
  } finally {
    await rm(fixture, { recursive: true, force: true })
  }
})

test('scans subpackage pages and rejects page path traversal', async () => {
  const fixture = await createCriticalPageFixture()
  try {
    const appConfig = JSON.parse(await (await import('node:fs/promises')).readFile(join(fixture, 'app.json'), 'utf8'))
    appConfig.subPackages = [{ root: 'feature', pages: ['pages/tool/index'] }]
    await writeFixture(fixture, 'app.json', JSON.stringify(appConfig))
    await writeFixture(fixture, 'feature/pages/tool/index.js', 'const values = Object.fromEntries([])')
    await writeFixture(fixture, 'feature/pages/tool/index.json', '{}')
    await writeFixture(fixture, 'feature/pages/tool/index.wxml', '<view />')
    const result = scanCriticalRuntimeSyntax(fixture, { expectedVendorHash: '' })
    assert.ok(result.findings.some((finding) =>
      finding.file === 'feature/pages/tool/index.js' && finding.rule === 'Object.fromEntries'))

    appConfig.subPackages = [{ root: 'feature', pages: ['../../outside'] }]
    await writeFixture(fixture, 'app.json', JSON.stringify(appConfig))
    assert.throws(
      () => scanCriticalRuntimeSyntax(fixture, { expectedVendorHash: '' }),
      /Invalid mp-weixin page path outside app root/i,
    )
  } finally {
    await rm(fixture, { recursive: true, force: true })
  }
})

test('rejects forbidden syntax in a transitive home dependency', async () => {
  const fixture = await createCriticalPageFixture()
  try {
    await writeFixture(fixture, 'pages/index/index.js', 'require("../../utils/home-image-probe.js")')
    await writeFixture(fixture, 'utils/home-image-probe.js', 'const values = Array.from(new Set(["a"]))')
    const result = scanCriticalRuntimeSyntax(fixture, { expectedVendorHash: '' })
    assert.ok(result.findings.some((finding) =>
      finding.file === 'utils/home-image-probe.js' && finding.rule === 'Array.from'))
  } finally {
    await rm(fixture, { recursive: true, force: true })
  }
})

test('rejects Unicode property escapes in a transitive home dependency', async () => {
  const fixture = await createCriticalPageFixture()
  try {
    await writeFixture(fixture, 'pages/index/index.js', 'require("../../utils/section-icon.js")')
    await writeFixture(fixture, 'utils/section-icon.js', [
      'const literal = /\\p{Extended_Pictographic}/u',
      'const constructed = new RegExp("\\\\p{Extended_Pictographic}", "u")',
      'const called = RegExp("\\\\p{Emoji}", "u")',
      'const inverted = RegExp("\\\\P{ASCII}", "u")',
    ].join('\n'))

    const result = scanCriticalRuntimeSyntax(fixture, { expectedVendorHash: '' })

    assert.equal(result.findings.filter((finding) =>
      finding.file === 'utils/section-icon.js' && finding.rule === 'Unicode property escape').length, 4)
  } finally {
    await rm(fixture, { recursive: true, force: true })
  }
})

test('does not treat the mixed project/framework vendor bundle as a fixed framework hash by default', async () => {
  const fixture = await createCriticalPageFixture()
  try {
    await writeFixture(fixture, 'common/vendor.js', 'const changedFrameworkRuntime = true')
    assert.doesNotThrow(() => scanCriticalRuntimeSyntax(fixture))
    assert.throws(
      () => scanCriticalRuntimeSyntax(fixture, { expectedVendorHash: 'reviewed-framework-runtime' }),
      /framework runtime changed/,
    )
  } finally {
    await rm(fixture, { recursive: true, force: true })
  }
})

test('rejects Unicode property escapes in the mixed vendor bundle', async () => {
  const fixture = await createCriticalPageFixture()
  try {
    await writeFixture(fixture, 'common/vendor.js', 'const unsupported = /\\p{Extended_Pictographic}/u')
    const result = scanCriticalRuntimeSyntax(fixture)
    assert.ok(result.findings.some((finding) =>
      finding.file === 'common/vendor.js' && finding.rule === 'Unicode property escape'))
  } finally {
    await rm(fixture, { recursive: true, force: true })
  }
})

test('rejects an unreviewed compiled third-party runtime change', async () => {
  const fixture = await createCriticalPageFixture()
  try {
    await writeFixture(fixture, 'pages/search/index.js', 'require("/node-modules/example/index.js")')
    await writeFixture(fixture, 'node-modules/example/index.js', 'const thirdPartyRuntime = true')
    assert.throws(
      () => scanCriticalRuntimeSyntax(fixture, {
        expectedVendorHash: '',
        expectedNodeModulesHash: 'reviewed-third-party-runtime',
      }),
      /third-party runtime changed/i,
    )
  } finally {
    await rm(fixture, { recursive: true, force: true })
  }
})

test('keeps compiled third-party runtime hashing stable across generated component scope ids', async () => {
  const left = await createCriticalPageFixture()
  const right = await createCriticalPageFixture()
  try {
    await writeFixture(left, 'node-modules/example/index.js', 'render({id:e.sr("left","8ebe68d0-0"),c:"8ebe68d0-1-"+index})')
    await writeFixture(left, 'node-modules/example/index.wxml', '<view u-i="8ebe68d0-2" />')
    await writeFixture(left, 'node-modules/example/index.json', '{"u-i":"8ebe68d0-3"}')
    await writeFixture(right, 'node-modules/example/index.js', 'render({id:e.sr("left","4bc4639c-0"),c:"4bc4639c-1-"+index})')
    await writeFixture(right, 'node-modules/example/index.wxml', '<view u-i="4bc4639c-2" />')
    await writeFixture(right, 'node-modules/example/index.json', '{"u-i":"4bc4639c-3"}')

    const expectedHash = hashNodeModulesDirectory(join(left, 'node-modules'))
    assert.equal(hashNodeModulesDirectory(join(right, 'node-modules')), expectedHash)
    assert.doesNotThrow(() => scanCriticalRuntimeSyntax(left, { expectedVendorHash: '', expectedNodeModulesHash: expectedHash }))
    assert.doesNotThrow(() => scanCriticalRuntimeSyntax(right, { expectedVendorHash: '', expectedNodeModulesHash: expectedHash }))
  } finally {
    await rm(left, { recursive: true, force: true })
    await rm(right, { recursive: true, force: true })
  }
})

test('keeps real third-party runtime changes visible to hashing', async () => {
  const baseline = await createCriticalPageFixture()
  const codeChange = await createCriticalPageFixture()
  const nonScopeChange = await createCriticalPageFixture()
  try {
    await writeFixture(baseline, 'node-modules/example/index.js', 'const value = "8ebe68d0-0"')
    await writeFixture(codeChange, 'node-modules/example/index.js', 'const changed = "4bc4639c-0"')
    await writeFixture(nonScopeChange, 'node-modules/example/index.js', 'const value = "different-token"')

    const expectedHash = hashNodeModulesDirectory(join(baseline, 'node-modules'))
    assert.notEqual(hashNodeModulesDirectory(join(codeChange, 'node-modules')), expectedHash)
    assert.notEqual(hashNodeModulesDirectory(join(nonScopeChange, 'node-modules')), expectedHash)
    assert.throws(
      () => scanCriticalRuntimeSyntax(codeChange, { expectedVendorHash: '', expectedNodeModulesHash: expectedHash }),
      /third-party runtime changed/i,
    )
    assert.throws(
      () => scanCriticalRuntimeSyntax(nonScopeChange, { expectedVendorHash: '', expectedNodeModulesHash: expectedHash }),
      /third-party runtime changed/i,
    )
  } finally {
    await rm(baseline, { recursive: true, force: true })
    await rm(codeChange, { recursive: true, force: true })
    await rm(nonScopeChange, { recursive: true, force: true })
  }
})

test('does not normalize an ordinary scope-shaped third-party token', async () => {
  const left = await createCriticalPageFixture()
  const right = await createCriticalPageFixture()
  try {
    await writeFixture(left, 'node-modules/example/index.js', 'const version = "deadbeef-123"')
    await writeFixture(right, 'node-modules/example/index.js', 'const version = "feedface-123"')

    assert.notEqual(
      hashNodeModulesDirectory(join(left, 'node-modules')),
      hashNodeModulesDirectory(join(right, 'node-modules')),
    )
  } finally {
    await rm(left, { recursive: true, force: true })
    await rm(right, { recursive: true, force: true })
  }
})

test('rejects forbidden syntax in a transitive detail dependency', async () => {
  const fixture = await createCriticalPageFixture()
  try {
    const result = scanCriticalRuntimeSyntax(fixture, { expectedVendorHash: '' })
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
    const result = scanCriticalRuntimeSyntax(fixture, { expectedVendorHash: '' })
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
    const result = scanCriticalRuntimeSyntax(fixture, { expectedVendorHash: '' })
    assert.deepEqual(result.findings, [])
  } finally {
    await rm(fixture, { recursive: true, force: true })
  }
})
