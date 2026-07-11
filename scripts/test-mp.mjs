/**
 * 小程序自动化测试
 * 前提：微信开发者工具需要开启"服务端口"（设置 → 安全设置 → 开启服务端口）
 * 用法：node scripts/test-mp.mjs
 *
 * DevTools 服务端口默认按 9420 处理，可通过 WECHAT_DEVTOOLS_PORT 覆盖
 *
 * 可选环境变量：
 *   WECHAT_DEVTOOLS_CLI_PATH
 *   WECHAT_DEVTOOLS_PROJECT_PATH
 */
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const DEVTOOLS_PORT = Number(process.env.WECHAT_DEVTOOLS_PORT || 9420)
const DEFAULT_PROJECT_PATH = resolve(ROOT, 'miniprogram', 'dist', 'build', 'mp-weixin')
const DEFAULT_CLI_PATH = process.platform === 'win32'
  ? 'X:\\Program Files (x86)\\Tencent\\微信web开发者工具\\cli.bat'
  : ''

function quoteForPowerShell(arg) {
  const str = String(arg)
  return `'${str.replace(/'/g, "''")}'`
}

function runCli(cliPath, args, options = {}) {
  const baseOptions = { encoding: 'utf8', ...options }
  if (process.platform === 'win32') {
    const psCommand = `& ${quoteForPowerShell(cliPath)} ${args.map(quoteForPowerShell).join(' ')}`
    return spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psCommand], baseOptions)
  }
  return spawnSync(cliPath, args, baseOptions)
}

function resolveCliPath() {
  const cliPath = String(process.env.WECHAT_DEVTOOLS_CLI_PATH || DEFAULT_CLI_PATH).trim()
  if (!cliPath || !existsSync(cliPath)) return ''
  return cliPath
}

function resolveProjectPath() {
  const projectPath = String(process.env.WECHAT_DEVTOOLS_PROJECT_PATH || DEFAULT_PROJECT_PATH).trim()
  if (!projectPath || !existsSync(projectPath)) return ''
  return projectPath
}

async function loadAutomator() {
  try {
    return (await import('miniprogram-automator')).default
  } catch (error) {
    throw new Error(
      `miniprogram-automator is unavailable. Run npm.cmd ci from the repository root before this test. ${error?.message || error}`
    )
  }
}

async function connectOrLaunch(automator) {
  const wsEndpoints = [`ws://127.0.0.1:${DEVTOOLS_PORT}`, `ws://localhost:${DEVTOOLS_PORT}`]
  let connectError = null

  for (const wsEndpoint of wsEndpoints) {
    try {
      console.log(`🔌 Trying connect: ${wsEndpoint}`)
      return await automator.connect({ wsEndpoint })
    } catch (err) {
      connectError = err
    }
  }

  const cliPath = resolveCliPath()
  const projectPath = resolveProjectPath()
  if (!cliPath || !projectPath) {
    throw new Error(
      [
        'Cannot connect to DevTools and launch fallback is unavailable.',
        `cliPath: ${cliPath || '(missing)'}`,
        `projectPath: ${projectPath || '(missing)'}`,
        `connectError: ${connectError?.message || connectError || 'unknown'}`,
      ].join(' ')
    )
  }

  console.log(`🧪 Fallback auto-enable via CLI: ${cliPath}`)
  console.log(`📁 Project path: ${projectPath}`)

  const helpResult = runCli(cliPath, ['auto', '--help'])
  const helpText = `${helpResult.stdout || ''}\n${helpResult.stderr || ''}`
  const supportsAutoPort = helpText.includes('--auto-port')

  if (!supportsAutoPort) {
    throw new Error(
      [
        'Current WeChat DevTools CLI appears incompatible with miniprogram-automator.',
        'Reason: `cli auto --help` does not contain `--auto-port`,',
        'but miniprogram-automator requires a websocket auto port.',
      ].join(' ')
    )
  }

  const autoArgs = [
    'auto',
    '--project',
    projectPath,
    '--auto-port',
    String(DEVTOOLS_PORT),
    '--trust-project',
  ]
  const autoResult = runCli(cliPath, autoArgs, { timeout: 120000 })
  if (autoResult.status !== 0) {
    throw new Error(
      [
        'Failed to run DevTools CLI auto command.',
        `status=${autoResult.status}`,
        `stderr=${(autoResult.stderr || '').trim()}`,
      ].join(' ')
    )
  }

  await new Promise((resolveWait) => setTimeout(resolveWait, 2000))
  for (const wsEndpoint of wsEndpoints) {
    try {
      console.log(`🔁 Retrying connect: ${wsEndpoint}`)
      return await automator.connect({ wsEndpoint })
    } catch (err) {
      connectError = err
    }
  }

  try {
    throw new Error(
      [
        'CLI auto command ran, but websocket is still unreachable.',
        `connectError: ${connectError?.message || connectError || 'unknown'}`,
      ].join(' ')
    )
  } catch (finalError) {
    throw finalError
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
    miniProgram = await connectOrLaunch(automator)
  } catch (e) {
    console.error('❌ Cannot connect to DevTools. Make sure:')
    console.error('   1. WeChat DevTools is running and has an opened project window')
    console.error('   2. Service port is enabled in DevTools settings (安全设置 → 开启服务端口)')
    console.error('   3. If needed, set WECHAT_DEVTOOLS_CLI_PATH / WECHAT_DEVTOOLS_PROJECT_PATH for launch fallback')
    console.error(`   detail: ${e?.message || e}`)
    process.exit(1)
  }

  console.log('✅ Connected!\n')

  try {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

    // ---- Test 1: Onboarding page loads ----
    console.log('Test 1: Onboarding page loads')
    const page = await miniProgram.reLaunch('/pages/onboarding/index')
    await page.waitFor(2000)
    const title = await page.$('.title')
    const titleText = await title.text()
    console.assert(titleText === '请选择你的社区', `Expected title "请选择你的社区", got "${titleText}"`)
    console.log('  ✓ Onboarding title correct')

    // ---- Test 2: Create community button exists ----
    const createBtn = await page.$('.create-entry')
    console.assert(createBtn !== null, 'Create community button should exist')
    console.log('  ✓ Create community button found')

    // ---- Test 3: Navigate to create community ----
    console.log('\nTest 2: Navigate to create community page')
    await createBtn.tap()
    await sleep(1000)
    const createPage = await miniProgram.currentPage()
    console.assert(createPage.path.includes('createCommunity'), `Expected createCommunity page, got ${createPage.path}`)
    console.log('  ✓ Navigated to create community page')

    // ---- Test 4: Form validation ----
    console.log('\nTest 3: Form validation (empty submit)')
    const submitBtn = await createPage.$('.submit-btn')
    await submitBtn.tap()
    await sleep(500)
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
