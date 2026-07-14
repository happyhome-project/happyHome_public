import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'

import { pathsReferToSameEntry } from './filesystem-path-integrity.mjs'
import { parseMiniprogramPackageIdentity } from './miniprogram-package-identity.mjs'
import { assertReleaseUiEvidence, REQUIRED_RELEASE_UI_MARKERS } from './mp-release-ui-policy.mjs'
import { computeDirectoryDigest } from './release-run-ledger.mjs'

export const RELEASE_UI_QUALIFICATION_SCHEMA = 1

function requireText(value, field) {
  const text = String(value || '').trim()
  if (!text) throw new Error(`release UI qualification ${field} is required`)
  return text
}

function absoluteWithinRoot(root, value, field) {
  const absolute = resolve(requireText(value, field))
  const rel = relative(root, absolute)
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`release UI qualification ${field} must stay within root`)
  }
  return absolute
}

async function sha256File(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

function hasBuildIdentity(text, version, desc) {
  return text.includes(version) && text.includes(desc) && text.includes(`mp-${version}`)
}

async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true })
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  try {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await rename(temporaryPath, path)
        return
      } catch (error) {
        if (error?.code !== 'EPERM' || attempt === 3) throw error
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 25 * attempt))
      }
    }
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => {})
  }
}

export async function writeReleaseUiQualification(input = {}) {
  const root = resolve(input.root || process.cwd())
  const outputPath = absoluteWithinRoot(root, input.outputPath, 'outputPath')
  const packageRoot = absoluteWithinRoot(root, input.packageRoot, 'packageRoot')
  const sourceBuildInfoPath = absoluteWithinRoot(root, input.sourceBuildInfoPath, 'sourceBuildInfoPath')
  const distBuildInfoPath = absoluteWithinRoot(root, input.distBuildInfoPath, 'distBuildInfoPath')
  const uiEvidencePath = absoluteWithinRoot(root, input.uiEvidencePath, 'uiEvidencePath')
  const qualification = {
    schema: RELEASE_UI_QUALIFICATION_SCHEMA,
    createdAt: new Date().toISOString(),
    gitSha: requireText(input.gitSha, 'gitSha'),
    version: requireText(input.version, 'version'),
    desc: requireText(input.desc, 'desc'),
    devToolsVersion: requireText(input.devToolsVersion, 'devToolsVersion'),
    packageRoot,
    packageDigest: await computeDirectoryDigest(packageRoot),
    sourceBuildInfo: {
      path: sourceBuildInfoPath,
      sha256: await sha256File(sourceBuildInfoPath),
    },
    distBuildInfo: {
      path: distBuildInfoPath,
      sha256: await sha256File(distBuildInfoPath),
    },
    uiEvidence: {
      path: uiEvidencePath,
      sha256: await sha256File(uiEvidencePath),
    },
  }
  await writeJsonAtomic(outputPath, qualification)
  return qualification
}

