import { archivePostTopicId, buildArchiveSortKey } from '../archive-topic-index'

test('archive post topic ids are deterministic and topic-specific', () => {
  expect(archivePostTopicId('post-1', '亲子')).toBe(archivePostTopicId('post-1', '亲子'))
  expect(archivePostTopicId('post-1', '亲子')).not.toBe(archivePostTopicId('post-1', '闲置'))
  expect(archivePostTopicId('post-1', '亲子')).toMatch(/^apt_[a-f0-9]{40}$/)
})

test('archive sort keys order equal timestamps by post id', () => {
  expect(buildArchiveSortKey('2026-07-14T12:00:00.000Z', 'post-b'))
    .toBe('2026-07-14T12:00:00.000Z_post-b')
})
