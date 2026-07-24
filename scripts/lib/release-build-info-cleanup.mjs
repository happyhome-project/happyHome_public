import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

export const GENERATED_BUILD_INFO_PATH = 'miniprogram/src/generated/build-info.ts'

export function renderReleaseBuildInfo({ version, desc }) {
  return [
    'export const BUILD_INFO = {',
    `  version: ${JSON.stringify(version)},`,
    `  desc: ${JSON.stringify(desc)},`,
    `  buildId: ${JSON.stringify(`mp-${version}`)},`,
    '}',
    '',
  ].join('\n')
}

function readHeadBuildInfo(root) {
  return execFileSync('git', ['show', `HEAD:${GENERATED_BUILD_INFO_PATH}`], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  })
}

export function restoreReleaseOwnedBuildInfo({
  root,
  version,
  desc,
  readTrackedFile = () => readHeadBuildInfo(root),
}) {
  const path = resolve(root, GENERATED_BUILD_INFO_PATH)
  const current = readFileSync(path, 'utf8')
  const tracked = readTrackedFile()
  if (current === tracked) return { path, status: 'unchanged' }

  const expectedReleaseMarker = renderReleaseBuildInfo({ version, desc })
  if (current !== expectedReleaseMarker) {
    throw new Error(`${GENERATED_BUILD_INFO_PATH} does not exactly match the current release identity; refusing cleanup`)
  }

  writeFileSync(path, tracked, 'utf8')
  if (readFileSync(path, 'utf8') !== tracked) {
    throw new Error(`${GENERATED_BUILD_INFO_PATH} cleanup verification failed`)
  }
  return { path, status: 'restored' }
}
