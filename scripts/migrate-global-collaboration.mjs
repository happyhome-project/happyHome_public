#!/usr/bin/env node
import CloudBase from '@cloudbase/node-sdk'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import {
  applyGlobalCollaborationMigration,
  prepareGlobalCollaborationMigration,
} from './lib/global-collaboration-migration-node-sdk.mjs'
import { assertFormalReleaseGitState } from './lib/release-policy.mjs'

function flag(name) {
  const prefix = `--${name}=`
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || ''
}

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trim()
}

function readGitState(cwd) {
  git(['fetch', '--quiet', 'origin', 'main'], cwd)
  const changedPaths = [...new Set([
    ['diff', '--name-only'],
    ['diff', '--cached', '--name-only'],
    ['ls-files', '--others', '--exclude-standard'],
  ].flatMap((args) => git(args, cwd).split(/\r?\n/).filter(Boolean)))]
  return {
    cwd,
    originUrl: git(['remote', 'get-url', 'origin'], cwd),
    branch: git(['branch', '--show-current'], cwd),
    headSha: git(['rev-parse', 'HEAD'], cwd),
    originMainSha: git(['rev-parse', 'origin/main'], cwd),
    changedPaths,
  }
}

const prepare = process.argv.includes('--prepare')
const apply = process.argv.includes('--apply')
if (prepare === apply) throw new Error('Use exactly one of --prepare or --apply')

const manifestFlag = flag('manifest')
if (!manifestFlag) throw new Error('--manifest=<path> is required')
const manifestPath = resolve(manifestFlag)
const envId = String(process.env.TCB_ENV || '').trim()
const secretId = String(process.env.TENCENTCLOUD_SECRETID || '').trim()
const secretKey = String(process.env.TENCENTCLOUD_SECRETKEY || '').trim()
if (!envId || !secretId || !secretKey) throw new Error('TCB_ENV and Tencent Cloud credentials are required')

const cwd = process.cwd()
const gitState = readGitState(cwd)
assertFormalReleaseGitState({ ...gitState, releaseStrategy: 'main' })
const app = CloudBase.init({ env: envId, secretId, secretKey })
const database = app.database()

if (prepare) {
  const manifest = await prepareGlobalCollaborationMigration(database, {
    envId,
    headSha: gitState.headSha,
  })
  await mkdir(dirname(manifestPath), { recursive: true })
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  console.log(JSON.stringify({
    prepared: true,
    manifestPath,
    manifestSha256: manifest.manifestSha256,
    planDigest: manifest.planDigest,
    archiveDigest: manifest.archiveDigest,
    summary: manifest.summary,
  }, null, 2))
} else {
  if (flag('confirm-apply') !== 'global-collaboration-v1') {
    throw new Error('--confirm-apply=global-collaboration-v1 is required')
  }
  const expectedManifestSha256 = flag('manifest-sha256') || String(process.env.HH_GLOBAL_COLLABORATION_MANIFEST_SHA256 || '').trim()
  if (!/^[0-9a-f]{64}$/i.test(expectedManifestSha256)) throw new Error('--manifest-sha256=<reviewed sha256> is required')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const result = await applyGlobalCollaborationMigration({
    database,
    storage: app,
    manifest,
    envId,
    headSha: gitState.headSha,
    expectedManifestSha256,
  })
  console.log(JSON.stringify(result, null, 2))
}
