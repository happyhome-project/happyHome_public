export const TEXT_NOTE_THEMES = {
  paper: {
    label: '社区便签',
    kicker: '社区便签',
    capacity: 170,
  },
  mint: {
    label: '邻里日常',
    kicker: '邻里日常',
    capacity: 158,
  },
  slate: {
    label: '今日记录',
    kicker: '今日记录',
    capacity: 176,
  },
  headline: {
    label: '社区小报',
    kicker: '社区小报',
    capacity: 150,
  },
  quote: {
    label: '一句话',
    kicker: '一句话',
    capacity: 142,
  },
  notice: {
    label: '通知公告',
    kicker: '通知公告',
    capacity: 154,
  },
}

const themeNames = Object.keys(TEXT_NOTE_THEMES)
const sentenceBoundary = /[^。！？!?；;\n]+[。！？!?；;]?|\n/g
const salutationPattern = /^(各位|大家|邻居们?|居民们?|业主们?|朋友们?|家人们?)[^。！？!?]{0,8}[：:]$/

function graphemes(value) {
  const text = String(value ?? '')
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'grapheme' })
    return Array.from(segmenter.segment(text), (item) => item.segment)
  }
  return Array.from(text)
}

function visualWeight(value) {
  return graphemes(value).reduce((total, character) => {
    if (character === '\n') return total + 0.5
    if (/\s/u.test(character)) return total + 0.3
    if (/^[\x00-\x7F]$/u.test(character)) return total + 0.55
    if (/\p{Extended_Pictographic}/u.test(character)) return total + 1.6
    return total + 1
  }, 0)
}

function splitByCapacity(value, capacity) {
  const chunks = []
  let current = ''
  let currentWeight = 0

  for (const character of graphemes(value)) {
    const weight = visualWeight(character)
    if (current && currentWeight + weight > capacity) {
      chunks.push(current)
      current = ''
      currentWeight = 0
    }
    current += character
    currentWeight += weight
  }

  if (current) chunks.push(current)
  return chunks
}

function atomicSegments(value, capacity) {
  const matches = String(value || '').match(sentenceBoundary) || []
  return matches.flatMap((segment) =>
    visualWeight(segment) > capacity ? splitByCapacity(segment, capacity) : [segment],
  )
}

function truncateGraphemes(value, limit) {
  const characters = graphemes(value)
  if (characters.length <= limit) return characters.join('')
  return `${characters.slice(0, Math.max(0, limit - 1)).join('')}…`
}

export function normalizeBody(value) {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function selectCoverExcerpt(value) {
  const normalized = normalizeBody(value)
  if (!normalized) return ''
  const paragraphs = normalized.split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter(Boolean)
  const substantive = paragraphs.find((paragraph) => !salutationPattern.test(paragraph))
  return truncateGraphemes(substantive || paragraphs[0], 64)
}

export function paginateBody(value, options = {}) {
  const normalized = normalizeBody(value)
  if (!normalized) return []

  const capacity = Math.max(12, Number(options.capacity) || TEXT_NOTE_THEMES.paper.capacity)
  const segments = atomicSegments(normalized, capacity)
  const pages = []
  let current = ''
  let currentWeight = 0

  for (const segment of segments) {
    const weight = visualWeight(segment)
    if (current && currentWeight + weight > capacity) {
      pages.push(current)
      current = ''
      currentWeight = 0
    }
    current += segment
    currentWeight += weight
  }

  if (current) pages.push(current)
  return pages
}

export function paginateBodyToFit(value, fits) {
  const normalized = normalizeBody(value)
  if (!normalized) return []
  if (typeof fits !== 'function') {
    throw new TypeError('paginateBodyToFit requires a renderer fit function')
  }

  const characters = graphemes(normalized)
  const pages = []
  let cursor = 0

  while (cursor < characters.length) {
    const remainingLength = characters.length - cursor
    let low = 1
    let high = remainingLength
    let bestLength = 0

    while (low <= high) {
      const middle = Math.floor((low + high) / 2)
      const candidate = characters.slice(cursor, cursor + middle).join('')
      if (fits(candidate)) {
        bestLength = middle
        low = middle + 1
      } else {
        high = middle - 1
      }
    }

    if (bestLength === 0) {
      throw new Error('The text renderer cannot fit a single grapheme')
    }

    let splitLength = bestLength
    if (bestLength < remainingLength) {
      const earliestNaturalBreak = Math.max(1, Math.floor(bestLength * 0.62))
      for (let index = bestLength; index >= earliestNaturalBreak; index -= 1) {
        if (/[。！？!?；;\n]/u.test(characters[cursor + index - 1])) {
          splitLength = index
          break
        }
      }
    }

    pages.push(characters.slice(cursor, cursor + splitLength).join(''))
    cursor += splitLength
  }

  return pages
}

export function fitTextToRenderer(value, fits) {
  const text = String(value ?? '').trim()
  if (!text) return ''
  if (typeof fits !== 'function') {
    throw new TypeError('fitTextToRenderer requires a renderer fit function')
  }
  if (fits(text)) return text

  const characters = graphemes(text)
  let low = 0
  let high = Math.max(0, characters.length - 1)
  let fitted = fits('…') ? '…' : ''

  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const prefix = characters.slice(0, middle).join('').trimEnd()
    const candidate = `${prefix}…`
    if (fits(candidate)) {
      fitted = candidate
      low = middle + 1
    } else {
      high = middle - 1
    }
  }

  return fitted
}

export function createTextNoteDeck({ title, body, theme = 'paper' } = {}) {
  const normalizedTheme = themeNames.includes(theme) ? theme : 'paper'
  const themeConfig = TEXT_NOTE_THEMES[normalizedTheme]
  const normalizedTitle = String(title ?? '').trim()
  const normalizedBody = normalizeBody(body)
  const isShort = visualWeight(normalizedBody) <= 90

  const pages = [{
    kind: 'cover',
    kicker: themeConfig.kicker,
    title: normalizedTitle,
    body: isShort ? normalizedBody : selectCoverExcerpt(normalizedBody),
    sourceBody: '',
  }]

  if (!isShort) {
    for (const chunk of paginateBody(normalizedBody, { capacity: themeConfig.capacity })) {
      pages.push({
        kind: 'body',
        kicker: themeConfig.kicker,
        title: normalizedTitle,
        body: chunk.trim(),
        sourceBody: chunk,
      })
    }
  }

  const totalPages = pages.length
  return {
    theme: normalizedTheme,
    label: themeConfig.label,
    pages: pages.map((page, index) => ({
      ...page,
      pageNumber: index + 1,
      totalPages,
    })),
  }
}
