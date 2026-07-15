import { getImageNoteCard, isImageNoteSectionContract } from './image-note'
import { getTextNoteCard, normalizeTextNoteTheme } from './text-note'
import { getPostHomeTitle } from './widget'

export type AuthorPostCard = {
  postId: string
  title: string
  bodyText: string
  communityLabel: string
  cover: { kind: 'image'; src: string } | { kind: 'text'; theme: string }
  likeCount: number
  commentCount: number
  auditStatus: string
  estimatedHeight: number
  post: Record<string, any>
}

export type AuthorPostColumns = [AuthorPostCard[], AuthorPostCard[]]

function textFromRichNote(value: any): string {
  if (!value || typeof value !== 'object') return String(value || '').trim()
  return String(value.text || value.markdown || '').trim()
}

function firstImage(post: Record<string, any>, section: Record<string, any>): string {
  const widget = (section?.widgets || []).find((item: any) => item?.type === 'image_group')
  const images = widget ? post?.content?.[widget.widgetId] : null
  return Array.isArray(images) ? String(images.find(Boolean) || '') : ''
}

export function normalizeAuthorPostCard(post: Record<string, any>): AuthorPostCard {
  const postId = String(post?._id || '')
  const section = post?.section || {}
  const isArchive = post?.area === 'archive'
  let title = ''
  let bodyText = ''
  let coverImage = ''
  let theme = normalizeTextNoteTheme(post?.presentation?.textNoteTheme)

  if (isArchive) {
    title = String(post?.content?.title || '').trim()
    bodyText = textFromRichNote(post?.content?.body)
    const images = Array.isArray(post?.content?.images) ? post.content.images : []
    coverImage = String(images.find(Boolean) || '')
  } else if (isImageNoteSectionContract(section)) {
    const card = getImageNoteCard(post as any, section as any)
    title = card.title
    coverImage = card.coverImage
  } else if (post?.displayTemplate === 'text_note' || section?.displayTemplate === 'text_note') {
    const card = getTextNoteCard(post)
    title = card.title
    bodyText = card.body
    theme = card.theme
  } else {
    title = getPostHomeTitle(post as any, section as any)
    coverImage = firstImage(post, section)
  }

  const communityName = String(post?.communityName || '').trim()
  const sectionName = String(post?.sectionName || section?.name || '').trim()
  return {
    postId,
    title: title || '无标题',
    bodyText,
    communityLabel: [communityName, sectionName].filter(Boolean).join(' · '),
    cover: coverImage
      ? { kind: 'image', src: coverImage }
      : { kind: 'text', theme },
    likeCount: Math.max(0, Number(post?.likeCount || 0)),
    commentCount: Math.max(0, Number(post?.commentCount || 0)),
    auditStatus: String(post?.auditStatus || 'pass'),
    estimatedHeight: coverImage ? 330 : 260,
    post,
  }
}

function columnHeight(column: AuthorPostCard[]) {
  return column.reduce((total, card) => total + card.estimatedHeight, 0)
}

export function appendAuthorPosts(
  columns: AuthorPostColumns,
  posts: Record<string, any>[],
): AuthorPostColumns {
  const result: AuthorPostColumns = [columns[0].slice(), columns[1].slice()]
  const seen = new Set(result.flat().map(card => card.postId))
  for (const post of posts || []) {
    const card = normalizeAuthorPostCard(post)
    if (!card.postId || seen.has(card.postId)) continue
    seen.add(card.postId)
    const target = columnHeight(result[0]) <= columnHeight(result[1]) ? result[0] : result[1]
    target.push(card)
  }
  return result
}
