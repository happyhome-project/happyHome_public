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
  assert.match(callMpCloud, /action === 'community\.hardDelete'.*invokeTrustedAdminCloud\(data, \{ timeoutMs, attempts: 2 \}\)/s)
  assert.match(callMpCloud, /name === 'admin'.*callTrustedAdminCloud/s)
  assert.doesNotMatch(callMpCloud, /ADMIN_INTERNAL_CALL_TOKEN|requireAdminInternalToken|_internalToken/)
  assert.match(source, /happyhome-release-admin-/)
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

test('requires cold-start home, home images, sticky archive tabs, home detail, login version, and clean profile login release UI evidence', () => {
  assert.throws(() => assertReleaseUiEvidence({
    homeColdStartNonEmpty: false,
    homeImagesRendered: true,
    homeArchiveTabsSticky: true,
    homeDetailNonEmpty: true,
    loginVersionVisible: true,
    profileLoginClean: true,
  }), /HH_RELEASE_HOME_COLD_START_NONEMPTY/)

  assert.throws(() => assertReleaseUiEvidence({
    homeColdStartNonEmpty: true,
    homeImagesRendered: true,
    homeArchiveTabsSticky: false,
    homeDetailNonEmpty: true,
    loginVersionVisible: true,
    profileLoginClean: true,
  }), /HH_RELEASE_HOME_ARCHIVE_TABS_STICKY/)

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
    'HH_RELEASE_HOME_ARCHIVE_TABS_STICKY',
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

  assert.match(source, /attribute\('data-build-version'\)/)
  assert.match(source, /!text\.includes\(expectedVersion\)/)
  assert.match(source, /const buildIdentityPassed =/)
  assert.match(source, /loginBuildIdentityVerified: profileLoginClean\.buildIdentityPassed/)
})

test('release home tabs evidence pins below the fixed masthead', () => {
  const source = readFileSync(new URL('../test-mp-release-ui.mjs', import.meta.url), 'utf8')

  assert.match(source, /query\.select\('\.home-topbar'\)\.boundingClientRect\(\)/)
  assert.match(source, /Math\.abs\(pinnedTop - Number\(pinned\.topbar\?\.bottom \|\| 0\)\) <= 8/)
  assert.doesNotMatch(source, /Math\.abs\(pinnedTop - pinned\.safeTop\) <= 8/)
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
