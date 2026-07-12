#!/usr/bin/env node
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, isAbsolute, join, resolve, win32 } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import process from 'node:process'
import { acquireIntegrationLock, parsePrNumber, resolveSpawnInvocation } from './lib/integrate-pr-policy.mjs'
import { TRUSTED_REPOSITORY, VALIDATOR_PATH, assertAttestation, assertTrustedWorkflowWorkspace, createManifest, discoverWorkflowCandidate, executeTrustedApply, findValidatorRun } from './lib/trusted-workflow-policy.mjs'

const VALIDATOR_WORKFLOW = basename(VALIDATOR_PATH)
const DEQUEUE_PULL_REQUEST_MUTATION = 'mutation($id:ID!){dequeuePullRequest(input:{id:$id}){clientMutationId}}'
function run(command, args, { cwd = process.cwd(), encoding = 'utf8' } = {}) {
  const invocation = resolveSpawnInvocation(command, args)
  const result = spawnSync(invocation.command, invocation.args, { cwd, encoding, windowsHide: true })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed: ${String(result.stderr || result.stdout || `exit ${result.status}`).trim()}`)
  return result.stdout
}
const output = (command, args, cwd) => String(run(command, args, { cwd }) || '').trim()
const argument = (name) => process.argv.slice(2).find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3)
export function workflowIntegrationLockPath(root, gitCommonDir) {
  if (/^[a-z]:[\\/]/i.test(root)) {
    const directory = win32.isAbsolute(gitCommonDir) ? gitCommonDir : win32.resolve(root, gitCommonDir)
    return win32.join(directory, 'happyhome-integrate-pr.lock')
  }
  const directory = isAbsolute(gitCommonDir) ? gitCommonDir : resolve(root, gitCommonDir)
  return join(directory, 'happyhome-integrate-pr.lock')
}
function inspectTrustedWorkspace(root, { fetch = false } = {}) {
  if (fetch) run('git', ['fetch', 'origin', 'main'], { cwd: root })
  const repository = JSON.parse(output('gh', ['repo', 'view', TRUSTED_REPOSITORY, '--json', 'nameWithOwner,isPrivate,url'], root))
  return assertTrustedWorkflowWorkspace({
    root,
    repository: repository.nameWithOwner,
    isPrivate: repository.isPrivate,
    repositoryUrl: repository.url,
    originUrl: output('git', ['remote', 'get-url', 'origin'], root),
    branch: output('git', ['branch', '--show-current'], root),
    status: output('git', ['status', '--porcelain=v1', '--untracked-files=all'], root),
    headSha: output('git', ['rev-parse', 'HEAD'], root),
    originMainSha: output('git', ['rev-parse', 'origin/main'], root),
  })
}
function inspectCandidate(root, prNumber) {
  run('git', ['fetch', 'origin', `pull/${prNumber}/head`], { cwd: root })
  const pr = JSON.parse(output('gh', ['pr', 'view', String(prNumber), '--repo', TRUSTED_REPOSITORY, '--json', 'id,number,state,isDraft,baseRefName,headRefOid,url'], root))
  if (!pr.id || pr.state !== 'OPEN' || pr.isDraft || pr.baseRefName !== 'main' || !pr.headRefOid) throw new Error('PR must be OPEN, non-draft, based on main, with an exact head commit')
  const baseSha = output('git', ['rev-parse', 'origin/main'], root)
  try { run('git', ['merge-base', '--is-ancestor', baseSha, pr.headRefOid], { cwd: root }) } catch { throw new Error(`PR head ${pr.headRefOid} does not include latest main`) }
  const discovered = discoverWorkflowCandidate({ root, baseSha, headSha: pr.headRefOid, runCommand: run })
  return { baseSha, headSha: pr.headRefOid, ...discovered, validatorWorkflowSha: baseSha, prNodeId: pr.id }
}
function downloadAttestation(root, runId, requestId) {
  const directory = join(tmpdir(), `happyhome-workflow-${runId}-${randomUUID()}`); mkdirSync(directory, { recursive: true })
  try {
    run('gh', ['run', 'download', String(runId), '--repo', TRUSTED_REPOSITORY, '--name', `trusted-workflow-attestation-${requestId}`, '--dir', directory], { cwd: root })
    const path = join(directory, 'trusted-workflow-attestation.json')
    if (!existsSync(path)) throw new Error('Validator attestation artifact is missing')
    return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''))
  } finally { rmSync(directory, { recursive: true, force: true }) }
}
async function main() {
  const args = process.argv.slice(2), prNumber = parsePrNumber(argument('pr')), prepare = args.includes('--prepare'), apply = args.includes('--apply')
  if (prepare === apply) throw new Error('Choose exactly one of --prepare or --apply')
  const root = output('git', ['rev-parse', '--show-toplevel'], process.cwd())
  inspectTrustedWorkspace(root)
  const manifestPath = argument('manifest')
  const release = acquireIntegrationLock(workflowIntegrationLockPath(root, output('git', ['rev-parse', '--git-common-dir'], root)), { prNumber })
  try {
    inspectTrustedWorkspace(root, { fetch: true })
    const candidate = inspectCandidate(root, prNumber)
    if (prepare) {
      const requestId = randomUUID()
      run('gh', ['workflow', 'run', VALIDATOR_WORKFLOW, '--repo', TRUSTED_REPOSITORY, '--ref', 'main', '-f', `prNumber=${prNumber}`, '-f', `baseSha=${candidate.baseSha}`, '-f', `headSha=${candidate.headSha}`, '-f', `diffSha256=${candidate.diffSha256}`, '-f', `requestId=${requestId}`], { cwd: root })
      let info
      for (let attempt = 0; attempt < 20 && !info; attempt += 1) {
        info = JSON.parse(output('gh', ['run', 'list', '--repo', TRUSTED_REPOSITORY, '--workflow', VALIDATOR_WORKFLOW, '--event', 'workflow_dispatch', '--limit', '20', '--json', 'databaseId,displayTitle,status,conclusion,headSha,createdAt'], root)).find((item) => item.displayTitle?.includes(requestId))
        if (!info) await new Promise((resolveDelay) => setTimeout(resolveDelay, 3000))
      }
      if (!info) throw new Error(`Unable to find validator run for request ${requestId}`)
      run('gh', ['run', 'watch', String(info.databaseId), '--repo', TRUSTED_REPOSITORY, '--exit-status'], { cwd: root })
      info = findValidatorRun([JSON.parse(output('gh', ['run', 'view', String(info.databaseId), '--repo', TRUSTED_REPOSITORY, '--json', 'databaseId,displayTitle,status,conclusion,headSha,createdAt'], root))], requestId, candidate.validatorWorkflowSha)
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
      const runInfo = findValidatorRun([JSON.parse(output('gh', ['run', 'view', String(manifest.runId), '--repo', TRUSTED_REPOSITORY, '--json', 'databaseId,displayTitle,status,conclusion,headSha,createdAt'], root))], manifest.requestId, manifest.validatorWorkflowSha)
      const terminal = await executeTrustedApply({
        manifest,
        current: { now: new Date().toISOString(), approval: argument('approve'), ...candidate, prNumber, requestId: manifest.requestId, runId: manifest.runId, runCreatedAt: new Date(runInfo.createdAt).toISOString(), attestation },
        refreshBase: async () => { run('git', ['fetch', 'origin', 'main'], { cwd: root }); return output('git', ['rev-parse', 'origin/main'], root) },
        readPullRequest: async () => JSON.parse(output('gh', ['pr', 'view', String(prNumber), '--repo', TRUSTED_REPOSITORY, '--json', 'id,state,isDraft,baseRefName,baseRefOid,headRefOid,mergeStateStatus,mergedAt,mergeCommit'], root)),
        enqueue: async (exactHead) => run('gh', ['pr', 'merge', String(prNumber), '--repo', TRUSTED_REPOSITORY, '--merge', '--match-head-commit', exactHead], { cwd: root }),
        dequeue: async (pullRequestId) => run('gh', ['api', 'graphql', '--hostname', 'github.com', '-f', `query=${DEQUEUE_PULL_REQUEST_MUTATION}`, '-f', `id=${pullRequestId}`], { cwd: root }),
        readMergeParents: async (mergeCommitOid) => {
          run('git', ['fetch', 'origin', 'main'], { cwd: root })
          run('git', ['merge-base', '--is-ancestor', mergeCommitOid, 'origin/main'], { cwd: root })
          return output('git', ['show', '-s', '--format=%P', mergeCommitOid], root).split(/\s+/).filter(Boolean)
        },
        pull: async () => run('git', ['pull', '--ff-only', 'origin', 'main'], { cwd: root }),
      })
      console.log(`[integrate-workflow-pr] merged PR #${prNumber} at ${terminal.mergeCommitOid} (${terminal.mergedAt})`)
    }
  } finally { release() }
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((error) => { console.error(`[integrate-workflow-pr] ${error.message}`); process.exitCode = 1 })
