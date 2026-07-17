export type ArchiveFeedCard = {
  postId: string
  format: 'image_text' | 'text' | 'video'
  title: string
  topics: string[]
  authorName: string
  createdAt: string
  cover:
    | { kind: 'image'; src: string }
    | { kind: 'text'; theme: string }
    | { kind: 'video'; src: string }
  estimatedHeight: number
  post: Record<string, any>
}

export type ArchiveFeedColumns = [ArchiveFeedCard[], ArchiveFeedCard[]]

export type ArchiveFeedPage = {
  posts: Record<string, any>[]
  nextCursor: string
  hasMore: boolean
}

const TEXT_THEMES = ['paper', 'mint', 'slate', 'headline', 'quote', 'notice'] as const

function stableTheme(postId: string): string {
  let hash = 0
  for (const character of postId) hash = ((hash * 31) + character.charCodeAt(0)) >>> 0
  return TEXT_THEMES[hash % TEXT_THEMES.length]
}

export function normalizeArchiveCard(post: Record<string, any>): ArchiveFeedCard {
  const postId = String(post?._id || '')
  const images = Array.isArray(post?.content?.images) ? post.content.images.filter(Boolean).map(String) : []
  const videos = Array.isArray(post?.content?.videos) ? post.content.videos : []
  const videoCover = String(videos.find((item: any) => item && typeof item === 'object')?.cover || '').trim()
  const format: ArchiveFeedCard['format'] = post?.format === 'video'
    ? 'video'
    : post?.format === 'image_text' && images.length
      ? 'image_text'
      : 'text'
  const cover: ArchiveFeedCard['cover'] = format === 'video'
    ? { kind: 'video', src: videoCover }
    : format === 'image_text'
      ? { kind: 'image', src: images[0] }
      : { kind: 'text', theme: String(post?.presentation?.textNoteTheme || stableTheme(postId)) }
  return {
    postId,
    format,
    title: String(post?.content?.title || '邻里记录').trim() || '邻里记录',
    topics: Array.isArray(post?.topics) ? post.topics.filter(Boolean).map(String) : [],
    authorName: String(post?.author?.nickName || post?.authorName || '邻居'),
    createdAt: String(post?.createdAt || ''),
    cover,
    estimatedHeight: cover.kind === 'text' ? 220 : 300,
    post,
  }
}

function columnHeight(column: ArchiveFeedCard[]): number {
  return column.reduce((total, card) => total + card.estimatedHeight, 0)
}

export function appendArchivePage(
  columns: ArchiveFeedColumns,
  posts: Record<string, any>[],
): ArchiveFeedColumns {
  const result: ArchiveFeedColumns = [columns[0].slice(), columns[1].slice()]
  const seen = new Set(result.flat().map(card => card.postId))
  for (const post of posts) {
    const card = normalizeArchiveCard(post)
    if (!card.postId || seen.has(card.postId)) continue
    seen.add(card.postId)
    const target = columnHeight(result[0]) <= columnHeight(result[1]) ? result[0] : result[1]
    target.push(card)
  }
  return result
}
