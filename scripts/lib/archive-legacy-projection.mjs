function clone(value) {
  return value == null ? value : structuredClone(value)
}

function widgets(section) {
  return Array.isArray(section?.widgets) ? section.widgets : []
}

function widgetValue(content, widget) {
  if (!widget?.widgetId) return undefined
  return content?.[widget.widgetId]
}

function firstWidget(content, section, predicate, excludedWidgetId) {
  return widgets(section).find((widget) => (
    widget?.widgetId !== excludedWidgetId
    && predicate(widget)
    && meaningful(widgetValue(content, widget))
  ))
}

function exactWidget(content, section, fieldKey) {
  return firstWidget(content, section, (widget) => String(widget?.fieldKey || '') === fieldKey)
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function canonicalImages(value) {
  if (!Array.isArray(value)) return []
  return value.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim())
}

function meaningful(value) {
  if (value === undefined || value === null) return false
  if (typeof value === 'string') return Boolean(value.trim())
  if (Array.isArray(value)) return value.some(meaningful)
  if (typeof value === 'object') return Object.values(value).some(meaningful)
  return true
}

function displayText(value) {
  if (typeof value === 'string') return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim()
  if (Array.isArray(value)) return value.map(displayText).filter(Boolean).join(' ').trim()
  if (value && typeof value === 'object') {
    const preferredKeys = ['text', 'title', 'markdown', 'html', 'content', 'value', 'children', 'blocks']
    const preferred = preferredKeys.map((key) => displayText(value[key])).filter(Boolean).join(' ').trim()
    if (preferred) return preferred
    return Object.values(value).map(displayText).filter(Boolean).join(' ').trim()
  }
  return value === undefined || value === null ? '' : String(value).trim()
}

function boundedTitle(value) {
  const text = displayText(value)
  return text.length > 60 ? `${text.slice(0, 60).trim()}…` : text
}

export function projectLegacyArchivePost(post, section) {
  if (
    post?.area !== 'archive'
    || post?.origin !== 'legacy_section'
    || !post?.sectionId
    || String(section?._id || '') !== String(post.sectionId)
    || section?.type === 'realtime'
  ) return null

  const originalContent = post.content && typeof post.content === 'object' && !Array.isArray(post.content)
    ? post.content
    : {}
  const titleWidget = exactWidget(originalContent, section, 'title')
    ?? firstWidget(originalContent, section, (widget) => /标题|名称|物品|一句话|title/i.test(String(widget?.label || '')))
    ?? firstWidget(originalContent, section, (widget) => ['short_text', 'summary'].includes(String(widget?.type || '')))
  const imagesWidget = exactWidget(originalContent, section, 'images')
    ?? firstWidget(originalContent, section, (widget) => ['image', 'image_group'].includes(String(widget?.type || '')))
  const bodyWidget = exactWidget(originalContent, section, 'body')
    ?? firstWidget(originalContent, section, (widget) => ['rich_note', 'rich_text', 'note_blocks', 'text'].includes(String(widget?.type || '')), titleWidget?.widgetId)
    ?? firstWidget(originalContent, section, (widget) => String(widget?.type || '') === 'summary', titleWidget?.widgetId)
  const locationWidget = exactWidget(originalContent, section, 'location')
    ?? firstWidget(originalContent, section, (widget) => String(widget?.type || '') === 'location')
  const legacyImages = widgetValue(originalContent, imagesWidget)
  const legacyBody = widgetValue(originalContent, bodyWidget)
  const legacyLocation = widgetValue(originalContent, locationWidget)
  const title = nonEmptyString(originalContent.title)
    ?? nonEmptyString(boundedTitle(widgetValue(originalContent, titleWidget)))
    ?? nonEmptyString(boundedTitle(legacyBody))
    ?? ''
  const images = canonicalImages(originalContent.images).length
    ? clone(originalContent.images)
    : canonicalImages(legacyImages)
  const body = meaningful(originalContent.body) ? clone(originalContent.body) : clone(legacyBody)
  const location = meaningful(originalContent.location) ? clone(originalContent.location) : clone(legacyLocation)
  if (!title && !images.length && !meaningful(body) && !meaningful(location)) return null
  const format = post.format === 'image_text' || post.format === 'text'
    ? post.format
    : images.length ? 'image_text' : 'text'
  const content = {
    ...clone(originalContent),
    title,
    images,
    ...(meaningful(body) ? { body } : {}),
    ...(meaningful(location) ? { location } : {}),
  }
  const after = { ...clone(post), format, content }
  const changed = post.format !== format || JSON.stringify(originalContent) !== JSON.stringify(content)
  return { changed, after }
}
