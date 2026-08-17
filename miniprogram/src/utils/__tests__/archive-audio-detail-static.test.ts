import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

function projectPath(relativePath: string) {
  return resolve(process.cwd(), relativePath)
}

function source(relativePath: string) {
  return readFileSync(projectPath(relativePath), 'utf8')
}

describe('native archive audio detail presentation', () => {
  test('routes native audio to its dedicated view before the generic detail renderer', () => {
    const detailPage = source('src/pages/detail/index.vue')
    expect(detailPage).toContain("import AudioPostDetailView from '../../components/AudioPostDetailView.vue'")
    expect(detailPage).toContain('isNativeArchiveAudioDetail')
    expect(detailPage).toMatch(/<AudioPostDetailView[\s\S]*?v-if="isNativeArchiveAudioDetail"[\s\S]*?<DefaultDetailView[\s\S]*?v-else/)
    expect(detailPage).toContain(':post="post"')
    expect(detailPage).toContain(':resolved-covers="resolvedDetailMediaUrls"')
    expect(detailPage).toContain('!isNativeArchiveAudioDetail')
  })

  test('renders the approved order through the track list and nothing below it', () => {
    const path = projectPath('src/components/AudioPostDetailView.vue')
    expect(existsSync(path)).toBe(true)
    const component = readFileSync(path, 'utf8')
    const orderedMarkers = [
      'audio-post-detail__title',
      'audio-post-detail__author',
      'audio-post-detail__cover',
      'audio-post-detail__current-title',
      'audio-post-detail__controls',
      'audio-post-detail__progress',
      'audio-post-detail__tracks',
    ]
    const positions = orderedMarkers.map(marker => component.indexOf(marker))
    expect(positions.every(position => position >= 0)).toBe(true)
    expect(positions).toEqual(positions.slice().sort((left, right) => left - right))
    expect(component).toContain('<wd-slider')
    expect(component).toContain('@update:model-value="handleSeek"')
    expect(component).not.toContain('@change="handleSeek"')
    for (const icon of ['previous', 'play-circle', 'pause', 'next', 'sound']) {
      expect(component).toContain(`name="${icon}"`)
    }
  })

  test('uses the existing audio store with canonical tracks and has no forbidden travel or activity modules', () => {
    const path = projectPath('src/components/AudioPostDetailView.vue')
    expect(existsSync(path)).toBe(true)
    const component = readFileSync(path, 'utf8')
    expect(component).toContain('useAudioStore')
    expect(component).toContain('toAudioPlayerTracks')
    expect(component).toContain('audioStore.playPlaylist(audioTracks.value')
    expect(component).not.toContain('resolvedCovers.value')
    for (const forbidden of [
      '媒体资料', '距离', '海拔', '爬升', '参考用时', '位置', '导航',
      'route', 'attendance', 'activity-invite', 'activityInvite',
    ]) {
      expect(component).not.toContain(forbidden)
    }
  })
})
