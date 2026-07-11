import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  classifyPublicDocument,
  findHistoricalHeaderProblems,
  findRelativeMarkdownLinks,
  requiresExplicitHistoricalHeader,
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

test('every document classified as historical requires an explicit governed header', () => {
  for (const document of [
    { path: 'docs/DESIGN-TOKENS.md', source: '# Design Tokens - 已过时' },
    { path: 'docs/changes/example.md', source: '# Change record' },
    { path: 'docs/superpowers/plans/example.md', source: '# Delivery plan' },
    { path: 'docs/superpowers/specs/example.md', source: '# Delivery spec' },
    { path: 'news/qingshan/2026-05-13_to_2026-05-19/README.md', source: '# Weekly news' },
    { path: 'prototype/design_handoff_happyhome/README.md', source: '# Prototype handoff' },
  ]) {
    assert.equal(classifyPublicDocument(document).category, 'historical', document.path)
    assert.equal(requiresExplicitHistoricalHeader(document), true, document.path)
    assert.deepEqual(findHistoricalHeaderProblems(document), [
      'missing explicit historical or point-in-time status in the header',
      'missing labeled current-authority Markdown link in the header',
    ], document.path)
  }

  assert.equal(requiresExplicitHistoricalHeader({ path: 'docs/TESTING.md', source: '# Testing' }), false)
})

test('historical delivery header links readers to current authority', () => {
  const source = [
    '# Delivery',
    '',
    '> **Historical / point-in-time:** retained for traceability; do not execute directly.',
    '> **Current authority:** [Documentation authority](../../README.md).',
  ].join('\n')

  assert.deepEqual(findHistoricalHeaderProblems({
    path: 'docs/superpowers/specs/2026-07-10-example.md',
    source,
    catalog: [
      { path: 'docs/README.md', category: 'current', authority: 'entrypoint' },
      { path: 'docs/superpowers/specs/2026-07-10-example.md', category: 'historical', authority: 'record' },
    ],
  }), [])
})

test('historical current-authority links resolve to a different current or canonical operational document', () => {
  const path = 'docs/superpowers/plans/example.md'
  const catalog = [
    { path: 'README.md', category: 'current', authority: 'entrypoint' },
    { path: 'docs/TESTING.md', category: 'operational', authority: 'canonical' },
    { path: 'docs/generated/report.md', category: 'generated', authority: 'non-authoritative' },
    { path: 'docs/superpowers/plans/example.md', category: 'historical', authority: 'record' },
    { path: 'docs/superpowers/specs/example.md', category: 'historical', authority: 'record' },
  ]
  const sourceFor = (target) => [
    '# Delivery',
    '',
    '> **Historical / point-in-time:** retained for traceability; do not execute directly.',
    `> **Current authority:** [Maintained guidance](${target}).`,
  ].join('\n')

  for (const target of ['../../../README.md', '../../TESTING.md']) {
    assert.deepEqual(findHistoricalHeaderProblems({ path, source: sourceFor(target), catalog }), [], target)
  }

  assert.deepEqual(findHistoricalHeaderProblems({
    path,
    source: `${sourceFor('../../../README.md')} Current implementation: [tokens](../../../miniprogram/src/uni.scss).`,
    catalog,
  }), [])

  assert.deepEqual(findHistoricalHeaderProblems({
    path,
    source: sourceFor('./example.md'),
    catalog,
  }), ['current-authority link must not point to the historical document itself'])

  for (const target of ['../specs/example.md', '../../generated/report.md']) {
    assert.deepEqual(findHistoricalHeaderProblems({
      path,
      source: sourceFor(target),
      catalog,
    }), ['current-authority link must point to current or canonical operational documentation'], target)
  }

  for (const target of ['../../missing.md', 'https://example.com/README.md']) {
    assert.deepEqual(findHistoricalHeaderProblems({
      path,
      source: sourceFor(target),
      catalog,
    }), ['current-authority link must resolve to a cataloged repository document'], target)
  }
})

test('historical plans cannot expose an unmarked agent execution directive', () => {
  const header = [
    '# Delivery',
    '',
    '> **Historical / point-in-time:** retained for traceability; do not execute directly.',
    '> **Current authority:** [Documentation authority](../../README.md).',
    '',
  ]
  const directive = '> **For agentic workers:** REQUIRED SUB-SKILL: execute this plan task-by-task.'
  const catalog = [
    { path: 'docs/README.md', category: 'current', authority: 'entrypoint' },
    { path: 'docs/superpowers/plans/example.md', category: 'historical', authority: 'record' },
  ]

  assert.deepEqual(findHistoricalHeaderProblems({
    path: 'docs/superpowers/plans/example.md',
    source: [...header, directive].join('\n'),
    catalog,
  }), ['agent execution directive is outside the original historical instructions section'])

  assert.deepEqual(findHistoricalHeaderProblems({
    path: 'docs/superpowers/plans/example.md',
    source: [...header, '## Original historical instructions (do not execute)', '', directive].join('\n'),
    catalog,
  }), [])
})

test('every agent execution directive stays inside the original historical instructions H2 section', () => {
  const header = [
    '# Delivery',
    '',
    '> **Historical / point-in-time:** retained for traceability; do not execute directly.',
    '> **Current authority:** [Documentation authority](../../README.md).',
    '',
  ]
  const workerDirective = '> **For agentic workers:** execute this plan task-by-task.'
  const subSkillDirective = '> REQUIRED SUB-SKILL: use the historical implementation workflow.'
  const catalog = [
    { path: 'docs/README.md', category: 'current', authority: 'entrypoint' },
    { path: 'docs/superpowers/plans/example.md', category: 'historical', authority: 'record' },
  ]

  assert.deepEqual(findHistoricalHeaderProblems({
    path: 'docs/superpowers/plans/example.md',
    source: [
      ...header,
      '## Original historical instructions (do not execute)',
      '',
      workerDirective,
      '',
      '### Nested task',
      '',
      subSkillDirective,
    ].join('\n'),
    catalog,
  }), [])

  assert.deepEqual(findHistoricalHeaderProblems({
    path: 'docs/superpowers/plans/example.md',
    source: [
      ...header,
      '## Original historical instructions (do not execute)',
      '',
      workerDirective,
      '',
      '## Later status',
      '',
      subSkillDirective,
    ].join('\n'),
    catalog,
  }), ['agent execution directive is outside the original historical instructions section'])

  assert.deepEqual(findHistoricalHeaderProblems({
    path: 'docs/superpowers/plans/example.md',
    source: [
      ...header,
      subSkillDirective,
      '',
      '## Original historical instructions (do not execute)',
      '',
      workerDirective,
    ].join('\n'),
    catalog,
  }), ['agent execution directive is outside the original historical instructions section'])
})

test('documentation map places machine-classified historical files in the historical section', () => {
  const documentSource = readFileSync(new URL('../../docs/adversarial-testing-prep.md', import.meta.url), 'utf8')
  const mapSource = readFileSync(new URL('../../docs/README.md', import.meta.url), 'utf8')
  const documentPath = 'docs/adversarial-testing-prep.md'
  const mapLink = '[Adversarial testing preparation](adversarial-testing-prep.md)'

  assert.equal(classifyPublicDocument({ path: documentPath, source: documentSource }).category, 'historical')
  assert.ok(mapSource.indexOf(mapLink) > mapSource.indexOf('## Historical and delivery records'))
})
