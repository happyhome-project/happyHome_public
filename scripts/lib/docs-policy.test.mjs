import assert from 'node:assert/strict'
import test from 'node:test'

import { findRelativeMarkdownLinks, requiredPublicDocumentPaths } from './docs-policy.mjs'

test('public documentation requirements use only tracked repository entry points', () => {
  assert.deepEqual(requiredPublicDocumentPaths(), [
    'README.md',
    'AGENTS.md',
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
