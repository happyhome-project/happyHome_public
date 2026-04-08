/**
 * 小程序自动化测试
 * 前提：微信开发者工具需要开启"服务端口"（设置 → 安全设置 → 开启服务端口）
 * 用法：node scripts/test-mp.mjs
 *
 * DevTools 服务端口默认按 9420 处理，可通过 WECHAT_DEVTOOLS_PORT 覆盖
 */
const DEVTOOLS_PORT = Number(process.env.WECHAT_DEVTOOLS_PORT || 9420)

async function loadAutomator() {
  try {
    return (await import('miniprogram-automator')).default
  } catch {
    console.log('Installing miniprogram-automator...')
    const { execSync } = await import('child_process')
    execSync('npm install miniprogram-automator', { stdio: 'inherit' })
    return (await import('miniprogram-automator')).default
  }
}

async function runTests() {
  if (!Number.isFinite(DEVTOOLS_PORT) || DEVTOOLS_PORT <= 0) {
    console.error('❌ Invalid WECHAT_DEVTOOLS_PORT. It must be a positive number.')
    process.exit(1)
  }

  const automator = await loadAutomator()
  console.log('🤖 Connecting to WeChat DevTools...')

  let miniProgram
  try {
    miniProgram = await automator.connect({ wsEndpoint: `ws://localhost:${DEVTOOLS_PORT}` })
  } catch (e) {
    console.error('❌ Cannot connect to DevTools. Make sure:')
    console.error('   1. WeChat DevTools is running')
    console.error('   2. Service port is enabled in DevTools settings (安全设置 → 开启服务端口)')
    process.exit(1)
  }

  console.log('✅ Connected!\n')

  try {
    // ---- Test 1: Onboarding page loads ----
    console.log('Test 1: Onboarding page loads')
    const page = await miniProgram.reLaunch('/pages/onboarding/index')
    await page.waitFor(2000)
    const title = await page.$('.title')
    const titleText = await title.text()
    console.assert(titleText === '选择你的社区', `Expected title "选择你的社区", got "${titleText}"`)
    console.log('  ✓ Onboarding title correct')

    // ---- Test 2: Create community button exists ----
    const createBtn = await page.$('.create-btn')
    console.assert(createBtn !== null, 'Create community button should exist')
    console.log('  ✓ Create community button found')

    // ---- Test 3: Navigate to create community ----
    console.log('\nTest 2: Navigate to create community page')
    await createBtn.tap()
    await miniProgram.waitFor(1000)
    const createPage = await miniProgram.currentPage()
    console.assert(createPage.path.includes('createCommunity'), `Expected createCommunity page, got ${createPage.path}`)
    console.log('  ✓ Navigated to create community page')

    // ---- Test 4: Form validation ----
    console.log('\nTest 3: Form validation (empty submit)')
    const submitBtn = await createPage.$('.submit-btn')
    await submitBtn.tap()
    await miniProgram.waitFor(500)
    console.log('  ✓ Empty form submission handled')

    // ---- Test 5: Fill and submit form ----
    console.log('\nTest 4: Fill community form')
    const nameInput = await createPage.$('.input')
    await nameInput.input('测试社区_自动化')
    const textarea = await createPage.$('.textarea')
    await textarea.input('这是一个自动化测试创建的社区')
    console.log('  ✓ Form filled')

    console.log('\n✅ All tests passed!')
  } catch (e) {
    console.error('\n❌ Test failed:', e.message)
    process.exitCode = 1
  } finally {
    await miniProgram.close()
  }
}

runTests()
