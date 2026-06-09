import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

export const REQUIRED_RELEASE_REPLAY_MARKERS = [
  {
    id: 'home-detail-nonempty',
    marker: 'HH_RELEASE_HOME_DETAIL_NONEMPTY',
    description: 'home feed tap opens a non-empty detail page',
  },
  {
    id: 'login-page-version',
    marker: 'HH_RELEASE_LOGIN_VERSION',
    description: 'login page renders and shows the build version',
  },
]

export function getArgValue(args, name) {
  const equalsArg = args.find((arg) => arg.startsWith(`--${name}=`))
  if (equalsArg) return equalsArg.slice(name.length + 3)
  const index = args.indexOf(`--${name}`)
  if (index >= 0 && args[index + 1] && !args[index + 1].startsWith('--')) return args[index + 1]
  return ''
}

export function resolveReplayConfigPath({ args = process.argv.slice(2), env = process.env, cwd = process.cwd() } = {}) {
  const rawPath = getArgValue(args, 'replay-config-path') ||
    env.HH_MP_REPLAY_CONFIG_PATH ||
    env.WECHAT_DEVTOOLS_REPLAY_CONFIG_PATH ||
    ''
  if (!rawPath) return ''
  return resolve(cwd, rawPath)
}

export function shouldRequireReleaseReplay(args = process.argv.slice(2), env = process.env) {
  return args.includes('--require-release-replay') || env.HH_REQUIRE_RELEASE_REPLAY === '1'
}

export function collectReplayText(targetPath) {
  if (!targetPath || !existsSync(targetPath)) return ''
  const stat = statSync(targetPath)
  if (stat.isFile()) return readTextFile(targetPath)
  if (!stat.isDirectory()) return ''

  const chunks = []
  const stack = [targetPath]
  while (stack.length) {
    const current = stack.pop()
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const fullPath = resolve(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(fullPath)
        continue
      }
      if (entry.isFile() && /\.(json|json5|js|ts|wxml|txt|yaml|yml)$/i.test(entry.name)) {
        chunks.push(readTextFile(fullPath))
      }
    }
  }
  return chunks.join('\n')
}

function readTextFile(filePath) {
  try {
    return readFileSync(filePath, 'utf8')
  } catch {
    return ''
  }
}

export function assertReleaseReplayCoverage(configPath, markers = REQUIRED_RELEASE_REPLAY_MARKERS) {
  if (!configPath) {
    throw new Error('Release replay is required. Set HH_MP_REPLAY_CONFIG_PATH or pass --replay-config-path <file-or-dir>.')
  }
  if (!existsSync(configPath)) {
    throw new Error(`Release replay config path does not exist: ${configPath}`)
  }

  const replayText = collectReplayText(configPath)
  const missing = markers.filter(({ marker }) => !replayText.includes(marker))
  if (missing.length) {
    const details = missing.map(({ marker, description }) => `${marker} (${description})`).join(', ')
    throw new Error(`Release replay coverage markers missing: ${details}`)
  }
}

export function buildAutoReplayArgs({ projectPath, port, replayConfigPath = '' }) {
  const args = [
    'auto-replay',
    '--project', projectPath,
    '--port', String(port),
    '--replay-all',
    '--trust-project',
  ]
  if (replayConfigPath) args.push('--replay-config-path', replayConfigPath)
  return args
}

export function assertAutoReplayFinished(output) {
  if (!String(output || '').includes('auto-replay finish')) {
    throw new Error('auto-replay did not report finish marker')
  }
}
