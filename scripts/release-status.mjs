#!/usr/bin/env node
import process from 'node:process'

import {
  formatReleaseRunStatus,
  loadLatestReleaseRun,
  loadReleaseRun,
} from './lib/release-run-ledger.mjs'

function getFlagValue(name) {
  const equalsArg = process.argv.find((arg) => arg.startsWith(`--${name}=`))
  if (equalsArg) return equalsArg.slice(name.length + 3)
  const index = process.argv.indexOf(`--${name}`)
  if (index >= 0 && process.argv[index + 1] && !process.argv[index + 1].startsWith('--')) return process.argv[index + 1]
  return ''
}

try {
  const runId = getFlagValue('run-id') || getFlagValue('release-run-id')
  const state = runId
    ? await loadReleaseRun(process.cwd(), runId)
    : await loadLatestReleaseRun(process.cwd())
  console.log(formatReleaseRunStatus(state))
} catch (error) {
  console.error(`[release-status] ${error?.message || error}`)
  process.exitCode = 1
}
