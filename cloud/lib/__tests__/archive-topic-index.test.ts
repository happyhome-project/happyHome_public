import { archivePostTopicId, buildArchiveSortKey, buildPinnedArchiveSortKey } from '../archive-topic-index'

test('archive post topic ids are deterministic and topic-specific', () => {
  expect(archivePostTopicId('post-1', '亲子')).toBe(archivePostTopicId('post-1', '亲子'))
  expect(archivePostTopicId('post-1', '亲子')).not.toBe(archivePostTopicId('post-1', '闲置'))
  expect(archivePostTopicId('post-1', '亲子')).toMatch(/^apt_[a-f0-9]{40}$/)
})

test('archive sort keys order equal timestamps by post id', () => {
  expect(buildArchiveSortKey('2026-07-14T12:00:00.000Z', 'post-b'))
    .toBe('2026-07-14T12:00:00.000Z_post-b')
})

test('pinned archive sort keys sort above creation-time keys in descending queries', () => {
  const pinned = buildPinnedArchiveSortKey('2026-01-01T00:00:00.000Z', 'post-old')
  const newestNormal = buildArchiveSortKey('2099-12-31T23:59:59.999Z', 'post-new')

  expect([newestNormal, pinned].sort().reverse()).toEqual([pinned, newestNormal])
})
