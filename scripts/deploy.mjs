/**
 * 一键部署脚本
 * 用法：
 *   node scripts/deploy.mjs cloud        # 只上传云函数
 *   node scripts/deploy.mjs miniprogram  # 只上传小程序（预览二维码）
 *   node scripts/deploy.mjs all          # 全部上传
 */
import ci from 'miniprogram-ci'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { execSync } from 'child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

const APPID = 'wx673b17363cd6b4a6'
const KEY_PATH = resolve(ROOT, `private.${APPID}.key`)
const MP_DIST = resolve(ROOT, 'miniprogram/dist/build/mp-weixin')
const CLOUD_DIST = resolve(ROOT, 'cloud/dist')
const CLOUD_ENV = 'cloudbase-3gh862acb1505ff3'

const project = new ci.Project({
  appid: APPID,
  type: 'miniProgram',
  projectPath: MP_DIST,
  privateKeyPath: KEY_PATH,
  ignores: ['node_modules/**/*'],
})

async function deployCloud() {
  console.log('\n📦 Building cloud functions...')
  execSync('node build.mjs', { cwd: resolve(ROOT, 'cloud'), stdio: 'inherit' })

  const fns = ['user', 'community', 'member', 'section', 'post', 'admin']
  for (const fn of fns) {
    console.log(`☁️  Uploading cloud function: ${fn}`)
    // admin 函数通过 HTTP 访问服务调用，运行环境没有预装 wx-server-sdk，需要远程安装
    const needsRemoteInstall = fn === 'admin'
    await ci.cloud.uploadFunction({
      project,
      name: fn,
      path: resolve(CLOUD_DIST, fn),
      env: CLOUD_ENV,
      remoteNpmInstall: needsRemoteInstall,
    })
    console.log(`   ✓ ${fn}`)
  }
  console.log('✅ Cloud functions deployed!')
}

async function deployMiniprogram() {
  console.log('\n🔨 Building miniprogram...')
  execSync('npm run build:mp-weixin', { cwd: resolve(ROOT, 'miniprogram'), stdio: 'inherit' })

  console.log('📱 Generating preview QR code...')
  const result = await ci.preview({
    project,
    desc: 'auto preview',
    setting: { es6: true, minified: false },
    qrcodeFormat: 'terminal',
    qrcodeOutputDest: resolve(ROOT, 'preview-qr.jpg'),
  })
  console.log('✅ Miniprogram preview ready! Scan QR code in preview-qr.jpg')
}

const target = process.argv[2] || 'all'
if (target === 'cloud' || target === 'all') await deployCloud()
if (target === 'miniprogram' || target === 'all') await deployMiniprogram()