export async function inspectReleaseUiQualification({
  qualificationPath,
  root: inputRoot,
  expected = {},
  currentDevToolsVersion,
} = {}) {
  const root = resolve(inputRoot || process.cwd())
  const absoluteQualificationPath = absoluteWithinRoot(root, qualificationPath, 'qualificationPath')
  const qualification = JSON.parse(await readFile(absoluteQualificationPath, 'utf8'))
  if (qualification.schema !== RELEASE_UI_QUALIFICATION_SCHEMA) {
    throw new Error(`release UI qualification schema mismatch: expected ${RELEASE_UI_QUALIFICATION_SCHEMA}, got ${qualification.schema ?? 'missing'}`)
  }

  for (const field of ['gitSha', 'version', 'desc']) {
    const wanted = requireText(expected[field], `expected.${field}`)
    if (qualification[field] !== wanted) {
      throw new Error(`release UI qualification ${field} mismatch: expected ${wanted}, got ${qualification[field] || 'missing'}`)
    }
  }
  const actualDevToolsVersion = requireText(currentDevToolsVersion, 'currentDevToolsVersion')
  if (qualification.devToolsVersion !== actualDevToolsVersion) {
    throw new Error(`release UI qualification DevTools version mismatch: expected ${qualification.devToolsVersion || 'missing'}, got ${actualDevToolsVersion}`)
  }

  const packageRoot = absoluteWithinRoot(root, qualification.packageRoot, 'packageRoot')
  const sourceBuildInfoPath = absoluteWithinRoot(root, qualification.sourceBuildInfo?.path, 'sourceBuildInfo.path')
  const distBuildInfoPath = absoluteWithinRoot(root, qualification.distBuildInfo?.path, 'distBuildInfo.path')
  const uiEvidencePath = absoluteWithinRoot(root, qualification.uiEvidence?.path, 'uiEvidence.path')

  const sourceBuildInfo = await readFile(sourceBuildInfoPath, 'utf8')
  const currentSourceBuildInfoSha256 = await sha256File(sourceBuildInfoPath)
  const sourceBuildInfoStatus = {
    ...qualification.sourceBuildInfo,
    currentSha256: currentSourceBuildInfoSha256,
    identityMatchesQualification: hasBuildIdentity(sourceBuildInfo, qualification.version, qualification.desc),
    sha256MatchesQualification: currentSourceBuildInfoSha256 === qualification.sourceBuildInfo?.sha256,
  }
  sourceBuildInfoStatus.matchesQualification = sourceBuildInfoStatus.identityMatchesQualification &&
    sourceBuildInfoStatus.sha256MatchesQualification

  const distBuildInfo = await readFile(distBuildInfoPath, 'utf8')
  let distIdentity
  try {
    distIdentity = parseMiniprogramPackageIdentity(distBuildInfo)
  } catch (error) {
    throw new Error(`release UI qualification dist build info identity mismatch: ${error?.message || error}`)
  }
  if (distIdentity.version !== qualification.version ||
      distIdentity.desc !== qualification.desc ||
      distIdentity.buildId !== `mp-${qualification.version}`) {
    throw new Error('release UI qualification dist build info identity mismatch')
  }
  if (await sha256File(distBuildInfoPath) !== qualification.distBuildInfo?.sha256) {
    throw new Error('release UI qualification dist build info SHA-256 mismatch')
  }

  const packageDigest = await computeDirectoryDigest(packageRoot)
  if (packageDigest !== qualification.packageDigest) {
    throw new Error(`release UI qualification package digest mismatch: expected ${qualification.packageDigest || 'missing'}, got ${packageDigest}`)
  }
  const evidenceSha256 = await sha256File(uiEvidencePath)
  if (evidenceSha256 !== qualification.uiEvidence?.sha256) {
    throw new Error(`release UI qualification UI evidence SHA-256 mismatch: expected ${qualification.uiEvidence?.sha256 || 'missing'}, got ${evidenceSha256}`)
  }

  const evidence = JSON.parse(await readFile(uiEvidencePath, 'utf8'))
  const evidenceProjectPath = absoluteWithinRoot(root, evidence.projectPath, 'UI evidence projectPath')
  if (!(await pathsReferToSameEntry(evidenceProjectPath, packageRoot))) {
    throw new Error('release UI qualification project path does not match package root')
  }
  if (evidence.gitSha !== qualification.gitSha) throw new Error('release UI qualification UI evidence gitSha mismatch')
  if (evidence.devToolsVersion !== qualification.devToolsVersion) throw new Error('release UI qualification UI evidence DevTools version mismatch')
  if (evidence.packageDigest !== qualification.packageDigest) throw new Error('release UI qualification UI evidence package digest mismatch')
  const markers = new Set(Array.isArray(evidence.markers) ? evidence.markers : [])
  const missingMarker = REQUIRED_RELEASE_UI_MARKERS.find(({ marker }) => !markers.has(marker))
  if (missingMarker) throw new Error(`release UI qualification missing marker ${missingMarker.marker}`)
  assertReleaseUiEvidence({
    homeColdStartNonEmpty: evidence.homeColdStart?.passed,
    homeImagesRendered: evidence.homeDetail?.homeImagesRendered,
    homeArchiveTabsSticky: evidence.homeArchiveTabs?.passed,
    homeDetailNonEmpty: evidence.homeDetail?.passed,
    loginBuildIdentityVerified: evidence.profileLoginClean?.buildIdentityPassed,
    profileLoginClean: evidence.profileLoginClean?.cleanPassed,
  })
  if (evidence.profileLoginClean?.expectedVersion !== qualification.version) {
    throw new Error(`release UI qualification UI evidence version mismatch: expected ${qualification.version}, got ${evidence.profileLoginClean?.expectedVersion || 'missing'}`)
  }

  return {
    ...qualification,
    sourceBuildInfo: sourceBuildInfoStatus,
    qualificationPath: absoluteQualificationPath,
    packageRoot,
    sourceBuildInfoPath,
    distBuildInfoPath,
    uiEvidencePath,
  }
}
