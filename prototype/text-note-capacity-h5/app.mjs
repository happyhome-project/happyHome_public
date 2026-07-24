import {
  CARD_SIZE,
  CURRENT_LAYOUT,
  TEMPLATE_CONFIGS,
  estimateFullCjkCount,
  takeByVisualUnits,
} from './capacity.mjs'

const sourceParagraph = [
  '从每天家长陪伴到孩子第一次独立面对校园生活，是成长的重要一步。',
  '家长提前做好准备，不仅能减少孩子的焦虑，也能让孩子更自信地迈出独立的第一步。',
  '入学前可以和孩子一起整理书包，确认课本、文具、水杯和校牌放置的位置。',
  '选择方便穿脱的衣服和鞋子，练习独立用餐、如厕和表达需要。',
  '放学后先听孩子讲述当天最开心和最困惑的事情，再一起整理第二天要用的物品。',
  '真正的准备不是替孩子完成所有事情，而是让他知道遇到问题时可以怎样处理。',
].join('')

const fillSource = sourceParagraph.repeat(4)

const modeCopy = {
  current: '复现当前分页：255 视觉字。因为每行预留较多，连续中文通常只占约十三到十四行，底部会显得偏空。',
  recommended: '按每套背景的真实安全区、字体和行高计算。默认稿保证主要装饰不压住正文，同时把可读区域尽量用满。',
  limit: '在推荐稿下方再增加一行，用来观察装饰区冲突。它是视觉极限，不建议直接作为生产默认值。',
}

let activeMode = 'recommended'
let showSafeArea = false

const gallery = document.querySelector('#gallery')
const tableBody = document.querySelector('#capacity-table')
const modeNote = document.querySelector('#mode-note')
const safeToggle = document.querySelector('#safe-toggle')
const modeButtons = Array.from(document.querySelectorAll('[data-mode]'))

function percent(value, total) {
  return `${((value / total) * 100).toFixed(4)}%`
}

function layoutFor(template, mode) {
  if (mode === 'current') {
    return {
      ...CURRENT_LAYOUT,
      fontFamily: '"Noto Sans SC", "PingFang SC", sans-serif',
      capacity: CURRENT_LAYOUT.capacity,
      lines: CURRENT_LAYOUT.maxLines,
      charactersPerLine: CURRENT_LAYOUT.unitsPerLine,
    }
  }

  const recommendedLines = Math.floor(template.safeRect.height / template.lineHeight)
  const charactersPerLine = Math.floor(template.safeRect.width / template.fontSize)
  if (mode === 'recommended') {
    return {
      safeRect: template.safeRect,
      fontFamily: template.fontFamily,
      fontSize: template.fontSize,
      lineHeight: template.lineHeight,
      lines: recommendedLines,
      charactersPerLine,
      capacity: estimateFullCjkCount(template),
    }
  }

  const availableHeight = CARD_SIZE.height - template.safeRect.y - 16
  const requestedHeight = template.safeRect.height + template.lineHeight
  const height = Math.min(requestedHeight, availableHeight)
  const lines = Math.floor(height / template.lineHeight)
  return {
    safeRect: { ...template.safeRect, height },
    fontFamily: template.fontFamily,
    fontSize: template.fontSize,
    lineHeight: template.lineHeight,
    lines,
    charactersPerLine,
    capacity: lines * charactersPerLine,
  }
}

function styleFor(template, layout) {
  const { x, y, width, height } = layout.safeRect
  return [
    `--card-background:url("${template.background}")`,
    `--safe-x:${percent(x, CARD_SIZE.width)}`,
    `--safe-y:${percent(y, CARD_SIZE.height)}`,
    `--safe-width:${percent(width, CARD_SIZE.width)}`,
    `--safe-height:${percent(height, CARD_SIZE.height)}`,
    `--text-size:${((layout.fontSize / CARD_SIZE.width) * 100).toFixed(4)}cqw`,
    `--text-line-height:${((layout.lineHeight / CARD_SIZE.width) * 100).toFixed(4)}cqw`,
    `--text-color:${template.textColor}`,
    `--text-font:${layout.fontFamily}`,
  ].join(';')
}

