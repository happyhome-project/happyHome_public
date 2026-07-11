import assert from 'node:assert/strict'
import test from 'node:test'

import {
  classifyPublicDocument,
  findRelativeMarkdownLinks,
  requiredPublicDocumentPaths,
} from './docs-policy.mjs'

test('public documentation requirements use only tracked repository entry points', () => {
  assert.deepEqual(requiredPublicDocumentPaths(), [
    'README.md',
    'AGENTS.md',
    'CLAUDE.md',
    'TASKS.md',
    'docs/README.md',
  ])
})

test('documentation checker ignores web anchors and identifies only missing relative Markdown targets', () => {
  const missing = findRelativeMarkdownLinks({
    sourcePath: 'docs/guide.md',
    source: '[good](../README.md) [bad](missing.md) [web](https://example.com) [anchor](#top)',
    exists: (path) => path === 'README.md',
  })

  assert.deepEqual(missing, ['docs/missing.md'])
})

test('documentation checker rejects links that escape the repository root', () => {
  const inspected = []
  const missing = findRelativeMarkdownLinks({
    sourcePath: 'README.md',
    source: '[outside](../outside.md)',
    exists: (path) => {
      inspected.push(path)
      return true
    },
  })

  assert.deepEqual(missing, ['../outside.md'])
  assert.deepEqual(inspected, [])
})

test('documentation catalog separates authority, operations, references, records, and generated output', () => {
  assert.deepEqual(classifyPublicDocument({ path: 'README.md', source: '# HappyHome' }), {
    category: 'current',
    authority: 'entrypoint',
  })
  assert.deepEqual(classifyPublicDocument({ path: 'docs/release-gate.md', source: '# Release Gate' }), {
    category: 'operational',
    authority: 'canonical',
  })
  assert.deepEqual(classifyPublicDocument({ path: 'docs/ui-click-regression-checklist.md', source: '# Checklist' }), {
    category: 'reference',
    authority: 'supporting',
  })
  assert.deepEqual(classifyPublicDocument({ path: 'docs/figma-mini-0626-inventory.md', source: '# Inventory' }), {
    category: 'reference',
    authority: 'supporting',
  })
  assert.deepEqual(classifyPublicDocument({ path: 'docs/superpowers/specs/example.md', source: '# Design' }), {
    category: 'historical',
    authority: 'record',
  })
  assert.deepEqual(classifyPublicDocument({ path: 'docs/generated/report.md', source: '# Report' }), {
    category: 'generated',
    authority: 'non-authoritative',
  })
})

test('documentation catalog never presents an explicitly deprecated document as current', () => {
  assert.deepEqual(classifyPublicDocument({
    path: 'docs/DESIGN-TOKENS.md',
    source: '# Design Tokens - 已过时\n\n本文档已废弃。',
  }), {
    category: 'historical',
    authority: 'record',
  })
})

test('documentation catalog does not downgrade current authority for links to historical material', () => {
  assert.deepEqual(classifyPublicDocument({
    path: 'docs/README.md',
    source: '# Documentation catalog\n\nHistorical records are non-authoritative.',
  }), {
    category: 'current',
    authority: 'entrypoint',
  })
  assert.deepEqual(classifyPublicDocument({
    path: 'docs/UX-PRINCIPLES.md',
    source: '# Interaction principles\n\n> Retired visual docs are historical references.',
  }), {
    category: 'current',
    authority: 'canonical',
  })
})
