import { describe, expect, test } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

describe('home archive topic switch performance', () => {
  test('does not block a topic switch on reloading the already-mounted tabs', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../pages/index/index.vue'), 'utf8')
    const handler = source.match(/function selectArchiveTopic\(topicKey: string\) \{([\s\S]*?)\n\}/)?.[1] || ''

    expect(handler).toContain('selectedArchiveTopic.value = topicKey')
    expect(handler).toContain('refreshTabs: false')
    expect(handler).not.toContain('void loadArchiveFeed(true)')
  })

  test('commits the returned cards before resolving remote cover URLs', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../pages/index/index.vue'), 'utf8')
    const loader = source.match(/async function loadArchiveFeed\([\s\S]*?\n\}\n\nfunction selectArchiveTopic/)?.[0] || ''

    expect(loader).not.toContain('await resolveFeedCovers(')
    expect(loader.indexOf('archiveColumns.value = nextArchiveColumns')).toBeGreaterThan(-1)
    expect(loader.indexOf('archiveColumns.value = nextArchiveColumns')).toBeLessThan(loader.indexOf('resolveFeedCovers('))
  })

  test('restores a visited topic from a first-page cache before refreshing it', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../pages/index/index.vue'), 'utf8')
    const handler = source.match(/function selectArchiveTopic\(topicKey: string\) \{([\s\S]*?)\n\}/)?.[1] || ''

    expect(handler).toContain('archiveFirstPageCache.get(')
    expect(handler).toContain('archiveViewerCacheScope()')
    expect(handler.indexOf('archiveColumns.value = cached.columns')).toBeLessThan(handler.indexOf('loadArchiveFeed('))
  })
})
