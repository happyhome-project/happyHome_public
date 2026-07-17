import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { parse } from 'acorn'

export const KNOWN_NODE_MODULES_SHA256 = '94d87d9569f6eaef3dad96942f5f3c7857f132d3cd191d5fc263a482b1001eb8'
export const KNOWN_NODE_MODULES_SHA256_ALTERNATE = '07be8ba73da09681b3bd94974b3a84cb34072738a315ea26438902798a533eb9'
export const KNOWN_WECHAT_BASE_LIBRARY_VERSION = '3.15.1'

function walk(node, visitor, parent = null) {
  if (!node || typeof node.type !== 'string') return
  visitor(node, parent)
  for (const [key, value] of Object.entries(node)) {
    if (key === 'parent') continue
    if (Array.isArray(value)) {
      for (const child of value) walk(child, visitor, node)
    } else if (value && typeof value === 'object') {
      walk(value, visitor, node)
    }
  }
}

function memberName(node) {
  if (!node || node.type !== 'MemberExpression') return ''
  if (!node.computed && node.property?.type === 'Identifier') return node.property.name
  if (node.computed && node.property?.type === 'Literal') return String(node.property.value || '')
  return ''
}

function staticMemberName(node) {
  if (!node || node.type !== 'MemberExpression' || node.object?.type !== 'Identifier') return ''
  const property = memberName(node)
  return property ? `${node.object.name}.${property}` : ''
}

function isFrameworkRuntimeChunk(distRoot, chunkPath) {
  return path.relative(distRoot, chunkPath).replaceAll(path.sep, '/') === 'common/vendor.js'
}

const COMPONENT_SCOPE_MARKER = 'SCOPEID'
const PATH_STABLE_TEXT_EXTENSIONS = new Set(['.js', '.json', '.wxml'])

