#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import process from 'node:process'

import {
  classifyPublicDocument,
  findRelativeMarkdownLinks,
  requiredPublicDocumentPaths,
} from './lib/docs-policy.mjs'

function git(args) {
  const result = spawnSync('git', args, { encoding: 'utf8', windowsHide: true })
  if (result.error || result.status !== 0) throw new Error(`git ${args.join(' ')} failed`)
  return String(result.stdout || '').trim()
}

function workspaceMarkdown(root) {
  const tracked = git(['ls-files', '*.md']).split(/\r?\n/).filter(Boolean)
  const untracked = git(['ls-files', '--others', '--exclude-standard', '*.md']).split(/\r?\n/).filter(Boolean)
  return [...new Set([...tracked, ...untracked])].map((path) => path.replace(/\\/g, '/'))
}

function title(source) {
  return String(source).match(/^#\s+(.+)$/m)?.[1].trim() || '(untitled)'
}

function catalog(root, files) {
  return files.sort().map((path) => {
    const source = readFileSync(join(root, path), 'utf8')
    return { path, title: title(source), ...classifyPublicDocument({ path, source }) }
  })
}

function check(root, files) {
  const required = requiredPublicDocumentPaths()
  const missing = required.filter((path) => !existsSync(join(root, path)))
  const broken = []
  for (const path of files) {
    const source = readFileSync(join(root, path), 'utf8')
    for (const target of findRelativeMarkdownLinks({ sourcePath: path, source, exists: (candidate) => existsSync(join(root, candidate)) })) {
      broken.push({ path, target })
    }
  }
  return { missing, broken }
}

try {
  const mode = process.argv[2]
  const root = git(['rev-parse', '--show-toplevel'])
  const files = workspaceMarkdown(root)
  if (mode === 'catalog') {
    process.stdout.write(`${JSON.stringify({ documents: catalog(root, files) }, null, 2)}\n`)
  } else if (mode === 'check') {
    const result = check(root, files)
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    if (result.missing.length || result.broken.length) process.exitCode = 1
  } else {
    throw new Error('Usage: docs.mjs <check|catalog>')
  }
} catch (error) {
  console.error(`[docs] ${error?.message || error}`)
  process.exitCode = 1
}
