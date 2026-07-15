import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

const SCHEMA_VERSION = 1
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA_RE = /^[0-9a-f]{40}$/i
const RUN_ID_RE = /^[A-Za-z0-9._-]{1,120}$/

function pad(value) {
  return String(value).padStart(2, '0')
}

function timestamp(now) {
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}T${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

function version(now) {
  return `1.0.${String(now.getFullYear()).slice(-2)}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

function numericUuidSuffix(uuid) {
  return String(Number.parseInt(uuid.slice(0, 8), 16) % 100_000_000).padStart(8, '0')
}

function requireText(value, field, max = 160) {
  const text = String(value || '').trim()
  if (!text || text.length > max || /[\r\n\0]/.test(text)) throw new Error(`release session ${field} is invalid`)
  return text
}

function assertRunId(value) {
  const runId = requireText(value, 'releaseRunId', 120)
  if (!RUN_ID_RE.test(runId)) throw new Error('release session releaseRunId is invalid')
  return runId
}

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(temporary, path)
      return
    } catch (error) {
      if (error?.code !== 'EPERM' || attempt >= 3) throw error
      await new Promise(resolveWait => setTimeout(resolveWait, 20 * (attempt + 1)))
    }
  }
}

export function validateReleaseSession(value) {
  if (!value || value.schemaVersion !== SCHEMA_VERSION) throw new Error('release session schemaVersion is invalid')
  if (!UUID_RE.test(String(value.sessionId || ''))) throw new Error('release session sessionId is invalid')
  if (!SHA_RE.test(String(value.identity?.gitSha || ''))) throw new Error('release session gitSha is invalid')
  requireText(value.identity?.envId, 'envId')
  if (!['main', 'full-current'].includes(value.identity?.strategy)) throw new Error('release session strategy is invalid')
  assertRunId(value.identity?.releaseRunId)
  requireText(value.release?.version, 'version', 64)
  requireText(value.release?.desc, 'desc')
  if (!value.aliases || typeof value.aliases !== 'object' || Array.isArray(value.aliases)) throw new Error('release session aliases are invalid')
  if (!Array.isArray(value.repairs)) throw new Error('release session repairs are invalid')
  return value
}

export async function readReleaseSession(path) {
  return validateReleaseSession(JSON.parse(await readFile(resolve(path), 'utf8')))
}

export async function readLatestReleaseSessionPath(root = process.cwd()) {
  const absoluteRoot = resolve(root)
  const latest = JSON.parse(await readFile(join(absoluteRoot, '.codex-local', 'release-sessions', 'latest.json'), 'utf8'))
  if (!UUID_RE.test(String(latest.sessionId || ''))) throw new Error('latest release session pointer is invalid')
  const path = join(absoluteRoot, '.codex-local', 'release-sessions', `${latest.sessionId}.json`)
  await readReleaseSession(path)
  return path
}

export async function createReleaseSession({
  root = process.cwd(),
  gitSha,
  envId = 'cloudbase-3gh862acb1505ff3',
  strategy = 'full-current',
  now = new Date(),
  uuid = randomUUID(),
} = {}) {
  const absoluteRoot = resolve(root)
  if (!SHA_RE.test(String(gitSha || ''))) throw new Error('release session gitSha is invalid')
  if (!UUID_RE.test(String(uuid || ''))) throw new Error('release session sessionId is invalid')
  const shortSha = gitSha.slice(0, 12)
  const releaseRunId = `${timestamp(now)}-public-main-${shortSha}-${uuid.slice(0, 8)}`
  if (await exists(join(absoluteRoot, '.codex-local', 'release-runs', releaseRunId))) throw new Error(`generated releaseRunId already exists: ${releaseRunId}`)
  const session = validateReleaseSession({
    schemaVersion: SCHEMA_VERSION,
    sessionId: uuid,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    identity: { gitSha, envId: requireText(envId, 'envId'), strategy, releaseRunId },
    release: { version: `${version(now)}.${numericUuidSuffix(uuid)}`, desc: `current-main-${shortSha}` },
    aliases: {},
    repairs: [],
  })
  const path = join(absoluteRoot, '.codex-local', 'release-sessions', `${uuid}.json`)
  if (await exists(path)) throw new Error(`release session already exists: ${uuid}`)
  await writeJsonAtomic(path, session)
  await writeJsonAtomic(join(absoluteRoot, '.codex-local', 'release-sessions', 'latest.json'), { sessionId: uuid })
  return { path, session }
}

async function readMatchingLedger(root, session) {
  const path = join(root, '.codex-local', 'release-runs', session.identity.releaseRunId, 'run.json')
  if (!(await exists(path))) return null
  const ledger = JSON.parse(await readFile(path, 'utf8'))
  const expected = {
    runId: session.identity.releaseRunId,
    gitSha: session.identity.gitSha,
    version: session.release.version,
    desc: session.release.desc,
    envId: session.identity.envId,
    strategy: session.identity.strategy,
  }
  const actual = {
    runId: ledger.runId,
    gitSha: ledger.context?.gitSha,
    version: ledger.context?.version,
    desc: ledger.context?.desc,
    envId: ledger.context?.envId,
    strategy: ledger.context?.releaseStrategy,
  }
  for (const field of Object.keys(expected)) {
    if (actual[field] !== expected[field]) throw new Error(`release ledger ${field} does not match session`)
  }
  return ledger
}

export async function repairReleaseSession({
  root = process.cwd(),
  sessionPath,
  changes = {},
  repairLatest = false,
  reason,
  now = new Date(),
} = {}) {
  const absoluteRoot = resolve(root)
  const absoluteSessionPath = resolve(sessionPath)
  const explanation = requireText(reason, 'repair reason', 500)
  const session = await readReleaseSession(absoluteSessionPath)
  const ledger = await readMatchingLedger(absoluteRoot, session)
  const requested = {}
  if (changes.releaseRunId !== undefined) requested.releaseRunId = assertRunId(changes.releaseRunId)
  if (changes.version !== undefined) requested.version = requireText(changes.version, 'version', 64)
  if (changes.desc !== undefined) requested.desc = requireText(changes.desc, 'desc')
  if (changes.displayName !== undefined) requested.displayName = requireText(changes.displayName, 'displayName')
  const before = {
    releaseRunId: session.identity.releaseRunId,
    version: session.release.version,
    desc: session.release.desc,
    aliases: structuredClone(session.aliases),
  }
  if (ledger) {
    session.aliases = { ...session.aliases, ...requested }
  } else {
    if (requested.releaseRunId && requested.releaseRunId !== session.identity.releaseRunId) {
      if (await exists(join(absoluteRoot, '.codex-local', 'release-runs', requested.releaseRunId))) throw new Error('requested releaseRunId already exists')
      session.identity.releaseRunId = requested.releaseRunId
    }
    if (requested.version) session.release.version = requested.version
    if (requested.desc) session.release.desc = requested.desc
    if (requested.displayName) session.aliases.displayName = requested.displayName
  }
  if (repairLatest) {
    if (!ledger) throw new Error('release ledger is required to repair latest pointer')
    await writeJsonAtomic(join(absoluteRoot, '.codex-local', 'release-runs', 'latest.json'), { runId: session.identity.releaseRunId })
  }
  session.updatedAt = now.toISOString()
  session.repairs.push({ at: now.toISOString(), reason: explanation, mode: ledger ? 'alias' : 'pre-run', before, requested, repairedLatest: repairLatest })
  validateReleaseSession(session)
  await writeJsonAtomic(absoluteSessionPath, session)
  return session
}
