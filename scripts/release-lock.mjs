#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { createProductionReleaseStore } from './lib/cloudbase-release-store.mjs'
import { parseReleaseLockCommand, summarizeReleaseLockInspection } from './lib/release-lock-command.mjs'
import { ReleaseGovernance } from './lib/release-governance.mjs'

try {
  const command = parseReleaseLockCommand(process.argv.slice(2))
  const root = process.cwd()
  const store = createProductionReleaseStore({ root })
  const governance = new ReleaseGovernance({ store })
  if (command.command === 'status') {
    console.log(summarizeReleaseLockInspection(await governance.inspect()))
  } else {
    const evidencePath = resolve(root, command.evidenceFile)
    const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'))
    await governance.recover({ ...command, evidence })
    console.log(JSON.stringify({ recovered: command.runId }, null, 2))
  }
} catch (error) {
  console.error(`[release-lock] ${error?.message || error}`)
  process.exitCode = 1
}
