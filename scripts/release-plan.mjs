#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, relative, resolve } from 'node:path'
import process from 'node:process'

import { createProductionReleaseStore } from './lib/cloudbase-release-store.mjs'
import { ALL_CLOUD_FUNCTIONS, createReleasePlan, selectChangeManifests, filterRagReleaseManifest } from './lib/release-plan.mjs'
import { createMigrationInputDigest, readVerifiedMigrationInputFile } from './lib/release-component-registry.mjs'
import { resolveMainReleasePlanBase } from './lib/release-plan-base.mjs'
import { assertFormalReleaseGitState } from './lib/release-policy.mjs'

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

function includeRag() {
  return hasOption('include-rag') || process.env.HH_RELEASE_INCLUDE_RAG === '1'
}

function changedPaths(root, baseSha, headSha) {
  if (!baseSha) return []
  return git(['diff', '--name-status', '--find-renames', baseSha, headSha], root)
    .split(/\r?\n/)
    .filter(Boolean)
}

function worktreeChangedPaths(root) {
  const paths = new Set()
  for (const args of [
    ['diff', '--name-only', '--no-ext-diff'],
    ['diff', '--cached', '--name-only', '--no-ext-diff'],
    ['ls-files', '--others', '--exclude-standard'],
  ]) {
    for (const path of git(args, root).split(/\r?\n/).filter(Boolean)) paths.add(path)
  }
  return [...paths]
}

function readManifests(root) {
  const directory = join(root, 'release', 'changes')
  if (!existsSync(directory)) return []
  return readdirSync(directory).filter((name) => name.endsWith('.json')).sort().map((name) => {
    const manifest = JSON.parse(readFileSync(join(directory, name), 'utf8'))
    return {
      ...manifest,
      migrations: (manifest.migrations || []).map((migration) => {
        const { module, moduleBytes } = readVerifiedMigrationInputFile({ root, migration })
        return {
          ...migration,
          module,
          inputDigest: createMigrationInputDigest({
            id: migration.id,
            module,
            moduleBytes,
          }),
        }
      }),
      source: `release/changes/${name}`,
    }
  })
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
  const forceRedeployCurrent = hasOption('force-redeploy-current')
  if (!['main', 'pr', 'full-current'].includes(mode)) throw new Error('use --mode=pr, --mode=main, or --mode=full-current')
  if (forceRedeployCurrent && mode !== 'full-current') throw new Error('--force-redeploy-current requires --mode=full-current')
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
    git(['fetch', '--quiet', 'origin', 'main'], root)
    const workspaceHead = git(['rev-parse', 'HEAD'], root)
    const publishResume = hasOption('publish-resume')
    const version = option('version')
    const desc = option('desc')
    if (publishResume && (!version || !desc)) {
      throw new Error('Full-current publish resume requires --version and --desc')
    }
    const buildInfoPath = join(root, 'miniprogram', 'src', 'generated', 'build-info.ts')
    const buildInfo = existsSync(buildInfoPath) ? readFileSync(buildInfoPath, 'utf8') : ''
    if (!hasOption('head') || headSha !== workspaceHead) {
      throw new Error(`Full-current release requires explicit --head to equal workspace HEAD; got --head=${hasOption('head') ? headSha : '(missing)'} HEAD=${workspaceHead}`)
    }
    assertFormalReleaseGitState({
      cwd: root,
      originUrl: git(['remote', 'get-url', 'origin'], root),
      releaseStrategy: 'full-current',
      fullCurrentExplicit: true,
      branch: git(['branch', '--show-current'], root),
      headSha: workspaceHead,
      originMainSha: git(['rev-parse', 'origin/main'], root),
      changedPaths: worktreeChangedPaths(root),
      publishOnly: hasOption('publish-resume'),
      generatedBuildInfoMatches: buildInfo.includes(version) && buildInfo.includes(desc),
    })
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
    forceRedeployCurrent,
    headSha,
    manifests: selectChangeManifests(mode, readManifests(root), changes).map((manifest) => filterRagReleaseManifest(manifest, includeRag())),
    includeRag: includeRag(),
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
