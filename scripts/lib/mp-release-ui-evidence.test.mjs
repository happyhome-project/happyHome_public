import assert from 'node:assert/strict'
import test from 'node:test'

import {
  hasReleaseHomeNavigationEvidence,
  readReleasePageText,
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
