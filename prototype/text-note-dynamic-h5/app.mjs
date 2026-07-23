import {
  createTextNoteDeck,
  fitTextToRenderer,
  normalizeBody,
  paginateBodyToFit,
  TEXT_NOTE_THEMES,
} from './layout.mjs'

const ROUTES = ['#/compose', '#/preview', '#/home', '#/detail']
const COVER_ROOT = '../../miniprogram/src/static/text-note-covers'
const DEFAULT_TITLE = '周六社区停水与临时取水点通知'
const DEFAULT_BODY = `各位邻居：

因二次供水设备检修，本周六上午 8:30 至下午 16:00，1—6 栋将暂停供水。请大家提前储备必要生活用水，并注意关闭家中水龙头。

临时取水点设在北门物业服务中心和儿童活动区东侧，每户可凭门禁卡领取两桶应急用水。行动不便的老人或独居住户，可在周五 18:00 前联系楼栋志愿者登记送水。

检修结束后恢复供水初期可能出现短暂浑浊，请先放水 3—5 分钟再使用。若施工进度变化，物业会在社区公告中及时更新。

温馨提示：
1. 家中有净水器的住户，请在停水前关闭进水阀。
2. 恢复供水后先打开厨房冷水龙头排水。
3. 如遇漏水或其他紧急情况，请联系物业值班电话。

感谢大家的理解与配合。`

const generationPhases = [
  '正在识别段落结构',
  '正在为正文分页',
  '正在套用社区主题',
]

const topicOptions = ['社区通知', '生活提醒', '邻里互助']
const locationOptions = ['阳光花园北门', '物业服务中心', '儿童活动区']
const PREVIEW_THEME_ORDER = ['paper', 'mint', 'slate', 'notice', 'headline', 'quote']

const state = {
  title: DEFAULT_TITLE,
  body: DEFAULT_BODY,
  theme: 'notice',
  deck: createTextNoteDeck({ title: DEFAULT_TITLE, body: DEFAULT_BODY, theme: 'notice' }),
  pageIndex: 0,
  detailPageIndex: 0,
  topic: '',
  location: '',
  generating: false,
  generationPhase: 0,
  sheet: '',
  toast: '',
  published: false,
  detailDeck: null,
  detailTitle: '',
}

const app = document.querySelector('#app')

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function icon(name, className = '') {
  const icons = {
    back: '<path d="M15 5 8 12l7 7" />',
    home: '<path d="m3 11 9-8 9 8" /><path d="M5 10v10h14V10" /><path d="M9 20v-6h6v6" />',
    plus: '<path d="M12 5v14M5 12h14" />',
    user: '<circle cx="12" cy="8" r="4" /><path d="M4 21c.8-4.1 3.4-6 8-6s7.2 1.9 8 6" />',
    pin: '<path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" />',
    check: '<path d="m5 12 4 4L19 6" />',
    heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.7-7.5 1.1-1.1a5.5 5.5 0 0 0 0-7.8Z" />',
    close: '<path d="m6 6 12 12M18 6 6 18" />',
  }
  return `<svg class="icon ${className}" viewBox="0 0 24 24" aria-hidden="true">${icons[name] || ''}</svg>`
}

function currentRoute() {
  return ROUTES.includes(window.location.hash) ? window.location.hash : '#/compose'
}

function navigate(route) {
  if (window.location.hash === route) {
    render()
    return
  }
  window.location.hash = route
}

function renderAppBar(title, backRoute = '') {
  return `
    <header class="app-bar">
      ${backRoute
        ? `<button class="icon-button" type="button" data-action="navigate" data-route="${backRoute}" aria-label="返回">${icon('back')}</button>`
        : '<span class="app-bar__side"></span>'}
      <h1>${escapeHtml(title)}</h1>
      <span class="app-bar__side"></span>
    </header>
  `
}

function renderPreviewAppBar() {
  return `
    <header class="app-bar app-bar--preview">
      <button class="icon-button" type="button" data-action="navigate" data-route="#/compose" aria-label="返回">${icon('back')}</button>
      <h1>预览</h1>
      <button class="app-bar__edit" type="button" data-action="navigate" data-route="#/compose">编辑</button>
    </header>
  `
}

