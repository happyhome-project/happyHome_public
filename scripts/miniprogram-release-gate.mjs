/**
 * Release gate for mini-program blank-page regressions.
 *
 * This does not upload and does not generate QR codes. It blocks known causes
 * of blank detail/profile pages before a development build is uploaded.
 */
import { spawnSync } from 'node:child_process'
import process from 'node:process'

const skipMpBuild = process.argv.includes('--skip-mp-build')
const skipDevtools = process.argv.includes('--skip-devtools')
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm'

function run(label, command, args, options = {}) {
  console.log(`\n[release-gate] ${label}`)
  const spawnCommand = process.platform === 'win32' && command.endsWith('.cmd')
    ? 'cmd.exe'
    : command
  const spawnArgs = process.platform === 'win32' && command.endsWith('.cmd')
    ? ['/d', '/s', '/c', [command, ...args].map(quoteCmdArg).join(' ')]
    : args
  const result = spawnSync(spawnCommand, spawnArgs, {
    cwd: process.cwd(),
    stdio: 'inherit',
    shell: false,
    env: process.env,
    ...options,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status}`)
  }
}

function quoteCmdArg(value) {
  const str = String(value)
  if (!/[ \t&()^|<>"]/.test(str)) return str
  return `"${str.replace(/"/g, '\\"')}"`
}

function main() {
  if (!skipMpBuild) {
    run('build mp-weixin', npmCmd, ['run', 'build:mp-weixin', '--workspace', 'miniprogram'])
  } else {
    console.log('[release-gate] build mp-weixin skipped by --skip-mp-build')
  }

  run('detail/profile compiled runtime syntax guard', npmCmd, ['run', 'test:mp:detail-runtime-syntax'])
  run('profile critical path guard', npmCmd, ['run', 'test:mp:profile-critical-path'])

  run('build H5 for smoke tests', npmCmd, ['run', 'build:h5', '--workspace', 'miniprogram'])
  run('H5 profile blank-page smoke', npmCmd, ['run', 'test:h5:profile-smoke'])
  run('H5 detail blank-page smoke', npmCmd, ['run', 'test:h5:detail-smoke'])
  run('H5 section blank-page smoke', npmCmd, ['run', 'test:h5:section-smoke'])

  if (!skipDevtools) {
    run('WeChat DevTools automation capability', npmCmd, ['run', 'test:mp:devtools'])
    run('WeChat DevTools recorded release replay', npmCmd, ['run', 'test:mp:replay', '--', '--require-release-replay'])
  } else {
    console.log('[release-gate] DevTools automation capability skipped by --skip-devtools')
    console.log('[release-gate] recorded release replay skipped by --skip-devtools')
  }

  console.log('\n[release-gate] Mini-program blank-page release gate passed.')
}

try {
  main()
} catch (error) {
  console.error(`\n[release-gate] FAILED: ${error?.message || error}`)
  process.exit(1)
}
