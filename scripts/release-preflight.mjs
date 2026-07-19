#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { runReleasePreflight } from './lib/release-preflight.mjs'
import { verifyPreflightGitAndPlan } from './lib/release-preflight-checks.mjs'

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

export function createReleasePreflightChecks({ env, cwd, resumeRequested = false, resumeRunState = null, releaseStrategy = 'full-current', fullCurrentExplicit = releaseStrategy === 'full-current', forceRedeployCurrent = false, publishOnly = false, generatedBuildInfoMatches = false, readGitState = gitState }) {
  return [{
    name: 'full-current-plan-resume',
    gateForMutations: true,
    run: async () => verifyPreflightGitAndPlan({ gitState: readGitState(cwd), expectedHeadSha: env.HH_RELEASE_HEAD_SHA, resumeRequested, resumeRunState, releaseStrategy, fullCurrentExplicit, forceRedeployCurrent, publishOnly, generatedBuildInfoMatches }),
  }]
}

export async function main() {
  const home = os.homedir(); const env = { ...readEnv(path.join(home, '.happyhome', 'cam.env')), ...readEnv(path.join(home, '.happyhome', 'tencent-rag.env')), ...process.env }
  const resumeRequested = process.argv.includes('--resume')
  const resumeRunState = env.HH_RELEASE_RESUME_CONTEXT_JSON ? JSON.parse(env.HH_RELEASE_RESUME_CONTEXT_JSON) : null
  const releaseStrategy = env.HH_RELEASE_STRATEGY || 'full-current'
  const fullCurrentExplicit = releaseStrategy === 'full-current' && env.HH_RELEASE_FULL_CURRENT_EXPLICIT !== '0'
  const forceRedeployCurrent = env.HH_RELEASE_FORCE_REDEPLOY_CURRENT === '1'
  const publishOnly = env.HH_RELEASE_PUBLISH_ONLY === '1'
  const buildInfoPath = path.resolve('miniprogram', 'src', 'generated', 'build-info.ts')
  const buildInfo = fs.existsSync(buildInfoPath) ? fs.readFileSync(buildInfoPath, 'utf8') : ''
  const generatedBuildInfoMatches = Boolean(env.HH_RELEASE_VERSION && env.HH_RELEASE_DESC && buildInfo.includes(env.HH_RELEASE_VERSION) && buildInfo.includes(env.HH_RELEASE_DESC))
  const result = await runReleasePreflight({ checks: createReleasePreflightChecks({ env, cwd: process.cwd(), resumeRequested, resumeRunState, releaseStrategy, fullCurrentExplicit, forceRedeployCurrent, publishOnly, generatedBuildInfoMatches }) })
  if (env.HH_RELEASE_PREFLIGHT_EVIDENCE_PATH) {
    fs.mkdirSync(path.dirname(env.HH_RELEASE_PREFLIGHT_EVIDENCE_PATH), { recursive: true })
    fs.writeFileSync(env.HH_RELEASE_PREFLIGHT_EVIDENCE_PATH, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
  }
  console.log(JSON.stringify(result, null, 2)); if (!result.ok) process.exitCode = 1
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => { console.error('[release-preflight] indeterminate'); process.exitCode = 1 })
