import assert from 'node:assert/strict'
import test from 'node:test'

import {
  hasReleaseHomeNavigationEvidence,
  invokeCompiledComponentEvent,
  readReleasePageWxml,
  readReleasePageText,
  resolveCompiledComponentEventHandler,
  summarizeReleaseArchiveWxml,
} from './mp-release-ui-evidence.mjs'

function fakePage(elements = {}) {
  return {
    async $(selector) {
      const value = elements[selector]
      if (value === undefined || value === null) return null
      return {
        async text() {
          if (value instanceof Error) throw value
          return value
        },
        async wxml() {
          if (value instanceof Error) throw value
          return value
        },
      }
    },
  }
}

test('reads legacy page root text when the DevTools page selector is available', async () => {
  const text = await readReleasePageText(fakePage({
    page: 'legacy page text',
    '.phone-inner': 'fallback text',
  }))

  assert.equal(text, 'legacy page text')
})

test('reads flattened rendered WXML from the current DevTools root fallback', async () => {
  const wxml = await readReleasePageWxml(fakePage({
    page: null,
    '.phone-inner': '<view class="home-shell"><components/ArchiveWaterfall /></view>',
  }))

  assert.match(wxml, /ArchiveWaterfall/)
})

test('summarizes archive tabs and cards from flattened custom-component WXML', () => {
  const evidence = summarizeReleaseArchiveWxml(`
    <components/ArchiveTopicTabs>
      <view class="archive-topic-tab archive-topic-tab--active"><text>全部</text></view>
      <view class="archive-topic-tab"><text>短内容</text></view>
    </components/ArchiveTopicTabs>
    <components/ArchiveWaterfall>
      <view class="archive-waterfall__card"><text>帖子一</text></view>
      <view class="archive-waterfall__card"><text>帖子二</text></view>
      <view class="archive-waterfall__card"><text>帖子三</text></view>
    </components/ArchiveWaterfall>
  `)

  assert.deepEqual(evidence, {
    source: 'flattened-wxml',
    tabCount: 2,
    activeTabCount: 1,
    activeTabTexts: ['全部'],
    cardCount: 3,
  })
})

test('resolves the exact runtime event handler bound by the compiled package', () => {
  const compiledWxml = `
    <archive-topic-tabs bindupdateModelValue="{{I}}" />
    <archive-waterfall bindpost="{{K}}" />
  `
  const pageData = { I: 'e7', K: 'e8' }

  assert.equal(resolveCompiledComponentEventHandler({
    compiledWxml,
    pageData,
    componentTag: 'archive-topic-tabs',
    eventName: 'updateModelValue',
  }), 'e7')
  assert.equal(resolveCompiledComponentEventHandler({
    compiledWxml,
    pageData,
    componentTag: 'archive-waterfall',
    eventName: 'post',
  }), 'e8')
})

test('rejects missing or non-callable compiled event bindings', () => {
  assert.throws(() => resolveCompiledComponentEventHandler({
    compiledWxml: '<archive-waterfall bindpost="{{K}}" />',
    pageData: { K: 'not-an-event-handler' },
    componentTag: 'archive-waterfall',
    eventName: 'post',
  }), /runtime event handler/)
})

test('invokes the runtime handler bound by the exact compiled component event', async () => {
  let evaluated = null
  const mp = {
    async evaluate(_callback, handler, args) {
      evaluated = { handler, args }
      return 'invoked'
    },
  }
  const page = { async data() { return { K: 'e8' } } }

  const result = await invokeCompiledComponentEvent({
    mp,
    page,
    compiledWxml: '<archive-waterfall bindpost="{{K}}" />',
    componentTag: 'archive-waterfall',
    eventName: 'post',
    args: [{ postId: 'post-1' }],
  })

  assert.equal(result, 'invoked')
  assert.deepEqual(evaluated, { handler: 'e8', args: [{ postId: 'post-1' }] })
})

test('falls back to a rendered page root when current DevTools omits the page selector', async () => {
  const text = await readReleasePageText(fakePage({
    page: null,
    '.phone-inner': '首页内容首页+我的',
  }))

  assert.equal(text, '首页内容首页+我的')
})

test('continues past an unreadable candidate and uses a generic rendered view', async () => {
  const text = await readReleasePageText(fakePage({
    page: new Error('unsupported selector'),
    '.phone-inner': '',
    '.profile-page': null,
    view: '我的登录首页+我的',
  }))

  assert.equal(text, '我的登录首页+我的')
})

test('requires direct custom-tab labels when component selectors are isolated', () => {
  assert.equal(hasReleaseHomeNavigationEvidence({ navigationEvidencePassed: true }), true)
  assert.equal(hasReleaseHomeNavigationEvidence({ appTabBarCount: 1, text: '' }), true)
  assert.equal(hasReleaseHomeNavigationEvidence({ appTabBarCount: 0, text: '首页内容首页+我的' }), true)
  assert.equal(hasReleaseHomeNavigationEvidence({ appTabBarCount: 0, text: '首页+我的正文仍在继续' }), false)
  assert.equal(hasReleaseHomeNavigationEvidence({ appTabBarCount: 0, text: '只有首页' }), false)
  assert.equal(hasReleaseHomeNavigationEvidence({ appTabBarCount: 0, text: '只有我的' }), false)
})
