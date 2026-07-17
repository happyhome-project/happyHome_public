import { describe, expect, test } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

describe('home archive topic switch continuity', () => {
  test('keeps the current cards mounted while a new topic is loading', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../pages/index/index.vue'), 'utf8')
    const handler = source.match(/function selectArchiveTopic\(topicKey: string\) \{([\s\S]*?)\n\}/)?.[1] || ''

    expect(handler).toContain('selectedArchiveTopic.value = topicKey')
    expect(handler).toContain('void loadArchiveFeed(true, { preserveVisible: true })')
    expect(handler).not.toContain('void loadArchiveFeed(true)')
  })
})
