#!/usr/bin/env node
import process from 'node:process'

import { createProductionReleaseStore } from './lib/cloudbase-release-store.mjs'
import { ReleaseGovernance } from './lib/release-governance.mjs'
import {
  confirmReleaseLedgerAgainstProductionInspection,
  createReleaseRunLedger,
  loadReleaseRun,
  productionInspectionProvesReleaseCompletion,
} from './lib/release-run-ledger.mjs'

function getFlagValue(name) {
  const equalsArg = process.argv.find((arg) => arg.startsWith(`--${name}=`))
  if (equalsArg) return equalsArg.slice(name.length + 3)
  const index = process.argv.indexOf(`--${name}`)
  if (index >= 0 && process.argv[index + 1] && !process.argv[index + 1].startsWith('--')) return process.argv[index + 1]
  return ''
}

async function run() {
  const runId = getFlagValue('run-id') || getFlagValue('release-run-id')
  if (!runId) throw new Error('release:reconcile requires --run-id <id>')

  const root = process.cwd()
  const existing = await loadReleaseRun(root, runId)
  if (existing.status === 'passed') {
    console.log(`[release-reconcile] run ${runId} is already passed`)
    return
  }
  const governance = new ReleaseGovernance({ store: createProductionReleaseStore({ root }) })
  const productionInspection = await governance.inspect({ runId })
  if (!productionInspectionProvesReleaseCompletion({ runId, state: existing }, productionInspection)) {
    throw new Error(`Production state does not prove completion for run ${runId} at ${existing.context?.gitSha || ''}`)
  }
  const ledger = await createReleaseRunLedger({
    root,
    runId,
    command: existing.command,
    gitSha: existing.context?.gitSha,
    version: existing.context?.version,
    desc: existing.context?.desc,
    envId: existing.context?.envId,
  })
  const evidence = await confirmReleaseLedgerAgainstProductionInspection({ ledger, productionInspection })
  console.log(`[release-reconcile] PASS run=${runId} git=${evidence.gitSha}`)
}

run().catch((error) => {
  console.error(`[release-reconcile] ${error?.message || error}`)
  process.exitCode = 1
})
