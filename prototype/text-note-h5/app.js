const THEME_FALLBACK = 'paper'
const MAX_TOPIC_COUNT = 5
const themes = [
  { id: 'paper', name: '社区便签', sample: '慢一点，也很好' },
  { id: 'mint', name: '清新绿', sample: '今天的小确幸' },
  { id: 'slate', name: '雾蓝小报', sample: '邻里新鲜事' },
  { id: 'headline', name: '大字标题', sample: '今天想说' },
  { id: 'quote', name: '邻里引语', sample: '生活有回声' },
  { id: 'notice', name: '通知公告', sample: '停水提醒' },
]
const locations = [
  { id: 'sunny-garden', name: '阳光花园社区', detail: '距你 80m' },
  { id: 'activity-center', name: '阳光花园社区活动中心', detail: '距你 160m' },
  { id: 'children-park', name: '社区儿童乐园', detail: '距你 230m' },
  { id: 'east-gate', name: '阳光花园东门', detail: '距你 350m' },
]

const seedPosts = [
  {
    id: 'seed-1',
    title: '雨停以后，楼下的桂花香得很认真',
    body: '晚饭后绕着小区走了一圈，雨水还挂在叶子上。经过儿童乐园时，突然闻到一阵桂花香。原来秋天真的会在某个普通晚上，轻轻提醒你它来了。',
    theme: 'paper',
    author: '林阿姨',
    when: '18分钟前',
    likes: 18,
  },
  {
    id: 'seed-2',
    title: '谁家有闲置的儿童雨靴？',
    body: '孩子这周学校要去湿地观察，小脚长得太快，去年的雨靴已经穿不上了。想借一双 31 码左右的，用完洗干净送回。',
    theme: 'mint',
    author: '小满妈妈',
    when: '42分钟前',
    likes: 7,
  },
  {
    id: 'seed-3',
    title: '今晚七点，架空层一起跳操',
    body: '天气不错，今晚七点在 3 栋架空层跳半小时。动作不难，新邻居也欢迎来，穿舒服的鞋就行。',
    theme: 'slate',
    author: '何老师',
    when: '1小时前',
    likes: 26,
  },
  {
    id: 'seed-4',
    title: '谢谢帮忙收被子的邻居',
    body: '下午突然下雨，我还在回家的路上。到家发现晾在公共露台的被子被人帮忙收到了门口，没留下名字。想在这里认真说一声谢谢。',
    theme: 'paper',
    author: '住在 6 栋',
    when: '昨天',
    likes: 54,
  },
  {
    id: 'seed-5',
    title: '周末一起给共享花箱松松土',
    body: '花箱里的薄荷长得太挤了，周六上午十点准备整理一下。家里有小铲子或者多余花盆的，可以顺手带来。',
    theme: 'mint',
    author: '青禾',
    when: '昨天',
    likes: 31,
  },
  {
    id: 'seed-6',
    title: '一条很实用的停水提醒',
    body: '物业通知明天上午九点到十一点检修水管，2 栋和 3 栋会短暂停水。家里有老人和小朋友的，可以提前留一点生活用水。',
    theme: 'slate',
    author: '社区小管家',
    when: '2天前',
    likes: 63,
  },
]

const state = {
  screen: routeFromHash(),
  draft: readDraft(),
  posts: readPosts(),
  selectedPostId: readDetailId(),
  locationSheetOpen: false,
  topicSheetOpen: false,
  topicDraft: '',
}

function readDraft() {
  try {
    const value = JSON.parse(sessionStorage.getItem('hh-text-note-draft') || 'null')
    if (value && typeof value === 'object') {
      return {
        title: String(value.title || ''),
        body: String(value.body || ''),
        theme: normalizeTheme(value.theme),
        location: normalizeLocation(value.location),
        topics: normalizeTopics(value.topics),
      }
    }
  } catch {}
  return { title: '', body: '', theme: THEME_FALLBACK, location: null, topics: [] }
}

function readPosts() {
  try {
    const saved = JSON.parse(sessionStorage.getItem('hh-text-note-posts') || 'null')
    if (Array.isArray(saved) && saved.length) {
      const normalized = saved.map(normalizePost).filter(Boolean)
      if (normalized.length) return normalized
    }
  } catch {}
  return seedPosts
}

