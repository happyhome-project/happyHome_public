/**
 * 快速验证 mp-weixin dist 是否加载了新版 profile 页。
 * 连 automator → 打开 profile → 查找"登录表单"标志物（避免匹配到旧版）
 */
import Connection from 'miniprogram-automator/out/Connection.js'
import MiniProgram from 'miniprogram-automator/out/MiniProgram.js'

const WS_PORT = Number(process.env.WS_PORT || 9420)

async function main() {
  console.log(`[1/5] Connecting automator on ws://127.0.0.1:${WS_PORT}`)
  const conn = await Connection.default.create(`ws://127.0.0.1:${WS_PORT}`)
  const mp = new MiniProgram.default(conn)
  console.log('  ✔ connected')

  console.log('[2/5] Clearing storage (simulate fresh install / 老"微信用户" 踢出状态)')
  await mp.evaluate(() => {
    try { wx.clearStorageSync() } catch {}
    return { cleared: true }
  })

  // Reload app via Tool.exit and re-navigate is not possible post-exit. Instead,
  // reLaunch to a new URL triggers a full app re-init inside the simulator.
  console.log('[3/5] reLaunch to trigger app re-init')
  await mp.reLaunch('/pages/index/index')
  await new Promise(r => setTimeout(r, 1500))

  console.log('[4/5] Navigating to /pages/profile/index')
  const page = await mp.reLaunch('/pages/profile/index')
  await new Promise(r => setTimeout(r, 2500))

  console.log('[5/5] Probing UI markers')
  // 新版 profile 页（未登录时）应有 .login-form, .form-title, .avatar-picker-btn 或 .avatar-preview
  const hasLoginForm = !!(await page.$('.login-form'))
  const formTitle = await page.$('.form-title')
  const formTitleText = formTitle ? await formTitle.text() : null

  // 旧版特征：只有 "微信登录" / "DEV 登录" 两个按钮，没有 .login-form
  // 如果找到 .login-form 且 title 是 "登录" → 新版加载成功

  console.log(`  login-form element: ${hasLoginForm ? '✓' : '✗'}`)
  console.log(`  form-title text: ${formTitleText ?? '(missing)'}`)

  if (hasLoginForm && formTitleText === '登录') {
    console.log('\n=== VERDICT: 新版 profile 已加载 ✓ ===')
    process.exit(0)
  } else {
    console.log('\n=== VERDICT: 新版未加载（可能还在用旧 dist）✗ ===')
    process.exit(1)
  }
}

main().catch((err) => { console.error('[FATAL]', err); process.exit(2) })
