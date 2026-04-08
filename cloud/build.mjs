// Build script: bundle each cloud function into a standalone index.js
// Output goes to cloud/dist/<fnName>/index.js with its own package.json
import { build } from '../node_modules/esbuild/lib/main.js'
import { mkdirSync, writeFileSync, readdirSync, statSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FUNCTIONS_DIR = join(__dirname, 'functions')
const DIST_DIR = join(__dirname, 'dist')

const functions = readdirSync(FUNCTIONS_DIR).filter(
  (f) => statSync(join(FUNCTIONS_DIR, f)).isDirectory()
)

for (const fnName of functions) {
  const entry = join(FUNCTIONS_DIR, fnName, 'index.ts')
  const outDir = join(DIST_DIR, fnName)
  mkdirSync(outDir, { recursive: true })

  await build({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    target: 'node16',
    outfile: join(outDir, 'index.js'),
    external: ['wx-server-sdk'],  // wx-server-sdk is provided by the cloud runtime
    format: 'cjs',
  })

  // Each cloud function needs its own package.json listing wx-server-sdk
  writeFileSync(
    join(outDir, 'package.json'),
    JSON.stringify({
      name: fnName,
      version: '1.0.0',
      main: 'index.js',
      dependencies: { 'wx-server-sdk': 'latest' }
    }, null, 2)
  )

  console.log(`✓ ${fnName}`)
}

console.log(`\nDone! Upload the folders in cloud/dist/ to WeChat Cloud Functions.`)