function normalizePost(value) {
  if (!value || typeof value !== 'object') return null
  const id = String(value.id || '')
  const title = String(value.title || '').trim()
  const body = String(value.body || '').trim()
  if (!id || !title || !body) return null
  return {
    id,
    title,
    body,
    theme: normalizeTheme(value.theme),
    location: normalizeLocation(value.location),
    topics: normalizeTopics(value.topics),
    author: String(value.author || '我'),
    when: String(value.when || '刚刚'),
    likes: Number.isFinite(Number(value.likes)) ? Math.max(0, Number(value.likes)) : 0,
  }
}

function saveDraft() {
  sessionStorage.setItem('hh-text-note-draft', JSON.stringify(state.draft))
}

function savePosts() {
  sessionStorage.setItem('hh-text-note-posts', JSON.stringify(state.posts))
}

function normalizeTheme(value) {
  return themes.some((theme) => theme.id === value) ? value : THEME_FALLBACK
}

function normalizeLocation(value) {
  if (!value || typeof value !== 'object') return null
  const id = String(value.id || '')
  const name = String(value.name || '').trim()
  return id && name ? { id, name } : null
}

function normalizeTopics(value) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  return value.map((topic) => String(topic || '').replace(/^#+/, '').trim()).filter((topic) => {
    if (!topic || Array.from(topic).length > 20 || seen.has(topic)) return false
    seen.add(topic)
    return true
  }).slice(0, MAX_TOPIC_COUNT)
}

function routeFromHash() {
  const hash = location.hash || '#/compose'
  if (hash.startsWith('#/preview')) return 'preview'
  if (hash.startsWith('#/feed')) return 'feed'
  if (hash.startsWith('#/detail/')) return 'detail'
  return 'compose'
}

function readDetailId() {
  return location.hash.startsWith('#/detail/')
    ? decodeURIComponent(location.hash.slice('#/detail/'.length))
    : ''
}

function navigate(screen, id = '') {
  location.hash = screen === 'detail' ? `#/detail/${encodeURIComponent(id)}` : `#/${screen}`
}

function bodyText(value) {
  return String(value || '')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ')
}

function firstParagraph(value) {
  return String(value || '')
    .replace(/\r/g, '')
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.split('\n').map((line) => line.trim()).filter(Boolean).join(' '))
    .find(Boolean) || ''
}

function coverText(value) {
  const characters = Array.from(firstParagraph(value))
  return characters.length > 64 ? `${characters.slice(0, 63).join('')}…` : characters.join('')
}

