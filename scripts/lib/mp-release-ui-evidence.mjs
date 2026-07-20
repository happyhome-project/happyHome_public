const RELEASE_PAGE_TEXT_ROOTS = [
  'page',
  '.phone-inner',
  '.profile-page',
  'view',
]

export async function readReleasePageText(page) {
  for (const selector of RELEASE_PAGE_TEXT_ROOTS) {
    const root = await page.$(selector).catch(() => null)
    if (!root) continue
    const text = String(await root.text().catch(() => '') || '')
    if (text.trim()) return text
  }
  return ''
}

export async function readReleasePageWxml(page) {
  for (const selector of RELEASE_PAGE_TEXT_ROOTS) {
    const root = await page.$(selector).catch(() => null)
    if (!root) continue
    const wxml = String(await root.wxml().catch(() => '') || '')
    if (wxml.trim()) return wxml
  }
  return ''
}

function countClassToken(wxml, token) {
  return [...String(wxml || '').matchAll(/class="([^"]*)"/g)]
    .filter((match) => String(match[1] || '').split(/\s+/).includes(token))
    .length
}

export function summarizeReleaseArchiveWxml(wxml) {
  const source = String(wxml || '')
  const activeTabTexts = [...source.matchAll(
    /<view\b[^>]*class="[^"]*\barchive-topic-tab--active\b[^"]*"[^>]*>[\s\S]*?<text\b[^>]*>([^<]*)<\/text>[\s\S]*?<\/view>/g,
  )].map((match) => String(match[1] || '').trim()).filter(Boolean)
  return {
    source: 'flattened-wxml',
    tabCount: countClassToken(source, 'archive-topic-tab'),
    activeTabCount: countClassToken(source, 'archive-topic-tab--active'),
    activeTabTexts,
    cardCount: countClassToken(source, 'archive-waterfall__card'),
  }
}

export function resolveCompiledComponentEventHandler({
  compiledWxml,
  pageData,
  componentTag,
  eventName,
}) {
  const escapedTag = String(componentTag || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const escapedEvent = String(eventName || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const component = String(compiledWxml || '').match(new RegExp(`<${escapedTag}\\b[^>]*>`))?.[0] || ''
  const bindingKey = component.match(new RegExp(`\\bbind${escapedEvent}="{{([^}"]+)}}"`))?.[1] || ''
  const handler = String(pageData?.[bindingKey] || '')
  if (!bindingKey || !/^e\d+$/.test(handler)) {
    throw new Error(`compiled ${componentTag}/${eventName} runtime event handler is unavailable`)
  }
  return handler
}

export async function invokeCompiledComponentEvent({
  mp,
  page,
  compiledWxml,
  componentTag,
  eventName,
  args = [],
}) {
  const pageData = await page.data()
  const handler = resolveCompiledComponentEventHandler({
    compiledWxml,
    pageData,
    componentTag,
    eventName,
  })
  return await mp.evaluate((eventHandler, eventArgs) => {
    const current = getCurrentPages().slice(-1)[0]
    const callback = current?.[eventHandler]
    if (typeof callback !== 'function') {
      throw new Error(`compiled runtime event callback ${eventHandler} is not callable`)
    }
    return callback({ detail: { __args__: eventArgs } })
  }, handler, args)
}

export function hasReleaseHomeNavigationEvidence(evidence = {}) {
  return evidence.navigationEvidencePassed === true ||
    Number(evidence.appTabBarCount || 0) > 0 ||
    String(evidence.text || '').trim().endsWith('首页+我的')
}
