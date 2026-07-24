import test from 'node:test'
import assert from 'node:assert/strict'

import {
  CARD_SIZE,
  CURRENT_LAYOUT,
  TEMPLATE_CONFIGS,
  estimateFullCjkCount,
  takeByVisualUnits,
  visualWeight,
} from './capacity.mjs'

test('models the six production text-note templates in their product order', () => {
  assert.deepEqual(
    TEMPLATE_CONFIGS.map(({ id, label }) => [id, label]),
    [
      ['paper', '社区便签'],
      ['mint', '邻里日常'],
      ['slate', '今日记录'],
      ['headline', '社区小报'],
      ['quote', '一句话'],
      ['notice', '通知公告'],
    ],
  )
})

test('keeps the current production pagination baseline visible for comparison', () => {
  assert.equal(CURRENT_LAYOUT.unitsPerLine, 17)
  assert.equal(CURRENT_LAYOUT.maxLines, 15)
  assert.equal(CURRENT_LAYOUT.capacity, 255)
})

test('calculates a full-Chinese reference capacity from each real safe rectangle', () => {
  assert.deepEqual(
    TEMPLATE_CONFIGS.map((template) => estimateFullCjkCount(template)),
    [304, 304, 288, 270, 270, 288],
  )

  for (const template of TEMPLATE_CONFIGS) {
    const { x, y, width, height } = template.safeRect
    assert.ok(x >= 0 && y >= 0)
    assert.ok(x + width <= CARD_SIZE.width)
    assert.ok(y + height <= CARD_SIZE.height)
    assert.ok(estimateFullCjkCount(template) >= CURRENT_LAYOUT.capacity)
  }
})

test('uses visual units so English, emoji and Chinese do not pretend to occupy equal width', () => {
  assert.equal(visualWeight('邻'), 1)
  assert.equal(visualWeight('A'), 0.65)
  assert.equal(visualWeight(' '), 0.3)
  assert.equal(visualWeight('🏡'), 1.6)

  const source = '邻里 ABC 🏡欢迎大家一起参加'
  const fitted = takeByVisualUnits(source, 7)

  assert.ok(visualWeight(fitted) <= 7)
  assert.ok(source.startsWith(fitted))
  assert.ok(!fitted.endsWith('\ud83c'))
})
