#!/usr/bin/env node
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, isAbsolute, join, resolve, win32 } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import process from 'node:process'
import { acquireIntegrationLock, parsePrNumber, resolveSpawnInvocation } from './lib/integrate-pr-policy.mjs'
import { CANONICAL_MAIN_WORKSPACE } from './lib/worktree-policy.mjs'
import { VALIDATOR_PATH, assertAttestation, createManifest, discoverWorkflowCandidate, executeTrustedApply, findValidatorRun } from './lib/trusted-workflow-policy.mjs'

const VALIDATOR_WORKFLOW = basename(VALIDATOR_PATH)
function run(command, args, { cwd = process.cwd(), encoding = 'utf8' } = {}) {
  const invocation = resolveSpawnInvocation(command, args)
  const result = spawnSync(invocation.command, invocation.args, { cwd, encoding, windowsHide: true })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed: ${String(result.stderr || result.stdout || `exit ${result.status}`).trim()}`)
  return result.stdout
}
const output = (command, args, cwd) => String(run(command, args, { cwd }) || '').trim()
const normalizePath = (value) => String(value).replace(/^\\\\\?\\/, '').replace(/\\/g, '/').replace(/\/$/, '').toLowerCase()
const argument = (name) => process.argv.slice(2).find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3)
function lockPath(root, commonDir) {
  if (/^[a-z]:[\\/]/i.test(root)) return win32.join(win32.isAbsolute(commonDir) ? commonDir : win32.resolve(root, commonDir), 'happyhome-integrate-pr.lock')
  return join(isAbsolute(commonDir) ? commonDir : resolve(root, commonDir), 'happyhome-integrate-pr.lock')
}
function assertClean(status, manifestPath) {
  const allowed = manifestPath ? normalizePath(resolve(manifestPath)) : ''
  const unexpected = String(status).split(/\r?\n/).filter(Boolean).filter((line) => !allowed || normalizePath(resolve(line.slice(3).trim().replace(/^"|"$/g, ''))) !== allowed)
  if (unexpected.length) throw new Error(`Trusted workflow integration requires a clean worktree; changed: ${unexpected.join(', ')}`)
}
function inspectCandidate(root, prNumber) {
  run('git', ['fetch', 'origin', 'main'], { cwd: root }); run('git', ['fetch', 'origin', `pull/${prNumber}/head`], { cwd: root })
  const pr = JSON.parse(output('gh', ['pr', 'view', String(prNumber), '--json', 'number,state,isDraft,baseRefName,headRefOid,url'], root))
  if (pr.state !== 'OPEN' || pr.isDraft || pr.baseRefName !== 'main' || !pr.headRefOid) throw new Error('PR must be OPEN, non-draft, based on main, with an exact head commit')
  const baseSha = output('git', ['rev-parse', 'origin/main'], root)
  try { run('git', ['merge-base', '--is-ancestor', baseSha, pr.headRefOid], { cwd: root }) } catch { throw new Error(`PR head ${pr.headRefOid} does not include latest main`) }
  const discovered = discoverWorkflowCandidate({ root, baseSha, headSha: pr.headRefOid, runCommand: run })
  return { baseSha, headSha: pr.headRefOid, ...discovered, validatorWorkflowSha: baseSha }
}
function downloadAttestation(root, runId, requestId) {
  const directory = join(tmpdir(), `happyhome-workflow-${runId}-${randomUUID()}`); mkdirSync(directory, { recursive: true })
  try {
    run('gh', ['run', 'download', String(runId), '--name', `trusted-workflow-attestation-${requestId}`, '--dir', directory], { cwd: root })
    const path = join(directory, 'trusted-workflow-attestation.json')
    if (!existsSync(path)) throw new Error('Validator attestation artifact is missing')
    return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''))
  } finally { rmSync(directory, { recursive: true, force: true }) }
}
async function main() {
  const args = process.argv.slice(2), prNumber = parsePrNumber(argument('pr')), prepare = args.includes('--prepare'), apply = args.includes('--apply')
  if (prepare === apply) throw new Error('Choose exactly one of --prepare or --apply')
  const root = output('git', ['rev-parse', '--show-toplevel'], process.cwd())
  if (normalizePath(root) !== normalizePath(CANONICAL_MAIN_WORKSPACE)) throw new Error(`Must run from canonical main ${CANONICAL_MAIN_WORKSPACE}`)
  if (output('git', ['branch', '--show-current'], root) !== 'main') throw new Error('Must run on branch main')
  const manifestPath = argument('manifest'); assertClean(output('git', ['status', '--porcelain=v1', '--untracked-files=all'], root), apply ? manifestPath : undefined)
  const release = acquireIntegrationLock(lockPath(root, output('git', ['rev-parse', '--git-common-dir'], root)), { prNumber })
  try {
    const candidate = inspectCandidate(root, prNumber)
    if (prepare) {
      const requestId = randomUUID()
      run('gh', ['workflow', 'run', VALIDATOR_WORKFLOW, '--ref', 'main', '-f', `prNumber=${prNumber}`, '-f', `baseSha=${candidate.baseSha}`, '-f', `headSha=${candidate.headSha}`, '-f', `diffSha256=${candidate.diffSha256}`, '-f', `requestId=${requestId}`], { cwd: root })
      let info
      for (let attempt = 0; attempt < 20 && !info; attempt += 1) {
        info = JSON.parse(output('gh', ['run', 'list', '--workflow', VALIDATOR_WORKFLOW, '--event', 'workflow_dispatch', '--limit', '20', '--json', 'databaseId,displayTitle,status,conclusion,headSha,createdAt'], root)).find((item) => item.displayTitle?.includes(requestId))
        if (!info) await new Promise((resolveDelay) => setTimeout(resolveDelay, 3000))
      }
      if (!info) throw new Error(`Unable to find validator run for request ${requestId}`)
      run('gh', ['run', 'watch', String(info.databaseId), '--exit-status'], { cwd: root })
      info = findValidatorRun([JSON.parse(output('gh', ['run', 'view', String(info.databaseId), '--json', 'databaseId,displayTitle,status,conclusion,headSha,createdAt'], root))], requestId, candidate.validatorWorkflowSha)
      const attestation = downloadAttestation(root, info.databaseId, requestId)
      assertAttestation(attestation, { schemaVersion: 1, prNumber, ...candidate, requestId, runId: info.databaseId, validatedAt: attestation.validatedAt })
      const runCreatedAt = new Date(info.createdAt).toISOString()
      const manifest = createManifest({ prNumber, ...candidate, requestId, runId: info.databaseId, runCreatedAt, attestation, createdAt: attestation.validatedAt })
      const directory = join(root, '.codex-local', 'workflow-integrations'); mkdirSync(directory, { recursive: true })
      const path = join(directory, `pr-${prNumber}-${requestId}.json`); writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
      console.log(`[integrate-workflow-pr] manifest: ${path}`); console.log(`[integrate-workflow-pr] approval: ${manifest.approvalPhrase}`)
    } else {
      if (!manifestPath) throw new Error('--manifest is required for --apply')
      const manifest = JSON.parse(readFileSync(resolve(manifestPath), 'utf8'))
      if (manifest.prNumber !== prNumber) throw new Error('Manifest PR mismatch')
      const attestation = downloadAttestation(root, manifest.runId, manifest.requestId)
      const runInfo = findValidatorRun([JSON.parse(output('gh', ['run', 'view', String(manifest.runId), '--json', 'databaseId,displayTitle,status,conclusion,headSha,createdAt'], root))], manifest.requestId, manifest.validatorWorkflowSha)
      await executeTrustedApply({
        manifest,
        current: { now: new Date().toISOString(), approval: argument('approve'), ...candidate, prNumber, requestId: manifest.requestId, runId: manifest.runId, runCreatedAt: new Date(runInfo.createdAt).toISOString(), attestation },
        refreshBase: async () => { run('git', ['fetch', 'origin', 'main'], { cwd: root }); return output('git', ['rev-parse', 'origin/main'], root) },
        readPullRequest: async () => JSON.parse(output('gh', ['pr', 'view', String(prNumber), '--json', 'state,isDraft,baseRefName,baseRefOid,headRefOid,mergeStateStatus'], root)),
        merge: async () => run('gh', ['pr', 'merge', String(prNumber), '--merge', '--match-head-commit', candidate.headSha], { cwd: root }),
        pull: async () => run('git', ['pull', '--ff-only', 'origin', 'main'], { cwd: root }),
      })
      console.log(`[integrate-workflow-pr] merged PR #${prNumber} at ${candidate.headSha}`)
    }
  } finally { release() }
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((error) => { console.error(`[integrate-workflow-pr] ${error.message}`); process.exitCode = 1 })