function renderCard(page, theme, options = {}) {
  const compact = options.compact ? ' note-card--compact' : ''
  const selected = options.selected ? ' is-selected' : ''
  const bodyClass = page.body.length > 150
    ? ' note-card__body--dense'
    : page.body.length > 80
      ? ' note-card__body--medium'
      : ''
  return `
    <article class="note-card theme-${theme} note-card--${page.kind}${compact}${selected}">
      <img class="note-card__background" src="${COVER_ROOT}/${theme}.svg" alt="" />
      <div class="note-card__wash"></div>
      <div class="note-card__content">
        ${page.kind === 'cover'
          ? `
            <p class="note-card__kicker">${escapeHtml(page.kicker)}</p>
            <h2 class="note-card__title">${escapeHtml(page.title)}</h2>
            <span class="note-card__rule"></span>
            <p class="note-card__body${bodyClass}">${escapeHtml(page.body)}</p>
          `
          : `
            <div class="note-card__page-head">
              <p class="note-card__kicker">${escapeHtml(page.kicker)}</p>
            </div>
            <h2 class="note-card__body-title">${escapeHtml(page.title)}</h2>
            <span class="note-card__rule"></span>
            <p class="note-card__body note-card__body--document${bodyClass}">${escapeHtml(page.body)}</p>
          `}
      </div>
    </article>
  `
}

function renderedPageFits(host, page, theme) {
  host.innerHTML = renderCard(page, theme)
  const card = host.querySelector('.note-card')
  const body = host.querySelector('.note-card__body')
  const title = host.querySelector('.note-card__title, .note-card__body-title')
  const rule = host.querySelector('.note-card__rule')
  if (!card || !body || !title) return false

  const cardRect = card.getBoundingClientRect()
  const bodyRect = body.getBoundingClientRect()
  const titleRect = title.getBoundingClientRect()
  const ruleRect = rule?.getBoundingClientRect()
  const safeBodyBottom = cardRect.top + cardRect.height * 0.87
  const bodyOverflows = body.scrollHeight > body.clientHeight
    || bodyRect.bottom > safeBodyBottom
  const titleOverflows = title.scrollHeight > title.clientHeight
    || (page.kind === 'cover' && ruleRect && titleRect.bottom > ruleRect.top - 4)

  return !bodyOverflows && !titleOverflows
}

function createMeasuredDeck({ title, body, theme }) {
  const baseDeck = createTextNoteDeck({ title, body, theme })
  const normalizedBody = normalizeBody(body)
  const host = document.createElement('div')
  host.className = 'note-card-measurement'
  host.setAttribute('aria-hidden', 'true')
  document.body.append(host)

  try {
    const cover = { ...baseDeck.pages[0], pageNumber: 1, totalPages: 2 }
    cover.title = fitTextToRenderer(cover.title, (candidate) =>
      renderedPageFits(host, { ...cover, title: candidate, body: '' }, theme))
    cover.body = fitTextToRenderer(cover.body, (candidate) =>
      renderedPageFits(host, { ...cover, body: candidate }, theme))

    const needsDocumentPages = baseDeck.pages.length > 1 || cover.body !== normalizedBody
    const bodyPages = needsDocumentPages
      ? paginateBodyToFit(normalizedBody, (candidate) =>
          renderedPageFits(host, {
            kind: 'body',
            kicker: baseDeck.pages[0].kicker,
            title,
            body: candidate,
            pageNumber: 2,
            totalPages: 99,
          }, theme))
      : []

    const pages = [
      cover,
      ...bodyPages.map((pageBody) => ({
        kind: 'body',
        kicker: baseDeck.pages[0].kicker,
        title,
        body: pageBody.trim(),
        sourceBody: pageBody,
      })),
    ]
    const totalPages = pages.length

    return {
      ...baseDeck,
      pages: pages.map((page, index) => ({
        ...page,
        pageNumber: index + 1,
        totalPages,
      })),
    }
  } finally {
    host.remove()
  }
}

