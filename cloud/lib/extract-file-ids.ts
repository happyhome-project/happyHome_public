import type { PostContent } from '../shared/types'

const CLOUD_PROTOCOL = 'cloud://'

function pushIfCloud(target: string[], value: unknown) {
  if (typeof value === 'string' && value.startsWith(CLOUD_PROTOCOL) && !target.includes(value)) {
    target.push(value)
  }
}

function extractImageSrcs(html: string): string[] {
  const srcs: string[] = []
  const imgPattern = /<img\b[^>]*\bsrc\s*=\s*(['"])(.*?)\1[^>]*>/gi
  let match: RegExpExecArray | null
  while ((match = imgPattern.exec(html))) {
    srcs.push(match[2])
  }
  return srcs
}

function extractMarkdownImageSrcs(markdown: string): string[] {
  const srcs: string[] = []
  const imgPattern = /!\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/g
  let match: RegExpExecArray | null
  while ((match = imgPattern.exec(markdown))) {
    srcs.push(String(match[1] || '').trim())
  }
  return srcs
}

/**
 * 从 PostContent 中提取所有 cloud:// 协议的 fileID。
 * 涵盖：
 *  - image_group: string[] of fileID
 *  - video_group: VideoItem[] —— item.fileID（cos source）+ item.cover（任意 source 的封面）
 *  - 未来其他 widget 中的 cloud:// 字符串
 */
export function extractCloudFileIDsFromContent(content: PostContent | undefined | null): string[] {
  const fileIDs: string[] = []
  if (!content || typeof content !== 'object') return fileIDs
  for (const value of Object.values(content)) {
    if (typeof value === 'string') {
      pushIfCloud(fileIDs, value)
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string') {
          pushIfCloud(fileIDs, item)
        } else if (item && typeof item === 'object') {
          pushIfCloud(fileIDs, (item as any).cover)
          pushIfCloud(fileIDs, (item as any).fileID)
        }
      }
    } else if (value && typeof value === 'object') {
      const richNote = value as any
      if (Array.isArray(richNote.imageFileIDs)) {
        for (const fileID of richNote.imageFileIDs) pushIfCloud(fileIDs, fileID)
      }
      if (typeof richNote.html === 'string') {
        for (const src of extractImageSrcs(richNote.html)) pushIfCloud(fileIDs, src)
      }
      if (typeof richNote.markdown === 'string') {
        for (const src of extractMarkdownImageSrcs(richNote.markdown)) pushIfCloud(fileIDs, src)
      }
    }
  }
  return fileIDs
}
