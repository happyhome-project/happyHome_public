/**
 * 用 WeChat DevTools automator 在真实 mp-weixin 运行时里验证 Bug #2
 *
 * 前提：cli.bat auto 已经启动了自动化端口（http://127.0.0.1:13573）
 * 该脚本会：
 *   1) 连上 DevTools
 *   2) 把 test-openid 设成 h5-qa-user-001（青山村成员）
 *   3) 切到青山村
 *   4) 进 create 页
 *   5) 选"拼车"板块
 *   6) 统计渲染出来的 widget 输入框数量
 *
 * 预期结果：4 个 widget（短文字 / 出发时间 * / 空余座位 * / 地图）
 * 如果是 0 个 → Bug #2 是 mp-weixin 源码层真 bug
 * 如果是 4 个 → Bug #2 就是之前 DevTools 缓存 stale 导致的
 */
import automator from 'miniprogram-automator'
import Connection from 'miniprogram-automator/out/Connection.js'
import MiniProgram from 'miniprogram-automator/out/MiniProgram.js'

const WS_PORT = 9420
const QINGSHAN_ID = '6ded7a7769e789c1000879305ec314da'
const TEST_OPENID = 'h5-qa-user-001'

async function main() {
  console.log(`[1/8] Connecting to DevTools automator at 127.0.0.1:${WS_PORT}...`)
  // 跳过 checkVersion —— SDKVersion 查询有时返回 undefined 导致拒连
  const conn = await Connection.default.create(`ws://127.0.0.1:${WS_PORT}`)
  const miniProgram = new MiniProgram.default(conn)
  console.log('  ✔ connected (bypassing version check)')

  // 给 storage 塞入完整身份信息：登录态 + DEV 网关 + 当前社区
  console.log(`[2/8] Seeding storage (user_store + community_store + dev-gateway)`)
  await miniProgram.evaluate((openid, commId) => {
    wx.setStorageSync('test-openid', openid)
    wx.setStorageSync('dev-gateway', '1')
    wx.setStorageSync('user_store', {
      openId: openid,
      nickName: 'QA自动化测试',
      avatarUrl: '',
      role: 'user',
      isLoggedIn: true,
    })
    wx.setStorageSync('community_store', { currentCommunityId: commId, currentSectionIndex: 0 })
    return { ok: true }
  }, TEST_OPENID, QINGSHAN_ID)
  console.log('  ✔ storage seeded')

  // 关键：storage 是在 App.onLaunch 时被 Pinia store 读取的。由于 automator 连上
  // 时 App 早已启动，我们需要**强制重启**才能让新 storage 生效。
  // 用 wx.reLaunch 只换路由，不重置 Pinia state；只能手动重置 stores。
  console.log('[3/8] Force-resetting Pinia stores to re-read seeded storage')
  await miniProgram.evaluate(() => {
    // 找到全局的 Vue app 实例（uni-app v3 暴露在 getCurrentPages()[...].$vm.$ 上）
    // 通过 pinia 的 globalState 可以直接 $reset / $patch
    try {
      // 各页面的 Vue 实例都共享同一个 pinia，拿第一个就行
      const pages = getCurrentPages()
      const vm = pages && pages[0] && (pages[0].$vm || pages[0].$vue || pages[0])
      const pinia = vm && (vm.$pinia || (vm.$ && vm.$appContext && vm.$appContext.config.globalProperties.$pinia))
      if (!pinia) return { err: 'no pinia found', pages: pages && pages.length }
      // 遍历所有已创建的 store 并重新读 storage
      for (const [id, store] of pinia._s) {
        if (typeof store.loadFromStorage === 'function') store.loadFromStorage()
      }
      return { ok: true, storeIds: Array.from(pinia._s.keys()) }
    } catch (e) {
      return { err: String(e) }
    }
  }).then(r => console.log('  reset result:', JSON.stringify(r)))

  console.log('[4/8] Navigating to /pages/create/index')
  const createPage = await miniProgram.reLaunch('/pages/create/index')
  await new Promise(r => setTimeout(r, 3000))

  // 读当前页状态
  const pageData = await createPage.data()
  console.log('[5/8] Page data snapshot:')
  console.log('  selectedSection:', pageData.selectedSection?.name || '(not selected)')
  console.log('  isMember:', pageData.isMember)
  console.log('  membershipReady:', pageData.membershipReady)
  console.log('  currentCommunityId:', pageData.communityStore?.currentCommunityId)

  // 找到 section picker 的 section-option，点"拼车"
  console.log('[6/8] Looking for section picker items')
  const sectionOptions = await createPage.$$('.section-option')
  console.log(`  found ${sectionOptions.length} section options`)

  if (sectionOptions.length === 0) {
    // 可能 membership 没通过，guard 卡住
    console.log('  ⚠️ No section options — probably membership guard blocked')
    const guardTitle = await createPage.$('.guard-title')
    if (guardTitle) {
      const txt = await guardTitle.text()
      console.log(`  guard-title: "${txt}"`)
    }
    await miniProgram.disconnect()
    process.exit(1)
  }

  // 找到哪个是"拼车"
  let pincheIndex = -1
  for (let i = 0; i < sectionOptions.length; i++) {
    const nameEl = await sectionOptions[i].$('.section-name')
    const name = nameEl ? await nameEl.text() : ''
    console.log(`  [${i}] ${name}`)
    if (name === '拼车') pincheIndex = i
  }

  if (pincheIndex < 0) {
    console.log('  ❌ "拼车" not in section list')
    await miniProgram.disconnect()
    process.exit(1)
  }

  console.log(`[7/8] Tapping section-option[${pincheIndex}] (拼车)`)
  await sectionOptions[pincheIndex].tap()
  await new Promise(r => setTimeout(r, 800))

  // 查渲染出的 widget-editor
  console.log('[8/8] Counting rendered widgets')
  const widgets = await createPage.$$('.widget-editor')
  console.log(`  widget-editor count: ${widgets.length}`)
  const labels = []
  for (const w of widgets) {
    const labEl = await w.$('.label')
    const lab = labEl ? await labEl.text() : '(no label)'
    labels.push(lab)
  }
  console.log('  labels:', JSON.stringify(labels))

  const sectionTag = await createPage.$('.section-tag')
  if (sectionTag) console.log('  section-tag:', await sectionTag.text())

  // 结论
  console.log('\n=== VERDICT ===')
  if (widgets.length >= 4) {
    console.log(`✅ Bug #2 NOT reproduced (${widgets.length} widgets rendered). Source is fine; earlier report was stale build/cache.`)
  } else {
    console.log(`❌ Bug #2 CONFIRMED in mp-weixin runtime (${widgets.length} widgets rendered, expected 4). REAL SOURCE BUG.`)
  }

  await miniProgram.disconnect()
}

main().catch(err => {
  console.error('[FATAL]', err)
  process.exit(1)
})
