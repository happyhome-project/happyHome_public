import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  classifyPublicDocument,
  findHistoricalHeaderProblems,
  findRelativeMarkdownLinks,
  requiresExplicitHistoricalHeader,
  requiredPublicDocumentPaths,
} from './docs-policy.mjs'
import { CLOUD_RELEASE_COMPONENTS } from './release-component-registry.mjs'
import { RAG_RELEASE_FUNCTIONS } from './release-plan.mjs'
import { REQUIRED_RELEASE_UI_MARKERS } from './mp-release-ui-policy.mjs'

test('public documentation requirements use only tracked repository entry points', () => {
  assert.deepEqual(requiredPublicDocumentPaths(), [
    'README.md',
    'AGENTS.md',
    'CLAUDE.md',
    'PRODUCT.md',
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

test('documentation checker follows rendered Markdown links and ignores non-rendered code or HTML', () => {
  const inspected = []
  const missing = findRelativeMarkdownLinks({
    sourcePath: 'docs/guide.md',
    source: [
      '[reference link][reference]',
      '[angle destination](<angle guide.md>)',
      '[query and fragment](query.md?mode=full#details)',
      '[balanced parentheses](folder/(draft).md)',
      '',
      '[reference]: <reference.md?mode=full#details>',
      '',
      '`[inline code](inline-code.md)`',
      '<!-- [commented](commented.md) -->',
      '<div>',
      '[html block](html-block.md)',
      '</div>',
      '',
      '```md',
      '[fenced](fenced.md)',
      '```',
      '',
      '    [indented code](indented.md)',
    ].join('\n'),
    exists: (path) => {
      inspected.push(path)
      return false
    },
  })

  assert.deepEqual(missing, [
    'docs/reference.md',
    'docs/angle guide.md',
    'docs/query.md',
    'docs/folder/(draft).md',
  ])
  assert.deepEqual(inspected, missing)
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
  assert.deepEqual(classifyPublicDocument({ path: 'PRODUCT.md', source: '# Product' }), {
    category: 'current',
    authority: 'canonical',
  })
  assert.deepEqual(classifyPublicDocument({ path: 'docs/ui-click-regression-checklist.md', source: '# Checklist' }), {
    category: 'reference',
    authority: 'supporting',
  })
  assert.deepEqual(classifyPublicDocument({ path: 'docs/releases/example.md', source: '# Release' }), {
    category: 'historical',
    authority: 'record',
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

test('documentation classification ignores historical language inside non-rendered Markdown contexts', () => {
  for (const hiddenBody of [
    '> <!-- This document is historical. -->',
    '> `This document is historical.`',
    ['> <div>', '> This document is historical.', '> </div>'].join('\n'),
    ['> ```text', '> This document is historical.', '> ```'].join('\n'),
    '>     This document is historical.',
  ]) {
    assert.deepEqual(classifyPublicDocument({
      path: 'docs/guide.md',
      source: `# Guide\n\n${hiddenBody}`,
    }), {
      category: 'reference',
      authority: 'supporting',
    }, hiddenBody)
  }
})

test('every document classified as historical requires an explicit governed header', () => {
  for (const document of [
    { path: 'docs/DESIGN-TOKENS.md', source: '# Design Tokens - 已过时' },
    { path: 'docs/changes/example.md', source: '# Change record' },
    { path: 'docs/releases/example.md', source: '# Release record' },
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

test('historical headers ignore status and authority labels inside non-rendered Markdown contexts', () => {
  const path = 'docs/superpowers/specs/example.md'
  const catalog = [
    { path: 'docs/README.md', category: 'current', authority: 'entrypoint' },
    { path, category: 'historical', authority: 'record' },
  ]

  assert.deepEqual(findHistoricalHeaderProblems({
    path,
    source: [
      '# Delivery',
      '',
      '> `Historical / point-in-time: retained for traceability.`',
      '> **Current authority:** [Documentation authority](../../README.md).',
    ].join('\n'),
    catalog,
  }), ['missing explicit historical or point-in-time status in the header'])

  for (const hiddenAuthority of [
    '> <!-- **Current authority:** [Documentation authority](../../README.md). -->',
    '> `**Current authority:** [Documentation authority](../../README.md).`',
    ['> <div>', '> **Current authority:** [Documentation authority](../../README.md).', '> </div>'].join('\n'),
    ['> ```md', '> **Current authority:** [Documentation authority](../../README.md).', '> ```'].join('\n'),
    ['>', '>     **Current authority:** [Documentation authority](../../README.md).'].join('\n'),
  ]) {
    assert.deepEqual(findHistoricalHeaderProblems({
      path,
      source: [
        '# Delivery',
        '',
        '> **Historical / point-in-time:** retained for traceability.',
        hiddenAuthority,
      ].join('\n'),
      catalog,
    }), ['missing labeled current-authority Markdown link in the header'], hiddenAuthority)
  }
})

test('historical current-authority links resolve to a different current or canonical operational document', () => {
  const path = 'docs/superpowers/plans/example.md'
  const catalog = [
    { path: 'README.md', category: 'current', authority: 'entrypoint' },
    { path: 'docs/Current Guide.md', category: 'current', authority: 'canonical' },
    { path: 'docs/Current(Guide).md', category: 'current', authority: 'canonical' },
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
    source: [
      '# Delivery',
      '',
      '> **Historical / point-in-time:** retained for traceability; do not execute directly.',
      '> **Current authority:** [Maintained guidance][authority].',
      '',
      '[authority]: <../../../README.md?view=full#authority>',
    ].join('\n'),
    catalog,
  }), [])

  for (const target of ['<../../Current Guide.md?view=full#authority>', '../../Current(Guide).md?view=full#authority']) {
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

test('directive policy ignores non-rendered directives and recognizes visible agent variants', () => {
  const path = 'docs/superpowers/plans/example.md'
  const catalog = [
    { path: 'docs/README.md', category: 'current', authority: 'entrypoint' },
    { path, category: 'historical', authority: 'record' },
  ]
  const header = [
    '# Delivery',
    '',
    '> **Historical / point-in-time:** retained for traceability; do not execute directly.',
    '> **Current authority:** [Documentation authority](../../README.md).',
    '',
  ]

  for (const hiddenDirective of [
    '<!-- For agentic workers: execute this plan. -->',
    ['<!--', 'For autonomous agents: Use superpowers:executing-plans and execute this plan.', '-->'].join('\n'),
    '`For agentic workers: execute this plan.`',
    ['```md', 'For agentic workers: execute this plan.', '```'].join('\n'),
    '    For agentic workers: execute this plan.',
    '<div data-instruction="For agentic workers: execute this plan.">Visible note only.</div>',
    '<script>For agentic workers: execute this plan.</script>',
    '<style>For agentic workers: execute this plan.</style>',
  ]) {
    assert.deepEqual(findHistoricalHeaderProblems({
      path,
      source: [...header, hiddenDirective].join('\n'),
      catalog,
    }), [], hiddenDirective)
  }

  for (const directive of [
    'For agentic workers: execute this plan.',
    'For autonomous agents: execute this plan.',
    'For agents: execute this plan.',
    'REQUIRED SUB-SKILL: use the delivery workflow.',
    'Use superpowers:executing-plans to execute this delivery.',
    '<div>For autonomous agents: Use superpowers:executing-plans and execute every task now.</div>',
  ]) {
    assert.deepEqual(findHistoricalHeaderProblems({
      path,
      source: [...header, directive].join('\n'),
      catalog,
    }), ['agent execution directive is outside the original historical instructions section'], directive)
  }

  const visibleHtmlDirective = '<div><strong>For autonomous agents:</strong> Use superpowers:executing-plans and execute this plan.</div>'
  assert.deepEqual(findHistoricalHeaderProblems({
    path,
    source: [...header, '## Original historical instructions (do not execute)', visibleHtmlDirective].join('\n'),
    catalog,
  }), [])
  assert.deepEqual(findHistoricalHeaderProblems({
    path,
    source: [
      ...header,
      '## Original historical instructions (do not execute)',
      '## Later status',
      visibleHtmlDirective,
    ].join('\n'),
    catalog,
  }), ['agent execution directive is outside the original historical instructions section'])
  assert.deepEqual(findHistoricalHeaderProblems({
    path,
    source: [...header, `<div><h2>Original historical instructions (do not execute)</h2>${visibleHtmlDirective}</div>`].join('\n'),
    catalog,
  }), ['agent execution directive is outside the original historical instructions section'])
})

test('historical instruction section follows rendered top-level heading boundaries and opens only once', () => {
  const path = 'docs/superpowers/plans/example.md'
  const catalog = [
    { path: 'docs/README.md', category: 'current', authority: 'entrypoint' },
    { path, category: 'historical', authority: 'record' },
  ]
  const header = [
    '# Delivery',
    '',
    '> **Historical / point-in-time:** retained for traceability; do not execute directly.',
    '> **Current authority:** [Documentation authority](../../README.md).',
    '',
  ]
  const directive = 'For agentic workers: execute this plan.'

  for (const sectionHeading of [
    '   ## Original historical instructions (do not execute)',
    ['Original historical instructions (do not execute)', '---'].join('\n'),
  ]) {
    assert.deepEqual(findHistoricalHeaderProblems({
      path,
      source: [...header, sectionHeading, '', directive, '', '### Nested task', '', directive].join('\n'),
      catalog,
    }), [], sectionHeading)
  }

  for (const body of [
    ['## Original historical instructions (do not execute)', directive, '# Later status', directive],
    ['## Original historical instructions (do not execute)', directive, '## Later status', '## Original historical instructions (do not execute)', directive],
    ['```md', '## Original historical instructions (do not execute)', '```', directive],
    ['<!--', '## Original historical instructions (do not execute)', '-->', directive],
    ['> ## Original historical instructions (do not execute)', '>', `> ${directive}`],
  ]) {
    assert.deepEqual(findHistoricalHeaderProblems({
      path,
      source: [...header, ...body].join('\n'),
      catalog,
    }), ['agent execution directive is outside the original historical instructions section'], body.join('\n'))
  }
})

test('documentation map places machine-classified authorities in their matching sections', () => {
  const repositoryRoot = new URL('../../', import.meta.url)
  const documentSource = readFileSync(new URL('../../docs/adversarial-testing-prep.md', import.meta.url), 'utf8')
  const mapSource = readFileSync(new URL('../../docs/README.md', import.meta.url), 'utf8')
  const documentPath = 'docs/adversarial-testing-prep.md'
  const mapLink = '[Adversarial testing preparation](adversarial-testing-prep.md)'
  const trackedMarkdown = execFileSync('git', ['ls-files', '*.md'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    windowsHide: true,
  }).split(/\r?\n/).filter(Boolean)
  const catalog = trackedMarkdown.map((path) => ({
    path: path.replace(/\\/g, '/'),
    ...classifyPublicDocument({ path, source: readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8') }),
  }))
  const sectionPaths = (heading) => {
    const sectionStart = mapSource.indexOf(`## ${heading}`)
    assert.notEqual(sectionStart, -1, heading)
    const sectionBody = mapSource.slice(sectionStart + heading.length + 3).split(/^## /m, 1)[0]
    return new Set([...sectionBody.matchAll(/\[[^\]]+\]\(([^)\s]+\.md)(?:#[^)]*)?\)/g)].map((match) => {
      const target = match[1].replace(/\\/g, '/')
      return target.startsWith('../') ? target.slice(3) : `docs/${target}`
    }))
  }

  assert.equal(classifyPublicDocument({ path: documentPath, source: documentSource }).category, 'historical')
  assert.ok(mapSource.indexOf(mapLink) > mapSource.indexOf('## Historical and delivery records'))

  const currentPaths = sectionPaths('Current authorities')
  const operationalPaths = sectionPaths('Operational guides')
  const missingCurrent = catalog
    .filter(({ path, category }) => category === 'current' && path !== 'docs/README.md')
    .map(({ path }) => path)
    .filter((path) => !currentPaths.has(path))
  const missingOperational = catalog
    .filter(({ category, authority }) => category === 'operational' && authority === 'canonical')
    .map(({ path }) => path)
    .filter((path) => !operationalPaths.has(path))

  assert.deepEqual(missingCurrent, [])
  assert.deepEqual(missingOperational, [])
})

test('credential documentation warns that set:superadmin still has a legacy non-fail-closed fallback', () => {
  const implementations = [
    ['set:superadmin', readFileSync(new URL('../../scripts/set-super-admin.mjs', import.meta.url), 'utf8')],
  ]
  const setup = readFileSync(new URL('../../docs/SETUP.md', import.meta.url), 'utf8')
  const fallbackValues = implementations.map(([name, implementation]) => {
    const fallback = implementation.match(/process\.env\.ADMIN_TOKEN\s*\|\|\s*(['"])([^'"]+)\1/)
    assert.ok(fallback, `${name} still exposes a legacy ADMIN_TOKEN fallback`)
    return fallback[2]
  })
  const setupWarning = setup.split(/\r?\n\r?\n/).find((paragraph) => /legacy fallback/i.test(paragraph)) || ''

  assert.match(setupWarning, /set:superadmin/i)
  for (const [path, source] of [['docs/SETUP.md', setup]]) {
    assert.match(source, /legacy fallback/i, path)
    assert.match(source, /(?:不会|does not) fail closed/i, path)
    assert.match(source, /(?:必须显式提供|must explicitly provide) `?ADMIN_TOKEN`?/i, path)
    assert.match(source, /(?:不应依赖|must not rely on) (?:the )?fallback/i, path)
    for (const fallbackValue of fallbackValues) {
      assert.equal(source.includes(fallbackValue), false, `${path} must not repeat a fallback value`)
    }
  }
})

test('release documentation derives its default scope and UI evidence from governed policy', () => {
  const releaseGate = readFileSync(new URL('../../docs/release-gate.md', import.meta.url), 'utf8')
  const defaultCloudCount = CLOUD_RELEASE_COMPONENTS.length - RAG_RELEASE_FUNCTIONS.size

  assert.match(releaseGate, new RegExp(`all ${defaultCloudCount} planned cloud functions`, 'i'))
  assert.match(releaseGate, new RegExp(`expands the cloud set to ${CLOUD_RELEASE_COMPONENTS.length}`, 'i'))
  assert.match(releaseGate, /RAG specialist verification is delegated in both default and include-RAG releases/)
  assert.match(releaseGate, /common `ensure:indexes` prerequisite in every release/)
  assert.match(releaseGate, /--include-rag/)
  for (const { marker } of REQUIRED_RELEASE_UI_MARKERS) assert.match(releaseGate, new RegExp(marker))
  assert.match(releaseGate, new RegExp(`all ${REQUIRED_RELEASE_UI_MARKERS.length} release UI labels`, 'i'))
  assert.doesNotMatch(releaseGate, /all five release UI labels|every one of the twelve cloud functions/i)
  assert.doesNotMatch(releaseGate, /include-RAG[\s\S]{0,240}(?:timer|backfill|semantic)[\s\S]{0,120}release-blocking/i)
})

test('current admin documentation keeps fixed credentials out of the browser bundle', () => {
  const setup = readFileSync(new URL('../../docs/SETUP.md', import.meta.url), 'utf8')
  const deploy = readFileSync(new URL('../../docs/admin-web-deploy.md', import.meta.url), 'utf8')

  for (const source of [setup, deploy]) {
    assert.match(source, /auth\.login/)
    assert.doesNotMatch(source, /VITE_ADMIN_USERNAME|VITE_ADMIN_PASSWORD|VITE_ADMIN_TOKEN/)
  }
})

test('nightly authentication separates admin sessions from the HTTP gateway capability', () => {
  const helper = readFileSync(new URL('../../scripts/lib/test-api.mjs', import.meta.url), 'utf8')
  const orchestration = readFileSync(new URL('../../scripts/nightly-full.mjs', import.meta.url), 'utf8')
  const nightlyPolicy = readFileSync(new URL('../../scripts/lib/nightly-notification-policy.mjs', import.meta.url), 'utf8')
  const workflow = readFileSync(new URL('../../.github/workflows/nightly-full.yml', import.meta.url), 'utf8')
  const browser = readFileSync(new URL('../../admin-web/tests/nightly-admin.spec.mjs', import.meta.url), 'utf8')
  const h5Readme = readFileSync(new URL('../../scripts/h5-test/README.md', import.meta.url), 'utf8')
  const packageJson = readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
  const packageManifest = JSON.parse(packageJson)

  assert.match(helper, /auth\.login/)
  assert.match(helper, /GATEWAY_TOKEN/)
  assert.doesNotMatch(helper, /process\.env\.ADMIN_TOKEN|happyhome-admin-2024/)
  assert.doesNotMatch(helper, /TEST_ADMIN_SESSION_TOKEN/)
  assert.match(nightlyPolicy, /'GATEWAY_TOKEN'/)
  assert.doesNotMatch(orchestration, /'ADMIN_TOKEN'|'VITE_ADMIN_TOKEN'/)
  assert.doesNotMatch(orchestration, /requiredEnvVars[\s\S]*WECOM_WEBHOOK_URL/)
  assert.match(orchestration, /createNotificationPlan\(\{ webhook: process\.env\.WECOM_WEBHOOK_URL \}\)/)
  assert.match(orchestration, /finalizeNightlyRun\(\{ summary, notificationStage: notifyStage \}\)/)
  assert.doesNotMatch(orchestration, /summary\.status\s*=\s*'failed'/)
  assert.match(workflow, /GATEWAY_TOKEN:\s*\$\{\{ secrets\.GATEWAY_TOKEN \}\}/)
  assert.match(workflow, /TEST_ADMIN_USERNAME:\s*\$\{\{ secrets\.VITE_ADMIN_USERNAME \}\}/)
  assert.match(workflow, /TEST_ADMIN_PASSWORD:\s*\$\{\{ secrets\.VITE_ADMIN_PASSWORD \}\}/)
  assert.doesNotMatch(workflow, /^\s+(?:ADMIN_TOKEN|VITE_ADMIN_TOKEN):/m)
  assert.doesNotMatch(browser, /localStorage\.setItem\('token'|happyhome-admin-2024|process\.env\.ADMIN_TOKEN/)
  assert.match(browser, /VITE_ADMIN_USERNAME and VITE_ADMIN_PASSWORD are required/)
  assert.match(h5Readme, /GATEWAY_TOKEN/)
  assert.match(h5Readme, /auth\.login/)
  assert.match(packageJson, /test-api\.test\.mjs/)
  assert.match(packageManifest.scripts['test:governance'], /nightly-notification-policy\.test\.mjs/)
  assert.match(packageManifest.scripts['test:governance'], /notify-wecom\.test\.mjs/)
})

function levelThreeSection(source, heading) {
  const marker = `### ${heading}`
  const start = source.indexOf(marker)
  assert.notEqual(start, -1, `missing section: ${heading}`)
  const next = source.indexOf('\n### ', start + marker.length)
  return source.slice(start, next === -1 ? source.length : next)
}

test('agent guidance defines the feature PR feedback loop and Merge Queue handoff', () => {
  const agents = readFileSync(new URL('../../AGENTS.md', import.meta.url), 'utf8')
  const setup = readFileSync(new URL('../../docs/SETUP.md', import.meta.url), 'utf8')
  const featureSections = [
    ['AGENTS PR workflow', levelThreeSection(agents, 'PR 流程')],
    ['SETUP feature collaboration', levelThreeSection(setup, '功能 PR 与 Merge Queue 协作')],
  ]
  const queueSections = [
    ['AGENTS Merge Queue coordination', levelThreeSection(agents, 'Merge Queue 协调')],
    ['SETUP feature collaboration', levelThreeSection(setup, '功能 PR 与 Merge Queue 协作')],
  ]

  for (const [path, source] of featureSections) {
    assert.match(source, /PR 前[\s\S]*(?:工作区 )?clean[\s\S]*(?:不要求|无需)[^\n]*(?:追逐|fetch|merge)[^\n]*main/, path)
    assert.match(source, /不得[\s\S]*(?:stash|rebase)[\s\S]*(?:force-push|force push)[\s\S]*其他功能分支/, path)
    assert.match(source, /exact HEAD[\s\S]*checks[\s\S]*review[\s\S]*comments/, path)
    assert.match(source, /MERGED[\s\S]*CLOSED/, path)
    assert.match(source, /merge-ready[\s\S]*open[\s\S]*非 draft[\s\S]*必需[^\n]*CI[\s\S]*review[\s\S]*文本冲突/, path)
    assert.match(source, /PR 创建后[^\n]*(?:不要求|无需)[^\n]*持续[^\n]*(?:追逐|同步)[^\n]*main/, path)
  }
  for (const [path, source] of queueSections) {
    assert.match(source, /多个[^\n]*merge-ready[^\n]*Merge Queue/, path)
    assert.match(source, /gh pr merge <N> --auto --merge[\s\S]*MERGED[\s\S]*CLOSED/, path)
    assert.match(source, /^(?=[^\n]*public)(?=[^\n]*integrate:pr)(?=[^\n]*(?:禁用|不使用)).+$/im, path)
    assert.match(source, /不触发[^\n]*(?:release|deploy)[^\n]*(?:release|deploy)/i, path)
  }

  assert.doesNotMatch(agents, /合并一个 PR 后，下一个 PR 必须重新同步最新 `main`/)
})

test('feature feedback invalidates old results after a push and follows the new exact HEAD', () => {
  const agents = readFileSync(new URL('../../AGENTS.md', import.meta.url), 'utf8')
  const prWorkflow = levelThreeSection(agents, 'PR 流程')
  const setup = readFileSync(new URL('../../docs/SETUP.md', import.meta.url), 'utf8')
  const featureFeedback = levelThreeSection(setup, '功能 PR 与 Merge Queue 协作')

  assert.match(prWorkflow, /每次普通 push 后旧结果作废[^\n]*新的 exact HEAD/)
  assert.match(featureFeedback, /push 新提交后旧检查结果作废/)
  assert.match(featureFeedback, /轮询 PR exact HEAD 的 checks、review 和 comments/)
})

test('feature agent arms Merge Queue and retains terminal ownership', () => {
  const agents = readFileSync(new URL('../../AGENTS.md', import.meta.url), 'utf8')
  const prWorkflow = levelThreeSection(agents, 'PR 流程')
  const queueCoordination = levelThreeSection(agents, 'Merge Queue 协调')
  const setup = readFileSync(new URL('../../docs/SETUP.md', import.meta.url), 'utf8')
  const featureFeedback = levelThreeSection(setup, '功能 PR 与 Merge Queue 协作')

  for (const source of [prWorkflow, queueCoordination, featureFeedback]) assert.match(source, /功能 AI[\s\S]*gh pr merge <N> --auto --merge[\s\S]*(?:MERGED|terminal)[\s\S]*CLOSED/)
})

test('feature PR lifecycle uses GitHub exact HEAD without webhook or watchdog dependency', () => {
  const agents = readFileSync(new URL('../../AGENTS.md', import.meta.url), 'utf8')
  const prWorkflow = levelThreeSection(agents, 'PR 流程')
  const setup = readFileSync(new URL('../../docs/SETUP.md', import.meta.url), 'utf8')
  const featureFeedback = levelThreeSection(setup, '功能 PR 与 Merge Queue 协作')

  for (const source of [prWorkflow, featureFeedback]) {
    assert.match(source, /GitHub[^\n]*exact HEAD[^\n]*事实源/)
    assert.match(source, /不得等待[^\n]*(?:webhook|Webhook)/)
    assert.match(source, /不需要[^\n]*(?:watchdog|集中轮询)/)
    assert.match(source, /CI[^\n]*gh pr merge <N> --auto --merge/)
  }
})

test('feature agent fixes code failures and rearms unchanged transient queue failures', () => {
  const agents = readFileSync(new URL('../../AGENTS.md', import.meta.url), 'utf8')
  const queueCoordination = levelThreeSection(agents, 'Merge Queue 协调')
  const setup = readFileSync(new URL('../../docs/SETUP.md', import.meta.url), 'utf8')
  const featureFeedback = levelThreeSection(setup, '功能 PR 与 Merge Queue 协作')

  for (const source of [queueCoordination, featureFeedback]) {
    assert.match(source, /(?:冲突|代码失败)[^\n]*原[^\n]*worktree[^\n]*修复/i)
    assert.match(source, /(?:基础设施|Queue)[^\n]*失败[^\n]*exact HEAD 未变[^\n]*同一功能 AI[^\n]*重新 arm[^\n]*不制造提交/i)
    assert.match(source, /依赖 PR[^\n]*draft[^\n]*前置[^\n]*main/i)
  }
})
