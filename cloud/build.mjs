// Build script: bundle each cloud function into a standalone index.js
// Output goes to cloud/dist/<fnName>/index.js with its own package.json
import { build, version as esbuildVersion } from '../node_modules/esbuild/lib/main.js'
import ts from 'typescript'
import { mkdirSync, writeFileSync, readdirSync, statSync, readFileSync, renameSync, rmSync } from 'fs'
import { join, dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { createCloudReleaseProbe, createCloudReleaseProbeWrapper } from '../scripts/lib/cloud-release-probe.mjs'
import { CLOUD_COMPONENT_CONFIG_INPUTS } from '../scripts/lib/release-component-registry.mjs'
import { createReleaseComponentDigest, createRuntimeFileManifest } from '../scripts/lib/release-component-digest.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = dirname(__dirname)
const FUNCTIONS_DIR = join(__dirname, 'functions')
const DIST_DIR = join(__dirname, 'dist')
const LIB_DIR = join(__dirname, 'lib')
const rootLock = JSON.parse(readFileSync(join(ROOT_DIR, 'package-lock.json'), 'utf8'))
const wxServerSdkVersion = String(rootLock.packages?.['node_modules/wx-server-sdk']?.version || '')
if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(wxServerSdkVersion)) {
  throw new Error('root package-lock.json must pin an exact wx-server-sdk version')
}

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

function sourceFiles(directory) {
  const files = []
  for (const name of readdirSync(directory)) {
    const path = join(directory, name)
    if (statSync(path).isDirectory()) files.push(...sourceFiles(path))
    else files.push(path)
  }
  return files
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
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })

  let componentSourcePaths
  try {
    const result = await build({
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
      metafile: true,
    })
    componentSourcePaths = Object.keys(result.metafile.inputs).map((path) => resolve(process.cwd(), path))
  } catch (error) {
    console.warn(`esbuild failed for ${fnName}; falling back to TypeScript transpile.`)
    buildFallback(fnName, outDir)
    componentSourcePaths = [
      ...sourceFiles(join(FUNCTIONS_DIR, fnName)),
      ...sourceFiles(LIB_DIR),
      ...sourceFiles(join(__dirname, 'shared')),
    ]
  }

  const handlerPath = join(outDir, 'handler.js')
  rmSync(handlerPath, { force: true })
  renameSync(join(outDir, 'index.js'), handlerPath)
  // Each cloud function needs its own package.json listing wx-server-sdk
  writeFileSync(
    join(outDir, 'package.json'),
    JSON.stringify({
      name: fnName,
      version: '1.0.0',
      main: 'index.js',
      dependencies: { 'wx-server-sdk': wxServerSdkVersion }
    }, null, 2)
  )

  const componentDigest = await createReleaseComponentDigest({
    root: ROOT_DIR,
    component: `cloud:${fnName}`,
    sourcePaths: componentSourcePaths,
    configPaths: CLOUD_COMPONENT_CONFIG_INPUTS,
    lockfilePath: 'package-lock.json',
    builderVersion: `cloud-build-v1+esbuild@${esbuildVersion}+wx-server-sdk@${wxServerSdkVersion}+node16`,
  })
  writeFileSync(join(outDir, 'index.js'), createCloudReleaseProbeWrapper())
  const runtimeManifest = await createRuntimeFileManifest(outDir, {
    exclude: ['.happyhome-runtime-manifest.json', '__release.info.json'],
  })
  writeFileSync(join(outDir, '.happyhome-runtime-manifest.json'), JSON.stringify(runtimeManifest, null, 2))
  const probe = createCloudReleaseProbe({ componentDigest, functionName: fnName, runtimeDigest: runtimeManifest.runtimeDigest, sourceSha })
  writeFileSync(join(outDir, '__release.info.json'), JSON.stringify(probe, null, 2))

  console.log(`✓ ${fnName}`)
}

console.log(`\nDone! Upload the folders in cloud/dist/ to WeChat Cloud Functions.`)
