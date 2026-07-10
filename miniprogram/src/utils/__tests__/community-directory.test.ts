import { describe, expect, test } from 'vitest'
import {
  mergeCommunityDirectory,
  resolvedCommunityCoverUrl,
  singleLineCommunityText,
} from '../community-directory'

describe('mergeCommunityDirectory', () => {
  test('puts active joined communities first, restores joined state, and drops pending communities', () => {
    const joined = [
      { _id: 'joined', name: '明士班', status: 'active' },
    ] as any[]
    const directory = [
      { _id: 'available', name: '青山村', status: 'active', viewerStatus: null },
      { _id: 'joined', name: '明士班', status: 'active', viewerStatus: null },
      { _id: 'pending-created', name: 'test', status: 'pending', viewerStatus: 'creator-pending' },
    ] as any[]

    expect(mergeCommunityDirectory(joined, directory)).toEqual([
      { _id: 'joined', name: '明士班', status: 'active', viewerStatus: 'active' },
      { _id: 'available', name: '青山村', status: 'active', viewerStatus: null },
    ])
  })

  test('normalizes embedded newlines before one-line ellipsis rendering', () => {
    expect(singleLineCommunityText('第一行\n第二行\r\n第三行')).toBe('第一行 第二行 第三行')
  })

  test('does not render a cloud file id before its temporary URL is ready', () => {
    const fileId = 'cloud://env/community-cover.webp'

    expect(resolvedCommunityCoverUrl(fileId, {})).toBe('')
    expect(resolvedCommunityCoverUrl(fileId, { [fileId]: 'https://cdn.example.com/cover.webp' }))
      .toBe('https://cdn.example.com/cover.webp')
    expect(resolvedCommunityCoverUrl('https://cdn.example.com/direct.webp', {}))
      .toBe('https://cdn.example.com/direct.webp')
  })
})
