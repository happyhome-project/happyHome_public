// Build script: bundle each cloud function into a standalone index.js
// Output goes to cloud/dist/<fnName>/index.js with its own package.json
import { build } from '../node_modules/esbuild/lib/main.js'
import ts from 'typescript'
import { mkdirSync, writeFileSync, readdirSync, statSync, readFileSync, renameSync, rmSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createCloudReleaseProbe, createCloudReleaseProbeWrapper } from '../scripts/lib/cloud-release-probe.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FUNCTIONS_DIR = join(__dirname, 'functions')
const DIST_DIR = join(__dirname, 'dist')
const LIB_DIR = join(__dirname, 'lib')

function transpileTsFile(sourcePath, outPath, transform) {
  const source = readFileSync(sourcePath, 'utf8')
  let output = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2021,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
    fileName: sourcePath,
  }).outputText
  if (transform) output = transform(output)
  writeFileSync(outPath, output)
}

function buildFallback(fnName, outDir) {
  const libOutDir = join(outDir, 'lib')
  mkdirSync(libOutDir, { recursive: true })

  transpileTsFile(
    join(FUNCTIONS_DIR, fnName, 'index.ts'),
    join(outDir, 'index.js'),
    (output) => output.replace(/require\(["']\.\.\/\.\.\/lib\//g, 'require("./lib/')
  )

  for (const fileName of readdirSync(LIB_DIR)) {
    if (!fileName.endsWith('.ts')) continue
    transpileTsFile(join(LIB_DIR, fileName), join(libOutDir, fileName.replace(/\.ts$/, '.js')))
  }
}

const requestedFunctions = (process.env.HH_CLOUD_BUILD_ONLY || process.argv.find((arg) => arg.startsWith('--only='))?.slice(7) || '')
  .split(',')
  .map((name) => name.trim())
  .filter(Boolean)

const allFunctions = readdirSync(FUNCTIONS_DIR).filter(
  (f) => statSync(join(FUNCTIONS_DIR, f)).isDirectory()
)

const functions = requestedFunctions.length
  ? allFunctions.filter((fnName) => requestedFunctions.includes(fnName))
  : allFunctions
const sourceSha = process.env.HH_RELEASE_SOURCE_SHA || 'unknown'

const missingFunctions = requestedFunctions.filter((fnName) => !allFunctions.includes(fnName))
if (missingFunctions.length) {
  throw new Error(`Unknown cloud functions: ${missingFunctions.join(', ')}`)
}

for (const fnName of functions) {
  const entry = join(FUNCTIONS_DIR, fnName, 'index.ts')
  const outDir = join(DIST_DIR, fnName)
  mkdirSync(outDir, { recursive: true })

  try {
    await build({
      entryPoints: [entry],
      bundle: true,
      platform: 'node',
      target: 'node16',
      outfile: join(outDir, 'index.js'),
      // Keep SDK external and install it during function deployment.
      // This avoids bundling issues and stays aligned with cloud runtime behavior.
      external: ['wx-server-sdk'],
      format: 'cjs',
      tsconfigRaw: {
        compilerOptions: {
          target: 'ES2021',
          moduleResolution: 'node',
          esModuleInterop: true,
          skipLibCheck: true,
        },
      },
    })
  } catch (error) {
    console.warn(`esbuild failed for ${fnName}; falling back to TypeScript transpile.`)
    buildFallback(fnName, outDir)
  }

  const handlerPath = join(outDir, 'handler.js')
  rmSync(handlerPath, { force: true })
  renameSync(join(outDir, 'index.js'), handlerPath)
  const probe = createCloudReleaseProbe({ functionName: fnName, sourceSha })
  writeFileSync(join(outDir, '__release.info.json'), JSON.stringify(probe, null, 2))
  writeFileSync(join(outDir, 'index.js'), createCloudReleaseProbeWrapper())

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