function renderCompose() {
  return `
    <section class="screen screen--compose" data-testid="compose-screen">
      ${renderAppBar('写文字', '#/home')}
      <div class="compose-body">
        <div class="editor-card">
          <label class="sr-only" for="note-title">标题</label>
          <input
            id="note-title"
            class="title-input"
            data-testid="title-input"
            maxlength="48"
            value="${escapeHtml(state.title)}"
            placeholder="添加标题"
          />
          <span class="editor-divider"></span>
          <label class="sr-only" for="note-body">正文</label>
          <textarea
            id="note-body"
            class="body-input"
            data-testid="body-input"
            placeholder="添加正文内容"
          >${escapeHtml(state.body)}</textarea>
        </div>
      </div>
      <footer class="compose-actions">
        <button class="text-button" type="button" data-action="draft">存草稿</button>
        <button class="primary-button" type="button" data-action="generate" data-testid="generate-button">生成排版</button>
      </footer>
      ${renderToast()}
      ${state.generating ? renderGenerationOverlay() : ''}
    </section>
  `
}

function renderGenerationOverlay() {
  const phase = generationPhases[state.generationPhase] || generationPhases[0]
  return `
    <div class="generation-overlay" data-testid="generation-overlay" role="status" aria-live="assertive">
      <div class="generation-card">
        <div class="generation-preview">
          <span class="generation-kicker"></span>
          <span class="generation-title"></span>
          <span class="generation-line generation-line--long"></span>
          <span class="generation-line"></span>
          <span class="generation-line generation-line--short"></span>
        </div>
        <p class="generation-status">${escapeHtml(phase)}</p>
        <div class="generation-steps" aria-hidden="true">
          ${generationPhases.map((_, index) =>
            `<span class="${index <= state.generationPhase ? 'is-active' : ''}"></span>`,
          ).join('')}
        </div>
        <p class="generation-help">只调整排版，不改动你的文字</p>
      </div>
    </div>
  `
}

function renderPreview() {
  const pages = state.deck.pages
  const activePage = pages[Math.min(state.pageIndex, pages.length - 1)]
  return `
    <section class="screen screen--preview" data-testid="preview-screen">
      ${renderPreviewAppBar()}
      <div class="preview-body">
        <div class="deck-stage" data-testid="deck-preview">
          <div class="deck-carousel" data-carousel="preview">
            ${pages.map((page, index) =>
              `<div class="deck-slide" data-page="${index}">${renderCard(page, state.theme)}</div>`,
            ).join('')}
          </div>
          <span class="deck-count">${state.pageIndex + 1}/${pages.length}</span>
        </div>

        <div class="theme-rail" data-testid="theme-rail" aria-label="选择排版风格">
          ${PREVIEW_THEME_ORDER.map((theme) => {
            const config = TEXT_NOTE_THEMES[theme]
            return `
            <button
              class="theme-option ${theme === state.theme ? 'is-active' : ''}"
              type="button"
              data-action="theme"
              data-theme="${theme}"
              aria-label="${escapeHtml(config.label)}"
            >
              <span class="theme-option__cover">${renderCard({ ...activePage, kind: 'cover', kicker: config.kicker }, theme, { compact: true })}</span>
              <span>${escapeHtml(config.label)}</span>
            </button>
          `
          }).join('')}
        </div>

        <div class="publish-tools">
          <button class="tool-button ${state.topic ? 'is-selected' : ''}" type="button" data-action="open-topic" data-testid="topic-tool">
            <span class="tool-icon tool-icon--topic">#</span>
            <span>${escapeHtml(state.topic || '话题')}</span>
          </button>
          <button class="tool-button ${state.location ? 'is-selected' : ''}" type="button" data-action="open-location" data-testid="location-tool">
            ${icon('pin', 'tool-icon-svg')}
            <span>${escapeHtml(state.location || '设置地点')}</span>
          </button>
        </div>
      </div>
      <footer class="preview-actions">
        <span class="preview-actions__hint">选择喜欢的排版</span>
        <button class="primary-button" type="button" data-action="publish" data-testid="publish-button">发布</button>
      </footer>
      ${state.sheet ? renderSheet() : ''}
      ${renderToast()}
      ${state.generating ? renderGenerationOverlay() : ''}
    </section>
  `
}