function coverSize(value) {
  const length = Array.from(firstParagraph(value)).length
  if (length <= 20) return 'cover-text--large'
  if (length <= 40) return 'cover-text--medium'
  return 'cover-text--small'
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function renderThemePicker() {
  return `
    <div class="theme-picker" role="radiogroup" aria-label="文字封面主题">
      ${themes.map((theme) => `
        <button
          type="button"
          class="theme-option ${state.draft.theme === theme.id ? 'is-active' : ''}"
          data-theme="${theme.id}"
          data-testid="theme-${theme.id}"
          role="radio"
          aria-checked="${state.draft.theme === theme.id}"
          tabindex="${state.draft.theme === theme.id ? '0' : '-1'}"
        >
          <span class="theme-swatch text-theme--${theme.id}">
            ${theme.id === 'notice' ? '<span class="cover-notice-label">通知公告</span>' : ''}
            ${theme.id === 'quote' ? '<span class="theme-quote-mark">“</span>' : ''}
            <span>${theme.sample}</span>
          </span>
          <span class="theme-name">${theme.name}</span>
        </button>
      `).join('')}
    </div>
  `
}

function renderTextCover(post, className = '') {
  const theme = normalizeTheme(post.theme)
  const title = String(post.title || '').trim() || '邻里随手记'
  const text = coverText(post.body) || '把想说的话写在这里'
  return `
    <div class="text-cover text-theme--${theme} ${className}" data-testid="text-cover">
      <div class="text-cover-rule" aria-hidden="true"></div>
      ${theme === 'notice' ? '<span class="cover-notice-label">通知公告</span>' : ''}
      ${theme === 'quote' ? '<span class="cover-quote-mark" aria-hidden="true">“</span>' : ''}
      <strong class="cover-title">${escapeHtml(title)}</strong>
      <p class="cover-text ${coverSize(post.body)}">${escapeHtml(text)}</p>
      <span class="cover-signature">邻里随手记</span>
    </div>
  `
}

function renderTopbar({ title, leftLabel = '', leftAction = '', rightLabel = '', rightAction = '' }) {
  return `
    <header class="page-topbar">
      <button class="topbar-action topbar-action--left" type="button" ${leftAction ? `data-action="${leftAction}"` : 'disabled'}>${leftLabel}</button>
      <h1>${title}</h1>
      <button class="topbar-action topbar-action--right" type="button" ${rightAction ? `data-action="${rightAction}"` : 'disabled'}>${rightLabel}</button>
    </header>
  `
}

function renderCompose() {
  const canContinue = state.draft.title.trim() && bodyText(state.draft.body)
  return `
    <div class="app-frame app-frame--compose">
      ${renderTopbar({ title: '邻里随手记', leftLabel: '取消', leftAction: 'feed' })}
      <main class="compose-content">
        <div class="compose-intro">
          <span>第一步</span>
          <p>先把想说的话写完整，下一步再选择文字封面。</p>
        </div>
        <section class="writing-surface">
          <label class="sr-only" for="title-input">标题</label>
          <input
            id="title-input"
            data-testid="title-input"
            class="title-input"
            type="text"
            maxlength="48"
            placeholder="写一个标题"
            value="${escapeHtml(state.draft.title)}"
          />
          <div class="writing-divider"></div>
          <label class="sr-only" for="body-input">正文</label>
          <textarea
            id="body-input"
            data-testid="body-input"
            class="body-input"
            placeholder="把今天想说的，认真写下来…"
          >${escapeHtml(state.draft.body)}</textarea>
          <div class="body-count"><span data-testid="body-count">${bodyText(state.draft.body).length}</span> 字</div>
        </section>

      </main>

      <footer class="action-dock">
        <button type="button" class="button button--secondary" data-action="save-draft">存草稿</button>
        <button type="button" class="button button--primary" data-action="preview" data-testid="next-button" ${canContinue ? '' : 'disabled'}>下一步</button>
      </footer>
    </div>
  `
}

function renderCard(post, { preview = false } = {}) {
  const cardLabel = `查看帖子：${post.title || '还没有标题'}`
  return `
    <article class="note-card ${preview ? 'note-card--preview' : ''}" ${preview ? '' : `data-post-id="${escapeHtml(post.id)}" data-testid="feed-card" tabindex="0" role="link" aria-label="${escapeHtml(cardLabel)}"`}>
      ${renderTextCover(post)}
      <div class="note-card-body">
        <h3>${escapeHtml(post.title || '还没有标题')}</h3>
        <div class="note-meta">
          <span class="author-avatar">${escapeHtml((post.author || '我').slice(0, 1))}</span>
          <span class="author-name">${escapeHtml(post.author || '我')}</span>
          <span class="note-time">${escapeHtml(post.when || '刚刚')}</span>
          <span class="note-likes">赞 ${Number(post.likes || 0)}</span>
        </div>
      </div>
    </article>
  `
}

function renderPreview() {
  const previewPost = {
    ...state.draft,
    id: 'preview',
    author: '我',
    when: '刚刚',
    likes: 0,
  }
  return `
    <div class="app-frame app-frame--preview">
      ${renderTopbar({ title: '选择文字封面', leftLabel: '返回修改', leftAction: 'compose' })}
      <main class="preview-content">
        <div class="preview-heading">
          <span>第二步</span>
          <h2>挑一个适合这段文字的封面</h2>
          <p>下面就是发布后的真实效果，点击样式即可切换。</p>
        </div>
        <div class="preview-card-wrap">${renderCard(previewPost, { preview: true })}</div>
        <section class="theme-section theme-section--preview">
          <div class="section-heading"><h2>封面样式</h2><span>左右滑动查看更多</span></div>
          ${renderThemePicker()}
        </section>
        ${renderPublishTools()}
      </main>
      <footer class="action-dock">
        <button type="button" class="button button--secondary" data-action="compose">返回修改</button>
        <button type="button" class="button button--primary" data-action="publish" data-testid="publish-button">发布</button>
      </footer>
      ${renderLocationSheet()}
      ${renderTopicSheet()}
    </div>
  `
}

function renderPublishTools() {
  return `<section class="publish-tools" aria-label="发布设置">${renderTopicTool()}${renderLocationTool()}</section>`
}

function renderTopicTool() {
  const topics = normalizeTopics(state.draft.topics)
  return `
    <div class="publish-tool-group topic-tool" data-testid="topic-tool">
      ${topics.length ? `<span class="topic-preview">#${escapeHtml(topics[0])}${topics.length > 1 ? ` <small>+${topics.length - 1}</small>` : ''}</span>` : ''}
      <button type="button" class="image-note-tool-pill" data-action="open-topic"><b>#</b><span>话题</span></button>
    </div>
  `
}

function renderLocationTool() {
  const selected = normalizeLocation(state.draft.location)
  return `
    <div class="location-tool image-note-tool-pill ${selected ? 'is-selected' : ''}" data-testid="location-tool">
      <button type="button" class="location-main" data-action="open-location"><span class="location-pin" aria-hidden="true"></span><span>${selected ? escapeHtml(selected.name) : '设置地点'}</span></button>
      ${selected ? '<button type="button" class="location-clear" data-action="clear-location" aria-label="删除地点">×</button>' : ''}
    </div>
  `
}

function renderTopicSheet() {
  if (!state.topicSheetOpen) return ''
  const topics = normalizeTopics(state.draft.topics)
  return `
    <div class="sheet-backdrop" data-action="close-topic" data-testid="topic-sheet">
      <section class="location-sheet topic-sheet" role="dialog" aria-modal="true" aria-labelledby="topic-title" data-sheet-panel>
        <div class="sheet-handle" aria-hidden="true"></div>
        <div class="sheet-title"><h2 id="topic-title">添加话题</h2><button type="button" class="sheet-done" data-action="close-topic">完成</button></div>
        ${topics.length ? `<div class="selected-topics">${topics.map((topic, index) => `<button type="button" data-topic-index="${index}">#${escapeHtml(topic)} <span>×</span></button>`).join('')}</div>` : ''}
        <div class="topic-input-row"><b>#</b><input id="topic-input" type="text" maxlength="20" value="${escapeHtml(state.topicDraft)}" placeholder="输入话题，最多20个字" /><button type="button" data-action="add-topic" ${topics.length >= MAX_TOPIC_COUNT ? 'disabled' : ''}>添加</button></div>
        <p class="topic-count">${topics.length}/${MAX_TOPIC_COUNT}</p>
      </section>
    </div>
  `
}

function renderLocationSheet() {
  if (!state.locationSheetOpen) return ''
  return `
    <div class="sheet-backdrop" data-action="close-location" data-testid="location-sheet">
      <section class="location-sheet" role="dialog" aria-modal="true" aria-labelledby="location-title" data-sheet-panel>
        <div class="sheet-handle" aria-hidden="true"></div>
        <div class="sheet-title"><div><h2 id="location-title">选择地点</h2><p>仅用于展示本次发布所在位置</p></div><button type="button" data-action="close-location" aria-label="关闭">×</button></div>
        <div class="location-list">
          ${locations.map((location) => `<button type="button" class="location-option ${state.draft.location?.id === location.id ? 'is-active' : ''}" data-location-id="${location.id}"><span class="location-pin" aria-hidden="true"></span><span><strong>${escapeHtml(location.name)}</strong><small>${escapeHtml(location.detail)}</small></span><i aria-hidden="true">${state.draft.location?.id === location.id ? '✓' : ''}</i></button>`).join('')}
        </div>
      </section>
    </div>
  `
}

function renderFeed() {
  const columns = [[], []]
  state.posts.forEach((post, index) => columns[index % 2].push(post))
  return `
    <div class="app-frame app-frame--feed">
      <header class="home-topbar">
        <div class="community-avatar">阳</div>
        <div class="community-copy">
          <strong>阳光花园社区</strong>
          <span>邻里发生的事，都在这里</span>
        </div>
        <button type="button" class="community-switch">切换</button>
      </header>
      <nav class="section-tabs" aria-label="社区板块">
        <button type="button">通知</button>
        <button type="button">公告</button>
        <button type="button" class="is-active">邻里随手记</button>
        <button type="button">闲置交易</button>
      </nav>
      <main class="feed-content">
        <div class="feed-title-row">
          <h1>邻里随手记</h1>
          <button type="button" data-action="compose">写一条</button>
        </div>
        <div class="waterfall" data-testid="waterfall">
          ${columns.map((column) => `<div class="waterfall-column">${column.map((post) => renderCard(post)).join('')}</div>`).join('')}
        </div>
        <p class="feed-end">— 社群 · 记忆在这里 —</p>
      </main>
      ${renderTabbar('home')}
    </div>
  `
}

function renderDetail() {
  const post = state.posts.find((item) => item.id === state.selectedPostId) || state.posts[0]
  if (!post) return renderFeed()
  return `
    <div class="app-frame app-frame--detail">
      ${renderTopbar({ title: '邻里随手记', leftLabel: '返回', leftAction: 'feed' })}
      <main class="detail-content">
        <div class="detail-author">
          <span class="detail-avatar">${escapeHtml(post.author.slice(0, 1))}</span>
          <div><strong>${escapeHtml(post.author)}</strong><span>${escapeHtml(post.when)} · 阳光花园社区</span></div>
        </div>
        <h1>${escapeHtml(post.title)}</h1>
        <div class="detail-body">${escapeHtml(post.body).replace(/\n/g, '<br />')}</div>
        ${renderDetailTopics(post)}
        ${renderDetailLocation(post)}
        <div class="detail-theme-line text-theme--${normalizeTheme(post.theme)}"></div>
        <div class="detail-actions"><span>赞 ${Number(post.likes || 0)}</span><span>评论 0</span></div>
      </main>
      ${renderTabbar('')}
    </div>
  `
}

function renderDetailTopics(post) {
  const topics = normalizeTopics(post.topics)
  return topics.length ? `<div class="detail-topics">${topics.map((topic) => `<span>#${escapeHtml(topic)}</span>`).join('')}</div>` : ''
}

function renderDetailLocation(post) {
  const selected = normalizeLocation(post.location)
  return selected ? `<div class="detail-location"><span class="location-pin" aria-hidden="true"></span><span>${escapeHtml(selected.name)}</span></div>` : ''
}

function renderTabbar(current) {
  return `
    <nav class="app-tabbar" aria-label="主导航">
      <button type="button" class="tab-item ${current === 'home' ? 'is-active' : ''}" data-action="feed">
        <span class="tab-icon tab-icon--home" aria-hidden="true"></span>
        <span>首页</span>
      </button>
      <button type="button" class="tab-create" data-action="compose" aria-label="发布">
        <span aria-hidden="true">+</span>
      </button>
      <button type="button" class="tab-item">
        <span class="tab-icon tab-icon--profile" aria-hidden="true">☺</span>
        <span>我的</span>
      </button>
    </nav>
  `
}

function render() {
  const app = document.querySelector('#app')
  if (state.screen === 'feed') app.innerHTML = renderFeed()
  else if (state.screen === 'preview') app.innerHTML = renderPreview()
  else if (state.screen === 'detail') app.innerHTML = renderDetail()
  else app.innerHTML = renderCompose()
  bindInteractions()
}

function bindInteractions() {
  document.querySelectorAll('[data-action]').forEach((element) => {
    element.addEventListener('click', () => handleAction(element.dataset.action))
  })

  document.querySelectorAll('[data-theme]').forEach((element) => {
    element.addEventListener('click', () => {
      state.draft.theme = normalizeTheme(element.dataset.theme)
      saveDraft()
      render()
      document.querySelector(`[data-theme="${state.draft.theme}"]`)?.focus()
    })
    element.addEventListener('keydown', (event) => {
      if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(event.key)) return
      event.preventDefault()
      const currentIndex = themes.findIndex((theme) => theme.id === element.dataset.theme)
      const direction = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1
      const nextTheme = themes[(currentIndex + direction + themes.length) % themes.length]
      document.querySelector(`[data-theme="${nextTheme.id}"]`)?.click()
    })
  })

  document.querySelectorAll('[data-location-id]').forEach((element) => {
    element.addEventListener('click', () => {
      const location = locations.find((item) => item.id === element.dataset.locationId)
      state.draft.location = normalizeLocation(location)
      state.locationSheetOpen = false
      saveDraft()
      render()
    })
  })

  document.querySelectorAll('[data-topic-index]').forEach((element) => {
    element.addEventListener('click', () => {
      state.draft.topics = normalizeTopics(state.draft.topics).filter((_topic, index) => index !== Number(element.dataset.topicIndex))
      saveDraft()
      render()
    })
  })

  const topicInput = document.querySelector('#topic-input')
  topicInput?.addEventListener('input', (event) => { state.topicDraft = String(event.target.value || '') })
  topicInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); handleAction('add-topic') }
  })

  document.querySelector('[data-sheet-panel]')?.addEventListener('click', (event) => event.stopPropagation())

  document.querySelectorAll('[data-post-id]').forEach((element) => {
    const open = () => navigate('detail', element.dataset.postId)
    element.addEventListener('click', open)
    element.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        open()
      }
    })
  })

  const titleInput = document.querySelector('#title-input')
  const bodyInput = document.querySelector('#body-input')
  if (titleInput) {
    titleInput.addEventListener('input', (event) => updateDraft('title', event.target.value))
  }
  if (bodyInput) {
    bodyInput.addEventListener('input', (event) => updateDraft('body', event.target.value))
  }
}

function updateDraft(key, value) {
  state.draft[key] = String(value || '')
  saveDraft()
  const count = document.querySelector('[data-testid="body-count"]')
  if (count && key === 'body') count.textContent = String(bodyText(state.draft.body).length)
  const next = document.querySelector('[data-testid="next-button"]')
  if (next) next.disabled = !(state.draft.title.trim() && bodyText(state.draft.body))
}

function handleAction(action) {
  if (action === 'compose') navigate('compose')
  if (action === 'feed') navigate('feed')
  if (action === 'preview' && state.draft.title.trim() && bodyText(state.draft.body)) navigate('preview')
  if (action === 'save-draft') {
    saveDraft()
    showToast('草稿已保存在本次浏览中')
  }
  if (action === 'publish') publishDraft()
  if (action === 'open-location') {
    state.locationSheetOpen = true
    render()
  }
  if (action === 'close-location') {
    state.locationSheetOpen = false
    render()
  }
  if (action === 'clear-location') {
    state.draft.location = null
    saveDraft()
    render()
  }
  if (action === 'open-topic') {
    state.topicSheetOpen = true
    render()
    document.querySelector('#topic-input')?.focus()
  }
  if (action === 'close-topic') {
    state.topicSheetOpen = false
    state.topicDraft = ''
    render()
  }
  if (action === 'add-topic') {
    const topic = Array.from(state.topicDraft.replace(/^#+/, '').trim()).slice(0, 20).join('')
    if (!topic) return showToast('请输入话题')
    state.draft.topics = normalizeTopics([...normalizeTopics(state.draft.topics), topic])
    state.topicDraft = ''
    saveDraft()
    render()
    document.querySelector('#topic-input')?.focus()
  }
}

function publishDraft() {
  const post = {
    id: `local-${Date.now()}`,
    title: state.draft.title.trim(),
    body: state.draft.body.trim(),
    theme: normalizeTheme(state.draft.theme),
    location: normalizeLocation(state.draft.location),
    topics: normalizeTopics(state.draft.topics),
    author: '我',
    when: '刚刚',
    likes: 0,
  }
  state.posts = [post, ...state.posts]
  savePosts()
  state.draft = { title: '', body: '', theme: THEME_FALLBACK, location: null, topics: [] }
  saveDraft()
  sessionStorage.setItem('hh-text-note-just-published', post.id)
  navigate('feed')
  setTimeout(() => showToast('发布成功'), 80)
}

let toastTimer = 0
function showToast(message) {
  const toast = document.querySelector('#toast')
  toast.textContent = message
  toast.classList.add('is-visible')
  clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 1800)
}

window.addEventListener('hashchange', () => {
  state.screen = routeFromHash()
  state.selectedPostId = readDetailId()
  render()
})

if (!location.hash) location.hash = '#/compose'
render()
