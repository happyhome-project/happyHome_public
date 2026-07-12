#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, relative, resolve } from 'node:path'
import process from 'node:process'

import { createProductionReleaseStore } from './lib/cloudbase-release-store.mjs'
import { ALL_CLOUD_FUNCTIONS, createReleasePlan, selectChangeManifests } from './lib/release-plan.mjs'
import { resolveMainReleasePlanBase } from './lib/release-plan-base.mjs'

const workspaceRequire = createRequire(new URL('../cloud/package.json', import.meta.url))
const { build } = workspaceRequire('esbuild')

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trim()
}

function option(name) {
  const equals = process.argv.find((arg) => arg.startsWith(`--${name}=`))
  if (equals) return equals.slice(name.length + 3)
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] || '' : ''
}

function hasOption(name) {
  return process.argv.some((arg) => arg === `--${name}` || arg.startsWith(`--${name}=`))
}

function changedPaths(root, baseSha, headSha) {
  if (!baseSha) return []
  return git(['diff', '--name-status', '--find-renames', baseSha, headSha], root)
    .split(/\r?\n/)
    .filter(Boolean)
}

function readManifests(root) {
  const directory = join(root, 'release', 'changes')
  if (!existsSync(directory)) return []
  return readdirSync(directory).filter((name) => name.endsWith('.json')).sort().map((name) => ({
    ...JSON.parse(readFileSync(join(directory, name), 'utf8')),
    source: `release/changes/${name}`,
  }))
}

async function collectFunctionInputs(root) {
  const cloudRoot = join(root, 'cloud')
  const result = {}
  for (const name of ALL_CLOUD_FUNCTIONS) {
    const entry = join(cloudRoot, 'functions', name, 'index.ts')
    if (!existsSync(entry)) continue
    const output = await build({
      bundle: true, entryPoints: [entry], external: ['wx-server-sdk'], metafile: true,
      platform: 'node', target: 'node16', write: false,
    })
    result[name] = Object.keys(output.metafile.inputs).map((input) => relative(root, resolve(root, input)).replace(/\\/g, '/'))
  }
  return result
}

function printSummary(plan, baseSource) {
  const cloud = plan.targets.cloud
  const baseLabel = plan.mode === 'full-current' ? '(none)' : plan.baseSha || '(bootstrap)'
  console.log(`[release-plan] mode=${plan.mode} head=${plan.headSha} base=${baseLabel} source=${baseSource}`)
  console.log(`[release-plan] required=${plan.releaseRequired} cloud=${cloud.mode}:${cloud.functions.join(',') || '-'}`)
  console.log(`[release-plan] miniprogram=${plan.targets.miniprogram} admin-web=${plan.targets.adminWeb} actions=${plan.changeIds.join(',') || '-'}`)
}

try {
  const root = git(['rev-parse', '--show-toplevel'], process.cwd())
  const mode = option('mode') || (process.argv[2] === 'pending' ? 'main' : '')
  if (!['main', 'pr', 'full-current'].includes(mode)) throw new Error('use --mode=pr, --mode=main, or --mode=full-current')
  if (mode === 'full-current' && hasOption('base')) throw new Error('--base is not supported with --mode=full-current')
  const headSha = option('head') || git(['rev-parse', 'HEAD'], root)
  let baseSha = option('base') || ''
  let baseSource = baseSha ? 'explicit' : ''
  if (mode === 'pr') {
    baseSha = baseSha || git(['merge-base', headSha, 'origin/main'], root)
    baseSource = baseSource || 'origin-main-merge-base'
  } else if (mode === 'main') {
    const resolved = await resolveMainReleasePlanBase({
      explicitBase: baseSha,
      readProductionState: async () => await createProductionReleaseStore({ root }).readProductionState(),
    })
    baseSha = resolved.baseSha
    baseSource = resolved.source
  } else {
    baseSha = ''
    baseSource = 'full-current'
  }
  if (baseSha) {
    git(['cat-file', '-e', `${baseSha}^{commit}`], root)
    if (mode === 'main') git(['merge-base', '--is-ancestor', baseSha, headSha], root)
  }
  const changes = changedPaths(root, baseSha, headSha)
  const plan = createReleasePlan({
    baseSha,
    changedPaths: changes,
    functionInputs: await collectFunctionInputs(root),
    headSha,
    manifests: selectChangeManifests(mode, readManifests(root), changes),
    mode,
  })
  const destination = join(root, '.codex-local', 'release-plans')
  mkdirSync(destination, { recursive: true })
  const outputPath = join(destination, `${mode === 'pr' ? 'pr-' : ''}${headSha}.json`)
  writeFileSync(outputPath, `${JSON.stringify(plan, null, 2)}\n`, 'utf8')
  printSummary(plan, baseSource)
  console.log(`[release-plan] wrote=${outputPath}`)
  if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, `\nRelease plan: \`${plan.targets.cloud.mode}\` cloud deployment.\n`, { flag: 'a' })
} catch (error) {
  console.error(`[release-plan] ${error?.message || error}`)
  process.exitCode = 1
}