function renderSheet() {
  const isTopic = state.sheet === 'topic'
  const options = isTopic ? topicOptions : locationOptions
  const selected = isTopic ? state.topic : state.location
  return `
    <div class="sheet-layer" data-action="close-sheet">
      <section class="bottom-sheet" role="dialog" aria-modal="true" aria-label="${isTopic ? '选择话题' : '选择地点'}">
        <div class="sheet-handle"></div>
        <div class="sheet-head">
          <h2>${isTopic ? '选择话题' : '选择地点'}</h2>
          <button class="icon-button" type="button" data-action="close-sheet" aria-label="关闭">${icon('close')}</button>
        </div>
        <div class="sheet-options">
          ${options.map((option) => `
            <button
              class="sheet-option ${option === selected ? 'is-active' : ''}"
              type="button"
              data-action="${isTopic ? 'select-topic' : 'select-location'}"
              data-value="${escapeHtml(option)}"
            >
              <span>${isTopic ? '#' : icon('pin', 'sheet-option__icon')} ${escapeHtml(option)}</span>
              ${option === selected ? icon('check', 'sheet-option__check') : ''}
            </button>
          `).join('')}
        </div>
      </section>
    </div>
  `
}

function mockFeedItems() {
  const paper = createTextNoteDeck({
    title: '周末旧书交换',
    body: '周日下午在物业活动室交换闲置图书，欢迎大家带上想分享的书。',
    theme: 'paper',
  })
  const mint = createTextNoteDeck({
    title: '花园里的第一朵栀子花',
    body: '下班路过儿童活动区，闻到了今年第一阵栀子花香。',
    theme: 'mint',
  })
  const slate = createTextNoteDeck({
    title: '夜间停车温馨提醒',
    body: '消防通道请勿停车，谢谢大家为紧急车辆留出安全空间。',
    theme: 'slate',
  })
  return [
    {
      title: state.title,
      deck: state.deck,
      theme: state.theme,
      topic: state.topic,
      location: state.location,
      author: '社区管理员',
      time: '刚刚',
      likes: 0,
      published: true,
    },
    { title: '周末旧书交换', deck: paper, theme: 'paper', topic: '邻里互助', author: '林阿姨', time: '今天', likes: 12 },
    { title: '花园里的第一朵栀子花', deck: mint, theme: 'mint', topic: '邻里日常', author: '小满', time: '昨天', likes: 31 },
    { title: '夜间停车温馨提醒', deck: slate, theme: 'slate', topic: '生活提醒', author: '物业服务', time: '昨天', likes: 8 },
  ]
}

