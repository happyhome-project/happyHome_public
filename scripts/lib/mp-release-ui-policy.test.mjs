import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  assertReleaseUiEvidence,
  assertColdStartDevToolsEnabled,
  buildDevToolsAutoArgs,
  buildDevToolsCacheArgs,
  buildDevToolsCloseArgs,
  buildDevToolsQuitArgs,
  buildDevToolsQuitPortArgs,
  REQUIRED_RELEASE_UI_MARKERS,
} from './mp-release-ui-policy.mjs'

test('release UI fixture capability stays in the trusted Node process', () => {
  const source = readFileSync(new URL('../test-mp-release-ui.mjs', import.meta.url), 'utf8')
  const callMpCloud = source.slice(
    source.indexOf('async function callMpCloud'),
    source.indexOf('async function callTrustedAdminCloud'),
  )
  assert.match(callMpCloud, /action === 'community\.hardDelete'.*invokeTrustedAdminCloud\(data, \{ timeoutMs, attempts: Number\(options\.attempts \|\| 2\) \}\)/s)
  assert.match(callMpCloud, /name === 'admin'.*callTrustedAdminCloud/s)
  assert.doesNotMatch(callMpCloud, /ADMIN_INTERNAL_CALL_TOKEN|requireAdminInternalToken|_internalToken/)
  assert.match(source, /happyhome-release-admin-/)
  assert.match(source, /cleanupReleaseFixtureWithRetry\([\s\S]*attempts: 1/)
})

test('builds DevTools auto args with hidden automator websocket port', () => {
  assert.deepEqual(buildDevToolsAutoArgs({
    projectPath: 'dist/mp',
    idePort: 21929,
    autoPort: 9420,
  }), [
    'auto',
    '--project', 'dist/mp',
    '--port', '21929',
    '--auto-port', '9420',
    '--trust-project',
  ])
})

test('builds DevTools quit args for stale automator recovery', () => {
  assert.deepEqual(buildDevToolsQuitArgs(), ['quit'])
})

test('requires release UI evidence to start from a clean DevTools process state', () => {
  assert.throws(
    () => assertColdStartDevToolsEnabled({ HH_RELEASE_UI_COLD_START_DEVTOOLS: '0' }),
    /must not be disabled/i,
  )
  assert.doesNotThrow(() => assertColdStartDevToolsEnabled({}))
})

test('builds DevTools maintenance args bound to one IDE port', () => {
  assert.deepEqual(buildDevToolsQuitPortArgs({ idePort: 21929 }), [
    'quit',
    '--port', '21929',
  ])

  assert.deepEqual(buildDevToolsCloseArgs({
    projectPath: 'dist/mp',
    idePort: 21929,
  }), [
    'close',
    '--project', 'dist/mp',
    '--port', '21929',
  ])

  assert.deepEqual(buildDevToolsCacheArgs({
    clean: 'compile',
    projectPath: 'dist/mp',
    idePort: 21929,
  }), [
    'cache',
    '--clean', 'compile',
    '--project', 'dist/mp',
    '--port', '21929',
  ])
})

test('requires cold-start home, home images, home detail, login version, and clean profile login release UI evidence', () => {
  assert.throws(() => assertReleaseUiEvidence({
    homeColdStartNonEmpty: false,
    homeImagesRendered: true,
    homeArchiveTabsSticky: true,
    homeDetailNonEmpty: true,
    loginVersionVisible: true,
    profileLoginClean: true,
  }), /HH_RELEASE_HOME_COLD_START_NONEMPTY/)

  assert.doesNotThrow(() => assertReleaseUiEvidence({
    homeColdStartNonEmpty: true,
    homeImagesRendered: true,
    homeArchiveTabsSticky: false,
    homeDetailNonEmpty: true,
    loginVersionVisible: true,
    profileLoginClean: true,
  }))

  assert.throws(() => assertReleaseUiEvidence({
    homeColdStartNonEmpty: true,
    homeImagesRendered: true,
    homeArchiveTabsSticky: true,
    homeDetailNonEmpty: true,
    loginVersionVisible: true,
    profileLoginClean: false,
  }), /HH_RELEASE_PROFILE_LOGIN_CLEAN/)

  assert.throws(() => assertReleaseUiEvidence({
    homeColdStartNonEmpty: true,
    homeImagesRendered: true,
    homeArchiveTabsSticky: true,
    homeDetailNonEmpty: true,
    loginBuildIdentityVerified: false,
    profileLoginClean: true,
  }), /HH_RELEASE_LOGIN_VERSION/)

  assert.doesNotThrow(() => assertReleaseUiEvidence({
    homeColdStartNonEmpty: true,
    homeImagesRendered: true,
    homeArchiveTabsSticky: true,
    homeDetailNonEmpty: true,
    loginBuildIdentityVerified: true,
    profileLoginClean: true,
  }))

  assert.doesNotThrow(() => assertReleaseUiEvidence({
    homeColdStartNonEmpty: true,
    homeImagesRendered: true,
    homeArchiveTabsSticky: true,
    homeDetailNonEmpty: true,
    loginVersionVisible: true,
    profileLoginClean: true,
  }))
})

test('documents the release UI evidence markers used by the gate', () => {
  assert.deepEqual(REQUIRED_RELEASE_UI_MARKERS.map((item) => item.marker), [
    'HH_RELEASE_HOME_COLD_START_NONEMPTY',
    'HH_RELEASE_HOME_IMAGES_RENDERED',
    'HH_RELEASE_HOME_DETAIL_NONEMPTY',
    'HH_RELEASE_LOGIN_VERSION',
    'HH_RELEASE_PROFILE_LOGIN_CLEAN',
  ])
  assert.match(
    REQUIRED_RELEASE_UI_MARKERS.find((item) => item.marker === 'HH_RELEASE_LOGIN_VERSION')?.description || '',
    /data-build-version/,
  )
})

test('release profile validation reads the build marker attribute and rejects visible version text', () => {
  const source = readFileSync(new URL('../test-mp-release-ui.mjs', import.meta.url), 'utf8')

  assert.match(source, /readMiniprogramPackageIdentity\(projectPath\)/)
  assert.match(source, /verifyProfileLoginClean\(currentMp, packageIdentity\.version\)/)
  assert.doesNotMatch(source, /function expectedBuildVersion/)
  assert.match(source, /attribute\('data-build-version'\)/)
  assert.match(source, /!text\.includes\(expectedVersion\)/)
  assert.match(source, /const buildIdentityPassed =/)
  assert.match(source, /loginBuildIdentityVerified: evidence\.profileLoginClean\?\.buildIdentityPassed/)
})

test('release home tabs evidence pins below the fixed masthead', () => {
  const source = readFileSync(new URL('../test-mp-release-ui.mjs', import.meta.url), 'utf8')

  assert.match(source, /query\.select\('\.home-topbar'\)\.boundingClientRect\(\)/)
  assert.match(source, /query\.select\('\.home-search-sticky-shell'\)\.boundingClientRect\(\)/)
  assert.match(source, /home\.\$\('archive-topic-tabs'\)/)
  assert.match(source, /topicTabsHost\.\$\$\('\.archive-topic-tab'\)/)
  assert.match(source, /topicTabsHost\.\$\$\('\.archive-topic-tab--active'\)/)
  assert.match(source, /async function waitForHomeArchiveContent/)
  assert.match(source, /activeTabTexts/)
  assert.match(source, /page\.\$\('archive-waterfall'\)/)
  assert.match(source, /waterfallHost\.\$\$\('\.archive-waterfall__card'\)/)
  assert.doesNotMatch(source, /['"]\.section-tab(?:\.active)?['"]/)
  assert.doesNotMatch(source, /\.arc-item/)
  assert.match(source, /searchPinned/)
  assert.match(source, /tagsPinned/)
  assert.doesNotMatch(source, /Math\.abs\(shortArchive\.scrollTop - tagsPinned\.scrollTop\)/)
  assert.ok((source.match(/applyReleaseFixtureMembership/g) || []).length >= 3)
  assert.doesNotMatch(source, /Math\.abs\(pinnedTop - pinned\.safeTop\) <= 8/)
})

test('release home tabs fixture populates the visible native archive feed', () => {
  const source = readFileSync(new URL('../test-mp-release-ui.mjs', import.meta.url), 'utf8')
  const fixture = source.slice(
    source.indexOf('async function createReleaseFixture'),
    source.indexOf('async function seedCurrentViewerIntoCommunity'),
  )

  assert.match(source, /import \{ applyReleaseFixtureMembership \} from '\.\/lib\/release-ui-fixture-membership\.mjs'/)
  assert.match(fixture, /await applyReleaseFixtureMembership\(/)
  assert.match(fixture, /action: 'apply', communityId: fixture\.communityId/)
  assert.match(fixture, /for \(let index = 0; index < 3; index \+= 1\)/)
  assert.match(fixture, /action: 'create'/)
  assert.match(fixture, /area: 'archive'/)
  assert.match(fixture, /format: 'text'/)
  assert.match(fixture, /topics: index === 2 \? \['短内容'\] : \[\]/)
  assert.match(fixture, /format: 'markdown'/)
  assert.match(fixture, /markdown: 'Automated release validation post\.'/)
  assert.match(fixture, /html: '<p>Automated release validation post\.<\/p>'/)
  assert.doesNotMatch(fixture, /action: 'section\.create'/)
  assert.doesNotMatch(fixture, /action: 'post\.createAdmin'/)
})

test('release home image evidence requires loaded images and one visible viewport image', () => {
  const source = readFileSync(new URL('../test-mp-release-ui.mjs', import.meta.url), 'utf8')

  assert.match(source, /Number\(homeImageLayout\?\.visibleCount \|\| 0\) > 0/)
  assert.doesNotMatch(source, /visibleCount \|\| 0\) >= Number\(homeImages\?\.loadedCount/)
})

test('optional DevTools screenshot cannot block structured home tabs evidence', () => {
  const source = readFileSync(new URL('../test-mp-release-ui.mjs', import.meta.url), 'utf8')
  const helperStart = source.indexOf('async function captureOptionalReleaseUiScreenshot')
  const helperEnd = source.indexOf('async function verifyHomeArchiveTabs')
  const outsideHelper = `${source.slice(0, helperStart)}${source.slice(helperEnd)}`

  assert.match(source, /async function captureOptionalReleaseUiScreenshot/)
  assert.match(source, /HH_RELEASE_UI_CAPTURE_SCREENSHOT !== '1'/)
  assert.match(source, /withTimeout\(mp\.screenshot/)
  assert.match(source, /HH_RELEASE_UI_SCREENSHOT_TIMEOUT_MS/)
  assert.match(source, /screenshotEvidence/)
  assert.ok(source.match(/captureOptionalReleaseUiScreenshot/g).length >= 3)
  assert.doesNotMatch(outsideHelper, /\.screenshot\(/)
})

test('native release profile validation requires one logged-out login identity entry', () => {
  const source = readFileSync(new URL('../test-mp-release-ui.mjs', import.meta.url), 'utf8')

  assert.match(source, /\$\$\('\[data-testid="profile-login-entry"\]'\)/)
  assert.match(source, /loginEntryCount === 1/)
  assert.match(source, /text\.includes\('登录'\)/)
  assert.match(source, /loginEntryCount,/)
})

test('H5 profile smoke checks login-entry uniqueness before either login path branches', () => {
  const source = readFileSync(new URL('../test-h5-profile-smoke.mjs', import.meta.url), 'utf8')
  const uniquenessIndex = source.indexOf('expected one profile login identity entry')
  const fallbackBranchIndex = source.indexOf('if (options.openManualLogin)')

  assert.ok(uniquenessIndex > -1)
  assert.ok(uniquenessIndex < fallbackBranchIndex)
})
