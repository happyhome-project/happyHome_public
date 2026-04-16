/**
 * One-click deployment script.
 *
 * Usage:
 *   node scripts/deploy.mjs cloud        # upload cloud functions only
 *   node scripts/deploy.mjs miniprogram  # upload mini program only (preview QR)
 *   node scripts/deploy.mjs all          # upload both
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
const CLOUD_FUNCTIONS = ['user', 'community', 'member', 'section', 'post', 'admin', 'http-gateway']

const project = new ci.Project({
  appid: APPID,
  type: 'miniProgram',
  projectPath: MP_DIST,
  privateKeyPath: KEY_PATH,
  ignores: ['node_modules/**/*'],
})

async function deployCloud() {
  console.log('\nBuilding cloud functions...')
  execSync('node build.mjs', { cwd: resolve(ROOT, 'cloud'), stdio: 'inherit' })

  for (const fn of CLOUD_FUNCTIONS) {
    console.log(`Uploading cloud function: ${fn}`)
    // Node16 cloud runtime may not have wx-server-sdk preinstalled for the function
    // sandbox. Enforce cloud-side dependency install for every function.
    await ci.cloud.uploadFunction({
      project,
      name: fn,
      path: resolve(CLOUD_DIST, fn),
      env: CLOUD_ENV,
      remoteNpmInstall: true,
    })
    console.log(`  OK: ${fn}`)
  }
  console.log('Cloud functions deployed!')
}

async function deployMiniprogram() {
  console.log('\nBuilding miniprogram...')
  execSync('npm run build:mp-weixin', { cwd: resolve(ROOT, 'miniprogram'), stdio: 'inherit' })

  console.log('Generating preview QR code...')
  await ci.preview({
    project,
    desc: 'auto preview',
    setting: { es6: true, minified: false },
    qrcodeFormat: 'terminal',
    qrcodeOutputDest: resolve(ROOT, 'preview-qr.jpg'),
  })
  console.log('Miniprogram preview ready! Scan preview-qr.jpg')
}

const target = process.argv[2] || 'all'
if (target === 'cloud' || target === 'all') await deployCloud()
if (target === 'miniprogram' || target === 'all') await deployMiniprogram()
