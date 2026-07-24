export const CARD_SIZE = Object.freeze({ width: 370, height: 498 })

export const CURRENT_LAYOUT = Object.freeze({
  unitsPerLine: 17,
  maxLines: 15,
  capacity: 17 * 15,
  safeRect: Object.freeze({ x: 28, y: 49, width: 312, height: 360 }),
  fontSize: 16,
  lineHeight: 24,
})

const assetRoot = '../../miniprogram/src/static/text-note-covers/0723'

export const TEMPLATE_CONFIGS = Object.freeze([
  {
    id: 'paper',
    label: '社区便签',
    intent: '自然叙事',
    textColor: '#34291f',
    fontFamily: '"Noto Sans SC", "PingFang SC", sans-serif',
    safeRect: { x: 32, y: 48, width: 306, height: 384 },
    fontSize: 16,
    lineHeight: 24,
    background: `${assetRoot}/paper.jpg`,
  },
  {
    id: 'mint',
    label: '邻里日常',
    intent: '轻松生活',
    textColor: '#174c39',
    fontFamily: '"Noto Sans SC", "PingFang SC", sans-serif',
    safeRect: { x: 32, y: 52, width: 306, height: 384 },
    fontSize: 16,
    lineHeight: 24,
    background: `${assetRoot}/mint.jpg`,
  },
  {
    id: 'slate',
    label: '今日记录',
    intent: '清晰记录',
    textColor: '#566349',
    fontFamily: '"Noto Sans SC", "PingFang SC", sans-serif',
    safeRect: { x: 36, y: 58, width: 298, height: 384 },
    fontSize: 16,
    lineHeight: 24,
    background: `${assetRoot}/slate.jpg`,
  },
  {
    id: 'headline',
    label: '社区小报',
    intent: '编辑报道',
    textColor: '#34291f',
    fontFamily: '"Songti SC", "Noto Serif SC", SimSun, serif',
    safeRect: { x: 36, y: 94, width: 298, height: 360 },
    fontSize: 16,
    lineHeight: 24,
    background: `${assetRoot}/headline.jpg`,
  },
  {
    id: 'quote',
    label: '一句话',
    intent: '温和表达',
    textColor: '#637a6b',
    fontFamily: '"Songti SC", "Noto Serif SC", SimSun, serif',
    safeRect: { x: 40, y: 92, width: 290, height: 360 },
    fontSize: 16,
    lineHeight: 24,
    background: `${assetRoot}/quote.jpg`,
  },
  {
    id: 'notice',
    label: '通知公告',
    intent: '正式通知',
    textColor: '#5b3213',
    fontFamily: '"Noto Serif SC", "Songti SC", SimSun, serif',
    safeRect: { x: 36, y: 54, width: 298, height: 384 },
    fontSize: 16,
    lineHeight: 24,
    background: `${assetRoot}/notice.jpg`,
  },
])

export function estimateFullCjkCount(template) {
  const charactersPerLine = Math.floor(template.safeRect.width / template.fontSize)
  const lines = Math.floor(template.safeRect.height / template.lineHeight)
  return charactersPerLine * lines
}

function graphemes(value) {
  const text = String(value ?? '')
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'grapheme' })
    return Array.from(segmenter.segment(text), ({ segment }) => segment)
  }
  return Array.from(text)
}

export function visualWeight(value) {
  return graphemes(value).reduce((total, character) => {
    if (character === '\n') return total
    if (/^\s$/u.test(character)) return total + 0.3
    if (/^[\x00-\x7f]$/u.test(character)) return total + 0.65
    if (/\p{Extended_Pictographic}/u.test(character)) return total + 1.6
    return total + 1
  }, 0)
}

export function takeByVisualUnits(value, limit) {
  let result = ''
  let used = 0
  for (const character of graphemes(value)) {
    const next = visualWeight(character)
    if (used + next > limit) break
    result += character
    used += next
  }
  return result
}