function templatePanel(template) {
  const layout = layoutFor(template, activeMode)
  const currentDelta = layout.capacity - CURRENT_LAYOUT.capacity
  const fillText = takeByVisualUnits(fillSource, layout.capacity)
  return `
    <article class="template-panel" data-template="${template.id}">
      <header class="template-panel__head">
        <div>
          <h2>${template.label}</h2>
          <p>${template.intent}</p>
        </div>
        <span class="capacity-badge">约 ${layout.capacity} 字</span>
      </header>
      <div class="note-card" style='${styleFor(template, layout)}'>
        <div
          class="note-card__text js-measure-text"
          data-target-capacity="${layout.capacity}"
          data-max-lines="${layout.lines}"
        ><span class="note-card__text-content js-measure-content">${fillText}</span></div>
        <div class="note-card__safe-area" aria-hidden="true"></div>
      </div>
      <div class="template-panel__metrics">
        <div><span>版心</span><strong>${layout.safeRect.width} × ${layout.safeRect.height}</strong></div>
        <div><span>行数</span><strong>${layout.lines} 行</strong></div>
        <div><span>较当前</span><strong>${currentDelta >= 0 ? '+' : ''}${currentDelta} 字</strong></div>
      </div>
      <p class="render-state">浏览器实测：<strong class="js-measured">测量中</strong></p>
    </article>
  `
}

function tableRows() {
  return TEMPLATE_CONFIGS.map((template) => {
    const capacity = estimateFullCjkCount(template)
    const lines = Math.floor(template.safeRect.height / template.lineHeight)
    const perLine = Math.floor(template.safeRect.width / template.fontSize)
    return `
      <tr>
        <td><strong>${template.label}</strong></td>
        <td>${template.safeRect.width} × ${template.safeRect.height}</td>
        <td>${template.fontSize} / ${template.lineHeight} px</td>
        <td>${lines}</td>
        <td>${perLine}</td>
        <td><strong>${capacity}</strong></td>
        <td>+${capacity - CURRENT_LAYOUT.capacity}</td>
      </tr>
    `
  }).join('')
}

function graphemes(value) {
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'grapheme' })
    return Array.from(segmenter.segment(value), ({ segment }) => segment)
  }
  return Array.from(value)
}

function fits(element, content) {
  const contentHeight = content.getBoundingClientRect().height
  return contentHeight <= element.clientHeight + 1
    && content.scrollWidth <= element.clientWidth + 1
}

function measureElement(element) {
  const content = element.querySelector('.js-measure-content')
  const characters = graphemes(fillSource)
  const target = Number(element.dataset.targetCapacity)
  let low = 1
  let high = Math.min(target, characters.length)
  let best = 0

  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    content.textContent = characters.slice(0, middle).join('')
    if (fits(element, content)) {
      best = middle
      low = middle + 1
    } else {
      high = middle - 1
    }
  }

  content.textContent = characters.slice(0, best).join('')
  const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight)
  const contentHeight = content.getBoundingClientRect().height
  const renderedLines = Math.max(1, Math.round(contentHeight / lineHeight))
  const output = element.closest('.template-panel').querySelector('.js-measured')
  output.textContent = `${best} 字 · ${renderedLines}/${element.dataset.maxLines} 行 · 无溢出`
}

function measureAll() {
  document.querySelectorAll('.js-measure-text').forEach(measureElement)
}

function render() {
  gallery.innerHTML = TEMPLATE_CONFIGS.map(templatePanel).join('')
  tableBody.innerHTML = tableRows()
  modeNote.textContent = modeCopy[activeMode]
  document.body.classList.toggle('show-safe-area', showSafeArea)
  modeButtons.forEach((button) => {
    const isActive = button.dataset.mode === activeMode
    button.classList.toggle('is-active', isActive)
    button.setAttribute('aria-selected', String(isActive))
  })
  requestAnimationFrame(measureAll)
}

modeButtons.forEach((button) => {
  button.addEventListener('click', () => {
    activeMode = button.dataset.mode
    render()
  })
})

safeToggle.addEventListener('change', () => {
  showSafeArea = safeToggle.checked
  document.body.classList.toggle('show-safe-area', showSafeArea)
})

window.addEventListener('resize', () => requestAnimationFrame(measureAll))

render()
