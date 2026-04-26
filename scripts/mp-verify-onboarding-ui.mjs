/**
 * 验证 mp-weixin 下的 /pages/onboarding/index：
 * 用真实用户 openid（有 1 个 pending 自创社区 + 若干可申请的 active 社区）打开
 * onboarding 页，查列表是否正确渲染 creator-pending + 其他 card。
 */
import Connection from 'miniprogram-automator/out/Connection.js'
import MiniProgram from 'miniprogram-automator/out/MiniProgram.js'

const WS_PORT = Number(process.env.WS_PORT || 9420)
const REAL_USER_OPENID = 'oYT0E5K1XkC3GU8wZvnMIPge62t4'

async function main() {
  console.log(`[1/5] Connecting automator ws://127.0.0.1:${WS_PORT}`)
  const conn = await Connection.default.create(`ws://127.0.0.1:${WS_PORT}`)
  const mp = new MiniProgram.default(conn)
  console.log('  ✔ connected')

  console.log('[2/5] Clearing storage + seeding user_store as real user (走 H5 gateway 路径)')
  await mp.evaluate((openid) => {
    try { wx.clearStorageSync() } catch {}
    wx.setStorageSync('test-openid', openid)
    wx.setStorageSync('dev-gateway', '1')
    wx.setStorageSync('user_store', { openId: openid, nickName: 'QA真实用户', avatarUrl: '', role: 'user', isLoggedIn: true })
    return { seeded: true }
  }, REAL_USER_OPENID)

  console.log('[3/5] reLaunch index to re-init app')
  await mp.reLaunch('/pages/index/index')
  await new Promise(r => setTimeout(r, 1500))

  console.log('[4/5] Navigating to /pages/onboarding/index')
  const page = await mp.reLaunch('/pages/onboarding/index')
  await new Promise(r => setTimeout(r, 3500))

  console.log('[5/5] Probing cards')
  const cards = await page.$$('.community-card')
  console.log(`  rendered card count: ${cards.length}`)

  const summary = []
  for (const card of cards) {
    const nameEl = await card.$('.name')
    const badgeEl = await card.$('.badge')
    const name = nameEl ? await nameEl.text() : '(no name)'
    const badge = badgeEl ? await badgeEl.text() : '(no badge)'
    const badgeAttr = badgeEl ? await badgeEl.attribute('class') : ''
    summary.push({ name, badge, badgeClasses: badgeAttr })
  }
  console.log('  cards:', JSON.stringify(summary, null, 2))

  // Criteria
  const creatorPending = summary.find(c => c.name === '明士班')
  const ok = creatorPending && /审核中.*你创建的/.test(creatorPending.badge) && summary.length >= 2

  console.log('\n=== VERDICT ===')
  if (ok) {
    console.log('✅ onboarding 列表正确渲染：包含 creator-pending 社区 + 其他')
    process.exit(0)
  } else {
    console.log('❌ 预期 creator-pending "明士班" 显示"审核中 · 你创建的"，实际未找到')
    process.exit(1)
  }
}

main().catch((err) => { console.error('[FATAL]', err); process.exit(2) })