function renderFeedCard(item, index) {
  return `
    <article
      class="feed-card"
      data-action="open-detail"
      data-feed-index="${index}"
      ${item.published ? 'data-testid="published-card"' : ''}
      tabindex="0"
      role="button"
    >
      ${renderCard(item.deck.pages[0], item.theme, { compact: true })}
      <div class="feed-card__main">
        <h3>${escapeHtml(item.title)}</h3>
        ${item.topic ? `<p class="feed-card__topic">#${escapeHtml(item.topic)}</p>` : ''}
        <div class="feed-card__meta">
          <span>${escapeHtml(item.author)}</span>
          <span>${icon('heart', 'feed-heart')} ${item.likes}</span>
        </div>
      </div>
    </article>
  `
}

function renderHome() {
  const items = mockFeedItems()
  const columns = [
    items.filter((_, index) => index % 2 === 0),
    items.filter((_, index) => index % 2 === 1),
  ]
  return `
    <section class="screen screen--home" data-testid="home-screen">
      <header class="home-head">
        <div class="community-row">
          <span class="community-avatar">阳</span>
          <div>
            <h1>阳光花园社区</h1>
            <p>邻里共享 · 生活在这里</p>
          </div>
        </div>
        <blockquote>风来疏竹，风过而竹不留声</blockquote>
      </header>
      <nav class="topic-tabs" aria-label="内容分类">
        <button class="is-active" type="button">全部</button>
        <button type="button">通知公告</button>
        <button type="button">邻里随手记</button>
      </nav>
      <main class="feed-columns">
        ${columns.map((column) => `
          <div class="feed-column">
            ${column.map((item) => renderFeedCard(item, items.indexOf(item))).join('')}
          </div>
        `).join('')}
      </main>
      ${renderTabBar('home')}
      ${renderToast()}
    </section>
  `
}

function renderTabBar(active) {
  return `
    <nav class="tab-bar" aria-label="主导航">
      <button class="${active === 'home' ? 'is-active' : ''}" type="button" data-action="navigate" data-route="#/home">
        ${icon('home')}<span>首页</span>
      </button>
      <button class="tab-bar__publish" type="button" data-action="navigate" data-route="#/compose" aria-label="发布">
        ${icon('plus')}
      </button>
      <button class="${active === 'profile' ? 'is-active' : ''}" type="button">
        ${icon('user')}<span>我的</span>
      </button>
    </nav>
  `
}

function renderDetail() {
  const deck = state.detailDeck || state.deck
  const title = state.detailTitle || state.title
  const topic = state.topic || '社区通知'
  const location = state.location || '阳光花园北门'
  return `
    <section class="screen screen--detail" data-testid="detail-screen">
      ${renderAppBar('详情', '#/home')}
      <main class="detail-body">
        <div class="detail-author">
          <span class="detail-avatar">管</span>
          <div>
            <strong>社区管理员</strong>
            <span>刚刚发布</span>
          </div>
        </div>
        <div class="detail-deck" data-testid="detail-deck">
          <div class="deck-carousel" data-carousel="detail">
            ${deck.pages.map((page, index) =>
              `<div class="deck-slide" data-page="${index}">${renderCard(page, deck.theme)}</div>`,
            ).join('')}
          </div>
          <span class="deck-count">${state.detailPageIndex + 1}/${deck.pages.length}</span>
        </div>
        <div class="detail-dots" aria-hidden="true">
          ${deck.pages.map((_, index) => `<span class="${index === state.detailPageIndex ? 'is-active' : ''}"></span>`).join('')}
        </div>
        <h2 class="detail-title">${escapeHtml(title)}</h2>
        <div class="detail-meta-tools">
          <span># ${escapeHtml(topic)}</span>
          <span>${icon('pin', 'detail-pin')} ${escapeHtml(location)}</span>
        </div>
        <p class="detail-note">正文已经完整进入上方文字卡，不再在卡片下方重复展示。</p>
      </main>
    </section>
  `
}

function renderToast() {
  return state.toast ? `<div class="toast" role="status">${escapeHtml(state.toast)}</div>` : ''
}

function render() {
  const route = currentRoute()
  if (route === '#/preview') app.innerHTML = renderPreview()
  else if (route === '#/home') app.innerHTML = renderHome()
  else if (route === '#/detail') app.innerHTML = renderDetail()
  else app.innerHTML = renderCompose()

  bindDynamicFields()
  syncCarousel(route)
  syncThemeRail(route)
}

function bindDynamicFields() {
  const titleInput = app.querySelector('[data-testid="title-input"]')
  const bodyInput = app.querySelector('[data-testid="body-input"]')
  if (titleInput) {
    titleInput.addEventListener('input', (event) => {
      state.title = event.target.value
    })
  }
  if (bodyInput) {
    bodyInput.addEventListener('input', (event) => {
      state.body = event.target.value
    })
  }
}

function syncCarousel(route) {
  const kind = route === '#/detail' ? 'detail' : route === '#/preview' ? 'preview' : ''
  if (!kind) return
  const carousel = app.querySelector(`[data-carousel="${kind}"]`)
  if (!carousel) return
  const targetIndex = kind === 'detail' ? state.detailPageIndex : state.pageIndex
  requestAnimationFrame(() => {
    carousel.scrollLeft = targetIndex * carouselSlideStride(carousel)
  })
  let frame = 0
  carousel.addEventListener('scroll', () => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      const index = Math.max(0, Math.min(
        Math.round(carousel.scrollLeft / carouselSlideStride(carousel)),
        carousel.children.length - 1,
      ))
      if (kind === 'detail' && index !== state.detailPageIndex) {
        state.detailPageIndex = index
        updateDeckIndicators('detail', index)
      } else if (kind === 'preview' && index !== state.pageIndex) {
        state.pageIndex = index
        updateDeckIndicators('preview', index)
      }
    })
  }, { passive: true })
}

function syncThemeRail(route) {
  if (route !== '#/preview') return
  const rail = app.querySelector('.theme-rail')
  const selected = rail?.querySelector('.theme-option.is-active')
  if (!rail || !selected) return
  requestAnimationFrame(() => {
    const edge = 12
    const selectedLeft = selected.offsetLeft
    const selectedRight = selectedLeft + selected.offsetWidth
    const visibleLeft = rail.scrollLeft
    const visibleRight = visibleLeft + rail.clientWidth
    if (selectedLeft < visibleLeft + edge) {
      rail.scrollLeft = Math.max(0, selectedLeft - edge)
    } else if (selectedRight > visibleRight - edge) {
      rail.scrollLeft = selectedRight - rail.clientWidth + edge
    }
  })
}

function carouselSlideStride(carousel) {
  const firstSlide = carousel.firstElementChild
  if (!firstSlide) return Math.max(1, carousel.clientWidth)
  const carouselStyle = getComputedStyle(carousel)
  const gap = Number.parseFloat(carouselStyle.columnGap || carouselStyle.gap) || 0
  return Math.max(1, firstSlide.getBoundingClientRect().width + gap)
}

function updateDeckIndicators(kind, index) {
  const count = app.querySelector('.deck-count')
  const pages = kind === 'detail' ? (state.detailDeck || state.deck).pages : state.deck.pages
  if (count) count.textContent = `${index + 1}/${pages.length}`
  if (kind === 'detail') {
    app.querySelectorAll('.detail-dots span').forEach((element, pageIndex) => {
      element.classList.toggle('is-active', pageIndex === index)
    })
  }
}

function showToast(message) {
  state.toast = message
  render()
  window.setTimeout(() => {
    if (state.toast === message) {
      state.toast = ''
      render()
    }
  }, 1500)
}

function wait(duration) {
  return new Promise((resolve) => window.setTimeout(resolve, duration))
}

async function generateDeck({ routeAfter = true, compact = false } = {}) {
  if (state.generating) return
  if (!state.title.trim()) {
    showToast('请填写标题')
    return
  }
  if (!state.body.trim()) {
    showToast('请填写正文')
    return
  }

  state.generating = true
  state.generationPhase = 0
  render()
  for (let index = 0; index < generationPhases.length; index += 1) {
    state.generationPhase = index
    render()
    await wait(compact ? 190 : 360)
  }
  state.deck = createMeasuredDeck({ title: state.title, body: state.body, theme: state.theme })
  state.pageIndex = 0
  state.detailPageIndex = 0
  state.generating = false
  if (routeAfter) navigate('#/preview')
  else render()
}

function openDetail(index) {
  const item = mockFeedItems()[index]
  if (!item) return
  state.detailDeck = item.deck
  state.detailTitle = item.title
  state.detailPageIndex = 0
  navigate('#/detail')
}

app.addEventListener('click', async (event) => {
  const target = event.target.closest('[data-action]')
  if (!target) return
  const action = target.dataset.action

  if (action === 'navigate') navigate(target.dataset.route)
  else if (action === 'generate') await generateDeck()
  else if (action === 'draft') showToast('草稿已保存在本机样板中')
  else if (action === 'theme') {
    const theme = target.dataset.theme
    if (!theme || theme === state.theme) return
    state.theme = theme
    await generateDeck({ routeAfter: false, compact: true })
  } else if (action === 'open-topic') {
    state.sheet = 'topic'
    render()
  } else if (action === 'open-location') {
    state.sheet = 'location'
    render()
  } else if (action === 'close-sheet') {
    if (event.target === target || target.closest('.sheet-head')) {
      state.sheet = ''
      render()
    }
  } else if (action === 'select-topic') {
    state.topic = target.dataset.value
    state.sheet = ''
    render()
  } else if (action === 'select-location') {
    state.location = target.dataset.value
    state.sheet = ''
    render()
  } else if (action === 'publish') {
    state.published = true
    state.detailDeck = state.deck
    state.detailTitle = state.title
    showToast('发布成功')
    await wait(420)
    navigate('#/home')
  } else if (action === 'open-detail') {
    openDetail(Number(target.dataset.feedIndex || 0))
  }
})

app.addEventListener('keydown', (event) => {
  const target = event.target.closest('[data-action="open-detail"]')
  if (target && (event.key === 'Enter' || event.key === ' ')) {
    event.preventDefault()
    openDetail(Number(target.dataset.feedIndex || 0))
  }
})

window.addEventListener('hashchange', render)

if (!ROUTES.includes(window.location.hash)) {
  window.location.hash = '#/compose'
} else {
  render()
}