function normalizeCompilerComponentScopes(filePath, source) {
  const extension = path.extname(filePath).toLowerCase()
  if (extension === '.wxml') {
    return source.replace(/(\bu-i\s*=\s*["'])[0-9a-f]{8}(?=-\d+\b)/gi, `$1${COMPONENT_SCOPE_MARKER}`)
  }
  if (extension === '.json') {
    return source.replace(/("u-i"\s*:\s*")[0-9a-f]{8}(?=-\d+\b)/gi, `$1${COMPONENT_SCOPE_MARKER}`)
  }
  if (extension === '.js') {
    return source
      .replace(/(\.sr\(\s*["'][^"']*["']\s*,\s*["'])[0-9a-f]{8}(?=-\d+\b)/gi, `$1${COMPONENT_SCOPE_MARKER}`)
      .replace(/(\bc\s*:\s*["'])[0-9a-f]{8}(?=-\d+-["'])/gi, `$1${COMPONENT_SCOPE_MARKER}`)
  }
  return source
}

function pathStableNodeModulesContent(filePath) {
  const content = fs.readFileSync(filePath)
  if (!PATH_STABLE_TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase())) return content
  return Buffer.from(normalizeCompilerComponentScopes(filePath, content.toString('utf8')))
}

export function hashNodeModulesDirectory(directoryPath) {
  const files = []
  const pending = [directoryPath]
  while (pending.length > 0) {
    const current = pending.pop()
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name)
      if (entry.isDirectory()) pending.push(entryPath)
      else files.push(entryPath)
    }
  }
  files.sort((left, right) => left.localeCompare(right, 'en'))
  const hash = createHash('sha256')
  for (const filePath of files) {
    hash.update(path.relative(directoryPath, filePath).replaceAll(path.sep, '/'))
    hash.update('\0')
    hash.update(pathStableNodeModulesContent(filePath))
    hash.update('\0')
  }
  return hash.digest('hex')
}

function resolveLocalArtifact(distRoot, importerPath, request, defaultExtension, dependencyKind) {
  const value = String(request || '')
  let candidate = ''
  if (value.startsWith('.')) candidate = path.resolve(path.dirname(importerPath), value)
  else if (value.startsWith('/')) candidate = path.resolve(distRoot, value.slice(1))
  else if (/^(?:plugin|ext):\/\//.test(value)) return ''
  else throw new Error(`Unsupported bare mp-weixin dependency request in ${importerPath}: ${value}`)

  const artifactPath = path.extname(candidate) ? candidate : `${candidate}${defaultExtension}`
  const relativePath = path.relative(distRoot, artifactPath)
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error(`mp-weixin dependency escapes package root in ${importerPath}: ${value}`)
  }
  if (!fs.existsSync(artifactPath)) {
    throw new Error(`Missing mp-weixin ${dependencyKind}: ${artifactPath}`)
  }
  return artifactPath
}

function resolveLocalChunk(distRoot, importerPath, request) {
  return resolveLocalArtifact(distRoot, importerPath, request, '.js', 'critical dependency chunk')
}

function parseChunk(source, chunkPath) {
  try {
    return parse(source, { ecmaVersion: 'latest', sourceType: 'script' })
  } catch (error) {
    throw new Error(`Cannot parse mp-weixin critical dependency chunk ${chunkPath}: ${error.message}`)
  }
}

function readWxmlDependencies(distRoot, templatePath, visited = new Set()) {
  if (visited.has(templatePath)) return
  visited.add(templatePath)
  const source = fs.readFileSync(templatePath, 'utf8')
  const dependencyPattern = /<(import|include|wxs)\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi
  for (const match of source.matchAll(dependencyPattern)) {
    const extension = match[1].toLowerCase() === 'wxs' ? '.wxs' : '.wxml'
    const dependency = resolveLocalArtifact(distRoot, templatePath, match[2], extension, 'template dependency')
    if (dependency && extension === '.wxml') readWxmlDependencies(distRoot, dependency, visited)
  }
}

function readWxssDependencies(distRoot, stylePath, visited = new Set()) {
  if (!fs.existsSync(stylePath) || visited.has(stylePath)) return
  visited.add(stylePath)
  const source = fs.readFileSync(stylePath, 'utf8')
  const dependencyPattern = /@import\s+(?:url\(\s*)?["']([^"']+)["']\s*\)?\s*;/gi
  for (const match of source.matchAll(dependencyPattern)) {
    const dependency = resolveLocalArtifact(distRoot, stylePath, match[1], '.wxss', 'style dependency')
    if (dependency) readWxssDependencies(distRoot, dependency, visited)
  }
}

function componentRequests(config) {
  const requests = Object.values(config.usingComponents || {})
  for (const generic of Object.values(config.componentGenerics || {})) {
    if (generic && typeof generic === 'object' && typeof generic.default === 'string') {
      requests.push(generic.default)
    }
  }
  return requests
}

function readComponentDependencies(distRoot, chunkPath, artifactType) {
  const configPath = chunkPath.replace(/\.js$/i, '.json')
  const templatePath = chunkPath.replace(/\.js$/i, '.wxml')
  if (!fs.existsSync(configPath)) {
    throw new Error(`Missing mp-weixin ${artifactType} config: ${configPath}`)
  }
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Missing mp-weixin ${artifactType} template: ${templatePath}`)
  }
  readWxmlDependencies(distRoot, templatePath)
  readWxssDependencies(distRoot, chunkPath.replace(/\.js$/i, '.wxss'))
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  if (artifactType === 'component' && config.component !== true) {
    throw new Error(`Invalid mp-weixin component config; expected component=true: ${configPath}`)
  }
  return componentRequests(config)
    .map((request) => resolveLocalChunk(distRoot, configPath, request))
    .filter(Boolean)
}

function readApplicationEntrypoints(distRoot) {
  const configPath = path.join(distRoot, 'app.json')
  if (!fs.existsSync(configPath)) throw new Error(`Missing mp-weixin app config: ${configPath}`)
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  const pages = Array.isArray(config.pages) ? config.pages.slice() : []
  const subPackages = Array.isArray(config.subPackages)
    ? config.subPackages
    : Array.isArray(config.subpackages)
      ? config.subpackages
      : []
  for (const subPackage of subPackages) {
    const root = String(subPackage?.root || '').replace(/^\/+|\/+$/g, '')
    for (const page of Array.isArray(subPackage?.pages) ? subPackage.pages : []) {
      pages.push(root ? `${root}/${page}` : String(page || ''))
    }
  }
  const entrypoints = [{ relativePath: 'app.js', artifactType: 'application' }]
  for (const page of pages) {
    const relativePath = String(page || '').replaceAll('\\', '/').replace(/^\/+/, '')
    if (relativePath.split('/').includes('..')) {
      throw new Error(`Invalid mp-weixin page path outside app root: ${relativePath}`)
    }
    if (relativePath) {
      entrypoints.push({
        relativePath: relativePath.endsWith('.js') ? relativePath : `${relativePath}.js`,
        artifactType: 'page',
      })
    }
  }
  for (const request of componentRequests(config)) {
    const chunkPath = resolveLocalChunk(distRoot, configPath, request)
    if (chunkPath) {
      entrypoints.push({
        relativePath: path.relative(distRoot, chunkPath),
        artifactType: 'component',
      })
    }
  }
  return { config, entrypoints }
}

function readProjectConfig(distRoot) {
  const configPath = path.join(distRoot, 'project.config.json')
  if (!fs.existsSync(configPath)) throw new Error(`Missing mp-weixin project config: ${configPath}`)
  return JSON.parse(fs.readFileSync(configPath, 'utf8'))
}

function collectCriticalDependencyChunks(distRoot, entrypoints) {
  const pending = entrypoints.map(({ relativePath, artifactType }) => ({
    chunkPath: path.join(distRoot, relativePath),
    artifactType,
  }))
  const visited = new Set()
  const validatedBundles = new Set()

  while (pending.length > 0) {
    const current = pending.pop()
    const chunkPath = current?.chunkPath
    if (!chunkPath || isFrameworkRuntimeChunk(distRoot, chunkPath)) continue
    if (!fs.existsSync(chunkPath)) {
      throw new Error(`Missing mp-weixin critical dependency chunk: ${chunkPath}`)
    }

    if (current.artifactType === 'page' || current.artifactType === 'component') {
      const bundleKey = `${current.artifactType}:${chunkPath}`
      if (!validatedBundles.has(bundleKey)) {
        validatedBundles.add(bundleKey)
        for (const dependency of readComponentDependencies(distRoot, chunkPath, current.artifactType)) {
          pending.push({ chunkPath: dependency, artifactType: 'component' })
        }
      }
    }
    if (visited.has(chunkPath)) continue

    visited.add(chunkPath)
    const source = fs.readFileSync(chunkPath, 'utf8')
    const ast = parseChunk(source, chunkPath)
    walk(ast, (node) => {
      if (node.type === 'CallExpression' && node.callee?.type === 'Identifier' && node.callee.name === 'require') {
        const request = node.arguments?.[0]
        if (request?.type !== 'Literal' || typeof request.value !== 'string') {
          throw new Error(`Dynamic require prevents mp-weixin dependency verification: ${chunkPath}`)
        }
        const dependency = resolveLocalChunk(distRoot, chunkPath, request.value)
        if (dependency) pending.push({ chunkPath: dependency, artifactType: 'module' })
      }
      if (node.type === 'ImportExpression') {
        const request = node.source
        if (request?.type !== 'Literal' || typeof request.value !== 'string') {
          throw new Error(`Dynamic import prevents mp-weixin dependency verification: ${chunkPath}`)
        }
        const dependency = resolveLocalChunk(distRoot, chunkPath, request.value)
        if (dependency) pending.push({ chunkPath: dependency, artifactType: 'module' })
      }
    })
  }

  return [...visited].sort()
}

function findingForNode(relativePath, rule, node, source) {
  const start = Math.max(0, Number(node.start || 0) - 80)
  const end = Math.min(source.length, Number(node.end || node.start || 0) + 80)
  return {
    file: relativePath,
    rule,
    offset: Number(node.start || 0),
    snippet: source.slice(start, end).replace(/\s+/g, ' '),
  }
}

function isUnicodePropertyEscape(node) {
  if (node.type === 'Literal' && node.regex) {
    return /\\[pP]\{/.test(String(node.regex.pattern || ''))
  }
  return (
    (node.type === 'NewExpression' || node.type === 'CallExpression') &&
    node.callee?.type === 'Identifier' &&
    node.callee.name === 'RegExp' &&
    node.arguments?.[0]?.type === 'Literal' &&
    /\\[pP]\{/.test(String(node.arguments[0].value || ''))
  )
}

function scanVendorCompatibilitySyntax(relativePath, source, ast) {
  const findings = []
  walk(ast, (node) => {
    if (isUnicodePropertyEscape(node)) {
      findings.push(findingForNode(relativePath, 'Unicode property escape', node, source))
    }
  })
  return findings
}

function scanChunk(relativePath, source, ast) {
  const findings = []
  walk(ast, (node, parent) => {
    if (isUnicodePropertyEscape(node)) {
      findings.push(findingForNode(relativePath, 'Unicode property escape', node, source))
    }
    if (node.type === 'ArrowFunctionExpression' && node.params.some((param) => param.type === 'ArrayPattern')) {
      findings.push(findingForNode(relativePath, 'array destructuring arrow parameter', node, source))
    }
    if (node.type === 'FunctionExpression' && node.params.some((param) => param.type === 'ArrayPattern')) {
      findings.push(findingForNode(relativePath, 'array destructuring callback parameter', node, source))
    }
    if (node.type === 'VariableDeclarator' && node.id?.type === 'ArrayPattern') {
      findings.push(findingForNode(relativePath, 'array destructuring declaration', node, source))
    }
    if (node.type === 'MemberExpression') {
      const staticName = staticMemberName(node)
      if (staticName === 'Object.fromEntries') findings.push(findingForNode(relativePath, 'Object.fromEntries', node, source))
      if (staticName === 'Object.values') findings.push(findingForNode(relativePath, 'Object.values', node, source))
      if (staticName === 'Array.from') findings.push(findingForNode(relativePath, 'Array.from', node, source))
      if (['Object.getOwnPropertySymbols', 'Object.getOwnPropertyDescriptor'].includes(staticName) || memberName(node) === 'propertyIsEnumerable') {
        findings.push(findingForNode(relativePath, 'compiled object spread helper', node, source))
      }
    }
    if (node.type === 'LogicalExpression' && node.operator === '??') {
      findings.push(findingForNode(relativePath, 'nullish coalescing', node, source))
    }
    if (node.type === 'SpreadElement' && ['ArrayExpression', 'ObjectExpression'].includes(parent?.type)) {
      findings.push(findingForNode(relativePath, 'collection spread', node, source))
    }
    if (node.type === 'CatchClause' && node.param == null) {
      findings.push(findingForNode(relativePath, 'optional catch binding', node, source))
    }
  })
  return findings
}

export function scanCriticalRuntimeSyntax(inputDistRoot, options = {}) {
  const distRoot = path.resolve(inputDistRoot)
  const application = readApplicationEntrypoints(distRoot)
  const projectConfig = readProjectConfig(distRoot)
  const detailConfig = path.join(distRoot, 'pages', 'detail', 'index.json')
  if (!fs.existsSync(detailConfig)) {
    throw new Error(`Missing mp-weixin detail page config: ${detailConfig}`)
  }

  const findings = []
  if (application.config.lazyCodeLoading !== 'requiredComponents') {
    findings.push({
      file: 'app.json',
      rule: 'requiredComponents lazy code loading',
      offset: 0,
      snippet: `lazyCodeLoading=${JSON.stringify(application.config.lazyCodeLoading || '')}`,
    })
  }
  const expectedBaseLibraryVersion = Object.prototype.hasOwnProperty.call(options, 'expectedBaseLibraryVersion')
    ? String(options.expectedBaseLibraryVersion || '')
    : KNOWN_WECHAT_BASE_LIBRARY_VERSION
  if (expectedBaseLibraryVersion && String(projectConfig.libVersion || '') !== expectedBaseLibraryVersion) {
    findings.push({
      file: 'project.config.json',
      rule: 'pinned WeChat base library',
      offset: 0,
      snippet: `expected=${JSON.stringify(expectedBaseLibraryVersion)} actual=${JSON.stringify(projectConfig.libVersion || '')}`,
    })
  }
  if (
    projectConfig.setting?.es6 !== false ||
    projectConfig.setting?.minified !== false ||
    projectConfig.setting?.enhance !== false
  ) {
    findings.push({
      file: 'project.config.json',
      rule: 'upload preserves scanned JavaScript',
      offset: 0,
      snippet: `es6=${JSON.stringify(projectConfig.setting?.es6)} minified=${JSON.stringify(projectConfig.setting?.minified)} enhance=${JSON.stringify(projectConfig.setting?.enhance)}`,
    })
  }
  const vendorPath = path.join(distRoot, 'common', 'vendor.js')
  const expectedVendorHash = Object.prototype.hasOwnProperty.call(options, 'expectedVendorHash')
    ? options.expectedVendorHash
    : ''
  const hasVendorRuntime = fs.existsSync(vendorPath)
  if (hasVendorRuntime) {
    const vendorSource = fs.readFileSync(vendorPath, 'utf8')
    findings.push(...scanVendorCompatibilitySyntax('common/vendor.js', vendorSource, parseChunk(vendorSource, vendorPath)))
    if (expectedVendorHash) {
      const actualVendorHash = createHash('sha256').update(vendorSource).digest('hex')
      if (actualVendorHash !== expectedVendorHash) {
        throw new Error(`mp-weixin framework runtime changed: expected ${expectedVendorHash}, got ${actualVendorHash}. Review trial-runtime compatibility before updating the baseline.`)
      }
    }
  } else if (expectedVendorHash) {
    throw new Error(`Missing mp-weixin framework runtime chunk: ${vendorPath}`)
  }
  const nodeModulesPath = path.join(distRoot, 'node-modules')
  const expectedNodeModulesHash = Object.prototype.hasOwnProperty.call(options, 'expectedNodeModulesHash')
    ? options.expectedNodeModulesHash
    : [KNOWN_NODE_MODULES_SHA256, KNOWN_NODE_MODULES_SHA256_ALTERNATE]
  const reviewedNodeModulesHashes = (Array.isArray(expectedNodeModulesHash)
    ? expectedNodeModulesHash
    : [expectedNodeModulesHash])
    .filter(Boolean)
    .map(String)
  if (reviewedNodeModulesHashes.length > 0 && fs.existsSync(nodeModulesPath)) {
    const actualNodeModulesHash = hashNodeModulesDirectory(nodeModulesPath)
    if (!reviewedNodeModulesHashes.includes(actualNodeModulesHash)) {
      throw new Error(`mp-weixin third-party runtime changed: expected one of ${reviewedNodeModulesHashes.join(', ')}, got ${actualNodeModulesHash}. Review trial-runtime compatibility before updating the baseline.`)
    }
  }
  const detailJson = JSON.parse(fs.readFileSync(detailConfig, 'utf8'))
  if (detailJson.usingComponents?.['widget-editor']) {
    findings.push({
      file: 'pages/detail/index.json',
      rule: 'read-only detail must not statically load WidgetEditor',
      offset: 0,
      snippet: JSON.stringify(detailJson.usingComponents),
    })
  }

  const dependencyChunks = collectCriticalDependencyChunks(distRoot, application.entrypoints)
  for (const chunkPath of dependencyChunks) {
    const relativePath = path.relative(distRoot, chunkPath).replaceAll(path.sep, '/')
    if (relativePath.startsWith('node-modules/')) continue
    const source = fs.readFileSync(chunkPath, 'utf8')
    findings.push(...scanChunk(relativePath, source, parseChunk(source, chunkPath)))
  }

  return { dependencyChunks, findings }
}
