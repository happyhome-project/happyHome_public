import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assertReleaseUiEvidence,
  buildDevToolsAutoArgs,
  buildDevToolsCacheArgs,
  buildDevToolsCloseArgs,
  buildDevToolsQuitArgs,
  buildDevToolsQuitPortArgs,
  REQUIRED_RELEASE_UI_MARKERS,
} from './mp-release-ui-policy.mjs'

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

test('requires home detail, login version, and clean profile login release UI evidence', () => {
  assert.throws(() => assertReleaseUiEvidence({
    homeDetailNonEmpty: true,
    loginVersionVisible: true,
    profileLoginClean: false,
  }), /HH_RELEASE_PROFILE_LOGIN_CLEAN/)

  assert.throws(() => assertReleaseUiEvidence({
    homeDetailNonEmpty: true,
    loginVersionVisible: false,
    profileLoginClean: true,
  }), /HH_RELEASE_LOGIN_VERSION/)

  assert.doesNotThrow(() => assertReleaseUiEvidence({
    homeDetailNonEmpty: true,
    loginVersionVisible: true,
    profileLoginClean: true,
  }))
})

test('documents the release UI evidence markers used by the gate', () => {
  assert.deepEqual(REQUIRED_RELEASE_UI_MARKERS.map((item) => item.marker), [
    'HH_RELEASE_HOME_DETAIL_NONEMPTY',
    'HH_RELEASE_LOGIN_VERSION',
    'HH_RELEASE_PROFILE_LOGIN_CLEAN',
  ])
})
