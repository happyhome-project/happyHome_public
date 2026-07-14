#!/usr/bin/env node
import CloudBase from '@cloudbase/manager-node'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { runReleasePreflight } from './lib/release-preflight.mjs'
import { verifyPreflightCollections, verifyPreflightGitAndPlan, verifyPreflightIndex, verifyPreflightTimers, evaluatePreflightTimerEvidence, resolvePreflightIndexOptions } from './lib/release-preflight-checks.mjs'
import { buildRagWorkerFunctionConfigs, parseConfigureRagWorkersArgs } from './configure-rag-workers.mjs'
import { invokeAdmin, parseRebuildArgs } from './rebuild-post-search-index.mjs'
import { defaultRunner } from './cloud-release-smoke.mjs'
import { createTimerProbeDeadline } from './lib/post-rag-timer-probe-policy.mjs'
import { readTencentServerlessIndexMappings } from './lib/tencent-serverless-index-control.mjs'

function readEnv(file) {
  if (!fs.existsSync(file)) return {}
  return Object.fromEntries(fs.readFileSync(file, 'utf8').split(/\r?\n/).map(line => { const i = line.indexOf('='); return i > 0 ? [line.slice(0, i).trim(), line.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')] : [] }).filter(([key]) => key))
}
function git(args, cwd) { return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trim() }
function gitState(cwd) {
  git(['fetch', '--quiet', 'origin', 'main'], cwd)
  const changedPaths = [...new Set([['diff', '--name-only'], ['diff', '--cached', '--name-only'], ['ls-files', '--others', '--exclude-standard']].flatMap(args => git(args, cwd).split(/\r?\n/).filter(Boolean)))]
  return { cwd, originUrl: git(['remote', 'get-url', 'origin'], cwd), branch: git(['branch', '--show-current'], cwd), headSha: git(['rev-parse', 'HEAD'], cwd), originMainSha: git(['rev-parse', 'origin/main'], cwd), changedPaths }
}

export function createReleasePreflightChecks({ app, env, cwd, adminOptions, delegateRagVerification = false, resumeRequested = false, resumeRunState = null, releaseStrategy = 'full-current', fullCurrentExplicit = releaseStrategy === 'full-current', forceRedeployCurrent = false, publishOnly = false, generatedBuildInfoMatches = false, invoke = invokeAdmin, runner = defaultRunner, readGitState = gitState, readServerlessIndexMappings = readTencentServerlessIndexMappings, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  const configs = buildRagWorkerFunctionConfigs(parseConfigureRagWorkersArgs([], env))
  const runId = `pf_${crypto.randomUUID().replaceAll('-', '').slice(0, 32)}`
  const identity = { runId }
  const checks = [
    { name: 'rag-collections', run: async () => { if (!app) throw new Error('credentials unavailable'); return verifyPreflightCollections(app.database) } },
    { name: 'rag-index', run: async () => {
      if (!env.TENCENTCLOUD_SECRETID || !env.TENCENTCLOUD_SECRETKEY) throw new Error('index control credentials unavailable')
      const { indexName, region, dims } = resolvePreflightIndexOptions(env)
      return verifyPreflightIndex({ dims, readMappings: () => readServerlessIndexMappings({
        secretId: env.TENCENTCLOUD_SECRETID,
        secretKey: env.TENCENTCLOUD_SECRETKEY,
        indexName,
        region,
      }) })
    } },
    { name: 'worker-timers', run: async () => { if (!app) throw new Error('credentials unavailable'); return verifyPreflightTimers({ configs, listTriggers: async functionName => {
      const detail = await app.functions.getFunctionDetail(functionName)
      const response = await app.functions.scfService.request('ListTriggers', { FunctionName: functionName, Namespace: detail?.Namespace || app.functions.getFunctionConfig?.().namespace })
      return response?.Triggers || []
    } }) } },
    { name: 'full-current-plan-resume', gateForMutations: true, run: async () => verifyPreflightGitAndPlan({ gitState: readGitState(cwd), expectedHeadSha: env.HH_RELEASE_HEAD_SHA, resumeRequested, resumeRunState, releaseStrategy, fullCurrentExplicit, forceRedeployCurrent, publishOnly, generatedBuildInfoMatches }) },
    { name: 'timer-probe-document', mutation: true,
      fixture: identity,
      createFixture: async () => { if (!adminOptions.adminInternalToken) throw new Error('admin credential unavailable'); const created = (await invoke('post.ragTimerProbeCreateAdmin', identity, adminOptions, runner)).functionResult; Object.assign(identity, created); return identity },
      run: async probe => { const startedAt = probe.baseline; const deadline = createTimerProbeDeadline(Date.now(), env)
        while (Date.now() < deadline) {
          const evidence = (await invoke('post.ragTimerEvidenceAdmin', { runId }, adminOptions, runner)).functionResult?.evidence
          if (evaluatePreflightTimerEvidence({ evidence, startedAt, outboxId: probe.outboxId }).passed) return { status: 'passed' }
          await wait(Math.min(5000, Math.max(0, deadline - Date.now())))
        }
        return { status: 'failed', detail: 'authenticated timer did not consume the fixture outbox' }
      },
      cleanupFixture: async () => invoke('post.ragTimerProbeCleanupAdmin', identity, adminOptions, runner),
    },
  ]
  return delegateRagVerification ? checks.filter(check => check.name !== 'timer-probe-document') : checks
}

export async function main() {
  const home = os.homedir(); const env = { ...readEnv(path.join(home, '.happyhome', 'cam.env')), ...readEnv(path.join(home, '.happyhome', 'tencent-rag.env')), ...process.env }
  const envId = env.TCB_ENV || 'cloudbase-3gh862acb1505ff3'; const app = env.TENCENTCLOUD_SECRETID && env.TENCENTCLOUD_SECRETKEY ? CloudBase.init({ secretId: env.TENCENTCLOUD_SECRETID, secretKey: env.TENCENTCLOUD_SECRETKEY, envId }) : null
  const adminOptions = { ...parseRebuildArgs([], env), envId, commandTimeoutMs: 180000, adminInvokeRetries: 3 }
  const resumeRequested = process.argv.includes('--resume')
  const resumeRunState = env.HH_RELEASE_RESUME_CONTEXT_JSON ? JSON.parse(env.HH_RELEASE_RESUME_CONTEXT_JSON) : null
  const releaseStrategy = env.HH_RELEASE_STRATEGY || 'full-current'
  const fullCurrentExplicit = releaseStrategy === 'full-current' && env.HH_RELEASE_FULL_CURRENT_EXPLICIT !== '0'
  const forceRedeployCurrent = env.HH_RELEASE_FORCE_REDEPLOY_CURRENT === '1'
  const publishOnly = env.HH_RELEASE_PUBLISH_ONLY === '1'
  const buildInfoPath = path.resolve('miniprogram', 'src', 'generated', 'build-info.ts')
  const buildInfo = fs.existsSync(buildInfoPath) ? fs.readFileSync(buildInfoPath, 'utf8') : ''
  const generatedBuildInfoMatches = Boolean(env.HH_RELEASE_VERSION && env.HH_RELEASE_DESC && buildInfo.includes(env.HH_RELEASE_VERSION) && buildInfo.includes(env.HH_RELEASE_DESC))
  const result = await runReleasePreflight({ checks: createReleasePreflightChecks({ app, env, cwd: process.cwd(), adminOptions, delegateRagVerification: env.HH_RELEASE_DELEGATE_RAG_VERIFICATION === '1', resumeRequested, resumeRunState, releaseStrategy, fullCurrentExplicit, forceRedeployCurrent, publishOnly, generatedBuildInfoMatches }) })
  if (env.HH_RELEASE_PREFLIGHT_EVIDENCE_PATH) {
    fs.mkdirSync(path.dirname(env.HH_RELEASE_PREFLIGHT_EVIDENCE_PATH), { recursive: true })
    fs.writeFileSync(env.HH_RELEASE_PREFLIGHT_EVIDENCE_PATH, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
  }
  console.log(JSON.stringify(result, null, 2)); if (!result.ok) process.exitCode = 1
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => { console.error('[release-preflight] indeterminate'); process.exitCode = 1 })
