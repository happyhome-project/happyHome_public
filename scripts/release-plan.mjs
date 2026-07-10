#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import process from 'node:process'

import { build } from '../node_modules/esbuild/lib/main.js'
import { ALL_CLOUD_FUNCTIONS, createReleasePlan } from './lib/release-plan.mjs'

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trim()
}

function option(name) {
  const equals = process.argv.find((arg) => arg.startsWith(`--${name}=`))
  if (equals) return equals.slice(name.length + 3)
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] || '' : ''
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

function printSummary(plan) {
  const cloud = plan.targets.cloud
  console.log(`[release-plan] mode=${plan.mode} head=${plan.headSha} base=${plan.baseSha || '(bootstrap)'}`)
  console.log(`[release-plan] required=${plan.releaseRequired} cloud=${cloud.mode}:${cloud.functions.join(',') || '-'}`)
  console.log(`[release-plan] miniprogram=${plan.targets.miniprogram} admin-web=${plan.targets.adminWeb} actions=${plan.changeIds.join(',') || '-'}`)
}

try {
  const root = git(['rev-parse', '--show-toplevel'], process.cwd())
  const mode = option('mode') || (process.argv[2] === 'pending' ? 'main' : '')
  if (!['main', 'pr'].includes(mode)) throw new Error('use --mode=pr or --mode=main')
  const headSha = option('head') || git(['rev-parse', 'HEAD'], root)
  const baseSha = option('base') || (mode === 'pr' ? git(['merge-base', headSha, 'origin/main'], root) : process.env.HH_RELEASE_BASE_SHA || '')
  const plan = createReleasePlan({
    baseSha,
    changedPaths: changedPaths(root, baseSha, headSha),
    functionInputs: await collectFunctionInputs(root),
    headSha,
    manifests: readManifests(root),
    mode,
  })
  const destination = join(root, '.codex-local', 'release-plans')
  mkdirSync(destination, { recursive: true })
  const outputPath = join(destination, `${mode === 'main' ? '' : 'pr-'}${headSha}.json`)
  writeFileSync(outputPath, `${JSON.stringify(plan, null, 2)}\n`, 'utf8')
  printSummary(plan)
  console.log(`[release-plan] wrote=${outputPath}`)
  if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, `\nRelease plan: \`${plan.targets.cloud.mode}\` cloud deployment.\n`, { flag: 'a' })
} catch (error) {
  console.error(`[release-plan] ${error?.message || error}`)
  process.exitCode = 1
}
