import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assertReleaseUiEvidence,
  buildDevToolsAutoArgs,
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

test('requires home detail and login page release UI evidence', () => {
  assert.throws(() => assertReleaseUiEvidence({
    homeDetailNonEmpty: true,
    loginPageReady: false,
  }), /HH_RELEASE_LOGIN_READY/)

  assert.doesNotThrow(() => assertReleaseUiEvidence({
    homeDetailNonEmpty: true,
    loginPageReady: true,
  }))
})

test('documents the release UI evidence markers used by the gate', () => {
  assert.deepEqual(REQUIRED_RELEASE_UI_MARKERS.map((item) => item.marker), [
    'HH_RELEASE_HOME_DETAIL_NONEMPTY',
    'HH_RELEASE_LOGIN_READY',
  ])
})
