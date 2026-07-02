import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { isDevtoolsLoginSigningFailure, shouldFallbackAfterDevtoolsFailure } from './release-policy.mjs'

test('blocks fallback when DevTools login or signing state is bad', () => {
  assert.equal(isDevtoolsLoginSigningFailure('Cloud API signed-header failure'), true)
  assert.equal(isDevtoolsLoginSigningFailure('getCloudAPISignedHeader failed ret=41002'), true)
  assert.equal(shouldFallbackAfterDevtoolsFailure({
    target: 'cloud',
    reason: 'Cloud API signed-header failure',
  }), false)
})

test('blocks miniprogram upload fallback unless explicitly forced', () => {
  assert.equal(shouldFallbackAfterDevtoolsFailure({
    target: 'miniprogram-upload',
    reason: 'DevTools CLI unavailable',
  }), false)
  assert.equal(shouldFallbackAfterDevtoolsFailure({
    target: 'miniprogram-upload',
    reason: 'DevTools CLI unavailable',
    forceCi: true,
  }), true)
})

test('allows non-upload fallback for non-login DevTools failures', () => {
  assert.equal(shouldFallbackAfterDevtoolsFailure({
    target: 'cloud',
    reason: 'DevTools CLI not found',
  }), true)
})

test('release cloud smoke ensures required database collections before invoking fixtures', () => {
  const deployScript = readFileSync(new URL('../deploy.mjs', import.meta.url), 'utf8')
  const ensureIndexesScript = readFileSync(new URL('../ensure-indexes.mjs', import.meta.url), 'utf8')
  const runCloudSmokeBody = deployScript.match(/async function runCloudSmoke[\s\S]+?\n}/)?.[0] || ''

  assert.match(ensureIndexesScript, /content_audit_tasks/)
  assert.match(ensureIndexesScript, /admin_notification_subscriptions/)
  assert.match(ensureIndexesScript, /admin_notifications/)
  assert.match(runCloudSmokeBody, /ensure:indexes/)
  assert(runCloudSmokeBody.indexOf('ensure:indexes') < runCloudSmokeBody.indexOf('runCloudReleaseSmoke'))
})

test('formal release path records resumable ledger stages before upload', () => {
  const deployScript = readFileSync(new URL('../deploy.mjs', import.meta.url), 'utf8')
  const releaseBlock = deployScript.match(/if \(target === 'release'\) \{[\s\S]+?\n\} else \{/)?.[0] || ''

  assert.match(deployScript, /release-run-ledger\.mjs/)
  assert.match(releaseBlock, /runLedgerStage\(releaseLedger,\s*'miniprogram-build-gate'/)
  assert.match(releaseBlock, /runLedgerStage\(releaseLedger,\s*'cloud-deploy'/)
  assert.match(releaseBlock, /runLedgerStage\(releaseLedger,\s*'cloud-smoke'/)
  assert.match(releaseBlock, /runLedgerStage\(releaseLedger,\s*'admin-web-deploy'/)
  assert.match(releaseBlock, /runLedgerStage\(releaseLedger,\s*'miniprogram-upload'/)
  assert.match(deployScript, /inspectReleaseStageReuse/)
  assert.match(releaseBlock, /reuseCheck/)

  assert(releaseBlock.indexOf("'cloud-smoke'") < releaseBlock.indexOf("'admin-web-deploy'"))
  assert(releaseBlock.indexOf("'admin-web-deploy'") < releaseBlock.indexOf("'miniprogram-upload'"))
  assert(releaseBlock.indexOf("'miniprogram-upload'") < releaseBlock.indexOf('complete'))
})

test('package exposes a release status command for the latest ledger', () => {
  const packageJson = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
  assert.equal(packageJson.scripts['release:status'], 'node scripts/release-status.mjs')
})
