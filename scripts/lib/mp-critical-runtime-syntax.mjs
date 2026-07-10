import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { parse } from 'acorn'

export const KNOWN_FRAMEWORK_VENDOR_SHA256 = 'b573e2806c3946c5ffca160c372b3322cf167636a2a3841f0f77c57b616ba60a'

const CRITICAL_ENTRYPOINTS = [
  'app.js',
  'pages/index/index.js',
  'pages/detail/index.js',
  'pages/profile/index.js',
]

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

function resolveLocalChunk(distRoot, importerPath, request) {
  const value = String(request || '')
  let candidate = ''
  if (value.startsWith('.')) candidate = path.resolve(path.dirname(importerPath), value)
  else if (value.startsWith('/')) candidate = path.resolve(distRoot, value.slice(1))
  else return ''

  const chunkPath = path.extname(candidate) ? candidate : `${candidate}.js`
  const relativePath = path.relative(distRoot, chunkPath)
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) return ''
  return chunkPath
}

function parseChunk(source, chunkPath) {
  try {
    return parse(source, { ecmaVersion: 'latest', sourceType: 'script' })
  } catch (error) {
    throw new Error(`Cannot parse mp-weixin critical dependency chunk ${chunkPath}: ${error.message}`)
  }
}

function readComponentDependencies(distRoot, chunkPath) {
  const configPath = chunkPath.replace(/\.js$/i, '.json')
  if (!fs.existsSync(configPath)) return []
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  return Object.values(config.usingComponents || {})
    .map((request) => resolveLocalChunk(distRoot, configPath, request))
    .filter(Boolean)
}

function collectCriticalDependencyChunks(distRoot) {
  const pending = CRITICAL_ENTRYPOINTS.map((relativePath) => path.join(distRoot, relativePath))
  const visited = new Set()

  while (pending.length > 0) {
    const chunkPath = pending.pop()
    if (!chunkPath || visited.has(chunkPath) || isFrameworkRuntimeChunk(distRoot, chunkPath)) continue
    if (!fs.existsSync(chunkPath)) {
      throw new Error(`Missing mp-weixin critical dependency chunk: ${chunkPath}`)
    }

    visited.add(chunkPath)
    const source = fs.readFileSync(chunkPath, 'utf8')
    const ast = parseChunk(source, chunkPath)
    walk(ast, (node) => {
      if (node.type !== 'CallExpression' || node.callee?.type !== 'Identifier' || node.callee.name !== 'require') return
      const request = node.arguments?.[0]
      if (request?.type !== 'Literal' || typeof request.value !== 'string') return
      const dependency = resolveLocalChunk(distRoot, chunkPath, request.value)
      if (dependency) pending.push(dependency)
    })
    pending.push(...readComponentDependencies(distRoot, chunkPath))
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

function scanChunk(relativePath, source, ast) {
  const findings = []
  walk(ast, (node, parent) => {
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
  const detailConfig = path.join(distRoot, 'pages', 'detail', 'index.json')
  if (!fs.existsSync(detailConfig)) {
    throw new Error(`Missing mp-weixin detail page config: ${detailConfig}`)
  }

  const findings = []
  const vendorPath = path.join(distRoot, 'common', 'vendor.js')
  const expectedVendorHash = Object.prototype.hasOwnProperty.call(options, 'expectedVendorHash')
    ? options.expectedVendorHash
    : KNOWN_FRAMEWORK_VENDOR_SHA256
  if (expectedVendorHash) {
    if (!fs.existsSync(vendorPath)) throw new Error(`Missing mp-weixin framework runtime chunk: ${vendorPath}`)
    const actualVendorHash = createHash('sha256').update(fs.readFileSync(vendorPath)).digest('hex')
    if (actualVendorHash !== expectedVendorHash) {
      throw new Error(`mp-weixin framework runtime changed: expected ${expectedVendorHash}, got ${actualVendorHash}. Review trial-runtime compatibility before updating the baseline.`)
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

  const dependencyChunks = collectCriticalDependencyChunks(distRoot)
  for (const chunkPath of dependencyChunks) {
    const relativePath = path.relative(distRoot, chunkPath).replaceAll(path.sep, '/')
    const source = fs.readFileSync(chunkPath, 'utf8')
    findings.push(...scanChunk(relativePath, source, parseChunk(source, chunkPath)))
  }

  return { dependencyChunks, findings }
}
