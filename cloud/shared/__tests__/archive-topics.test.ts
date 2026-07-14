import {
  decodeArchiveCursor,
  encodeArchiveCursor,
  normalizeArchiveTopic,
  selectArchiveTabs,
  type ArchiveTopicRecord,
} from '../archive-topics'

function topic(overrides: Partial<ArchiveTopicRecord>): ArchiveTopicRecord {
  return {
    communityId: 'community-1',
    topicKey: 'topic',
    displayName: '话题',
    origins: ['organic'],
    enabled: true,
    recentScore: 0,
    recentPostCount: 0,
    createdAt: '2026-07-14T00:00:00.000Z',
    updatedAt: '2026-07-14T00:00:00.000Z',
    ...overrides,
  }
}

test('normalizeArchiveTopic shares NFKC hash stripping and case-insensitive keys', () => {
  expect(normalizeArchiveTopic('  ## ＰＥＴ  ')).toEqual({ topicKey: 'pet', displayName: 'PET' })
  expect(() => normalizeArchiveTopic('')).toThrow('话题不能为空')
  expect(() => normalizeArchiveTopic('一'.repeat(21))).toThrow('每个话题不能超过 20 个字符')
})

test('selectArchiveTabs uses legacy then admin then activity and deduplicates normalized keys', () => {
  const selected = selectArchiveTabs([
    topic({ topicKey: 'pet', displayName: 'PET', origins: ['organic'], recentScore: 99 }),
    topic({ topicKey: '闲置', displayName: '闲置', origins: ['admin'], adminOrder: 2 }),
    topic({ topicKey: '亲子', displayName: '亲子', origins: ['legacy'], legacyOrder: 2 }),
    topic({ topicKey: '路线', displayName: '路线', origins: ['legacy', 'admin'], legacyOrder: 1, adminOrder: 1 }),
    topic({ topicKey: '宠物', displayName: '宠物', origins: ['organic'], recentScore: 8 }),
    topic({ topicKey: 'disabled', displayName: '隐藏', origins: ['legacy'], enabled: false, legacyOrder: 0 }),
  ], 4)

  expect(selected.map((item) => item.displayName)).toEqual(['路线', '亲子', '闲置', 'PET'])
})

test('archive cursor round-trips and rejects malformed input', () => {
  const cursor = encodeArchiveCursor({ sortKey: '2026-07-14T12:00:00.000Z_post-1', postId: 'post-1' })
  expect(decodeArchiveCursor(cursor)).toEqual({ sortKey: '2026-07-14T12:00:00.000Z_post-1', postId: 'post-1' })
  expect(decodeArchiveCursor('not-base64-json')).toBeNull()
  expect(decodeArchiveCursor('')).toBeNull()
})
