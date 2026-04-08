/**
 * 真实测试统一入口
 *
 * 默认只跑云端 Admin HTTP 真测。
 * 如需同时跑小程序端真测，设置 RUN_MP_AUTOMATOR=1。
 *
 * 用法：
 *   node scripts/test-real.mjs
 *   RUN_MP_AUTOMATOR=1 node scripts/test-real.mjs
 */

import { spawnSync } from 'node:child_process'

function run(command, args) {
  const res = spawnSync(command, args, {
    stdio: 'inherit',
    shell: false,
    env: process.env,
  })
  if (res.error) throw res.error
  if (res.status !== 0) process.exit(res.status || 1)
}

function main() {
  const runMpAutomator = process.env.RUN_MP_AUTOMATOR === '1'
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm'

  console.log('=== Real Test: Admin HTTP ===')
  run(process.execPath, ['scripts/test-admin-http.mjs'])

  if (runMpAutomator) {
    console.log('\n=== Real Test: MiniProgram Automator ===')
    run(npmCmd, ['run', 'test:mp'])
  } else {
    console.log('\n=== Skip MiniProgram Automator ===')
    console.log('Set RUN_MP_AUTOMATOR=1 to enable test:mp in this pipeline.')
  }

  console.log('\n✅ Real test pipeline finished.')
}

main()
