// Shared helpers for individual H5 test scenario scripts.
// Each scenario runs in its own process, but reports and cleanup are standardized.

import { callAdmin, callAs, createCleanupRegistry, makeRunId } from '../lib/test-api.mjs'
import { sanitizeName, writeNamedReport } from '../lib/reporting.mjs'

const cleanupRegistry = createCleanupRegistry()

export { callAdmin, callAs, makeRunId }

export function trackCommunity(communityId) {
  return cleanupRegistry.trackCommunity(communityId)
}

// Simple assert helper that tracks pass/fail, executes cleanup, and emits a scenario report.
export function createAsserter(scenarioName) {
  let passed = 0
  let failed = 0

  const assert = (cond, msg) => {
    if (cond) {
      passed++
      console.log(`  PASS ${msg}`)
    } else {
      failed++
      console.error(`  FAIL ${msg}`)
    }
  }

  const expectReject = async (fn, label) => {
    try {
      await fn()
      failed++
      console.error(`  FAIL ${label}: expected rejection but succeeded`)
    } catch (err) {
      passed++
      console.log(`  PASS ${label} (${String(err.message).slice(0, 80)})`)
    }
  }

  const finish = async () => {
    const cleanup = await cleanupRegistry.cleanupAll(console)
    const exitCode = failed > 0 || !cleanup.ok ? 1 : 0
    const reportDir = process.env.HH_REPORT_DIR || ''

    if (reportDir) {
      await writeNamedReport(reportDir, `${sanitizeName(scenarioName)}.json`, {
        scenario: scenarioName,
        passed,
        failed,
        cleanup,
        exitCode,
        finishedAt: new Date().toISOString(),
      })
    }

    console.log(`\n[${scenarioName}] ${passed} passed, ${failed} failed`)
    if (!cleanup.ok) {
      console.error(`[${scenarioName}] cleanup issues: ${cleanup.issues.map((x) => `${x.communityId}: ${x.message}`).join('; ')}`)
    }
    process.exit(exitCode)
  }

  return { assert, expectReject, finish }
}

// Helper to set up a fresh community + section + widget for scenarios that need one.
// Returns { ownerOpenid, communityId, sectionId, widgetId }.
export async function seedApprovedCommunity(runId) {
  const owner = `seed-owner-${runId}`
  await callAs(owner, 'user', 'login', { nickName: `Seeder-${runId}`, avatarUrl: '' })
  const { communityId } = await callAs(owner, 'community', 'create', {
    name: `Scenario绀惧尯-${runId}`,
    description: 'seeded by scenario script',
    coverImage: '',
    location: { province: 'P', city: 'C', district: 'D', address: 'A' },
    joinType: 'open',
  })
  trackCommunity(communityId)
  await callAdmin('community.approve', { communityId })
  const { sectionId } = await callAdmin('section.create', {
    communityId, name: '榛樿鏉垮潡', icon: '馃搵', order: 0,
  })
  const { widgets } = await callAdmin('section.updateWidgets', {
    sectionId,
    widgets: [{ type: 'short_text', label: '鍐呭', required: true, showInList: true, widgetId: '' }],
  })
  return { ownerOpenid: owner, communityId, sectionId, widgetId: widgets[0].widgetId }
}
