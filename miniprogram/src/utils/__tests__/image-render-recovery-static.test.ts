import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

const home = readFileSync(resolve(process.cwd(), 'src/pages/index/index.vue'), 'utf8')
const detail = readFileSync(resolve(process.cwd(), 'src/pages/detail/index.vue'), 'utf8')
const waterfall = readFileSync(resolve(process.cwd(), 'src/components/ArchiveWaterfall.vue'), 'utf8')
const imageNote = readFileSync(resolve(process.cwd(), 'src/components/ImageNoteDetailView.vue'), 'utf8')

describe('recoverable image rendering contract', () => {
  test('home covers replace failed images with a placeholder and force-refresh the canonical file', () => {
    expect(waterfall).toContain('@error="$emit(\'cover-error\', card)"')
    expect(waterfall).toContain('archive-waterfall__image-placeholder')
    expect(home).toContain('@cover-error="onArchiveCoverError"')
    expect(home).toContain('await refreshCloudFileUrl(source)')
  })

  test('image-note detail reports failed media and remounts after a forced refresh', () => {
    expect(detail).toContain('v-if="post && section"')
    expect(detail).not.toContain('post && section && !detailMediaResolving')
    expect(imageNote).toContain('v-for="(item, index) in media"')
    expect(imageNote).toContain(':src="item.src"')
    expect(imageNote).not.toContain(':src="item.source"')
    expect(imageNote).toContain('@error="onImageError(item.source, index)"')
    expect(imageNote).toContain('image-note-image-fallback')
    expect(imageNote).toContain("(event: 'media-error', source: string): void")
    expect(detail).toContain('@media-error="onDetailMediaError"')
    expect(detail).toContain('await refreshCloudFileUrl(source)')
    expect(detail).toContain(':key="`image-note-${detailMediaRecoveryVersion}`"')
  })
})
