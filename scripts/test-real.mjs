/**
 * 真实测试统一入口
 *
 * 默认只跑云端 Admin HTTP 真测。
 * 如需同时跑小程序端 DevTools 验证，设置 RUN_MP_AUTOMATOR=1。
 *
 * 用法：
 *   node scripts/test-real.mjs
 *   RUN_MP_AUTOMATOR=1 node scripts/test-real.mjs
 */

import { spawnSync } from 'node:child_process'

function run(command, args, { allowFailure = false } = {}) {
  const res = spawnSync(command, args, {
    stdio: 'inherit',
    shell: false,
    env: process.env,
  })
  if (res.error) {
    if (allowFailure) return { status: 1, error: res.error }
    throw res.error
  }
  if (res.status !== 0 && !allowFailure) process.exit(res.status || 1)
  return { status: res.status || 0 }
}

function main() {
  const runMpAutomator = process.env.RUN_MP_AUTOMATOR === '1'

  console.log('=== Real Test: Admin HTTP ===')
  run(process.execPath, ['scripts/test-admin-http.mjs'])

  if (runMpAutomator) {
    console.log('\n=== Real Test: MiniProgram DevTools Automation ===')
    run(process.execPath, ['scripts/check-devtools-automation.mjs'])
  } else {
    console.log('\n=== Skip MiniProgram Automator ===')
    console.log('Set RUN_MP_AUTOMATOR=1 to enable DevTools automation checks in this pipeline.')
  }

  console.log('\n✅ Real test pipeline finished.')
}

main()
