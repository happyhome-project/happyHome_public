import { existsSync, readFileSync, readdirSync } from 'node:fs'
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
    expect(component).toContain('<slider')
    expect(component).toContain('@change="handleSeek"')
    expect(component).not.toContain('@changing="handleSeek"')
    expect(component).not.toContain('<wd-slider')
    expect(component).not.toContain('@dragend="handleSeek"')
    expect(component).not.toContain('@update:model-value="handleSeek"')
    expect(component).toContain('const raw = event?.detail?.value')
    expect(component).toContain('<AudioIcon')
    expect(component).not.toContain('<wd-icon')
    for (const icon of ['previous', 'play-circle', 'pause', 'next', 'chart-bar']) {
      expect(component).toContain(`name="${icon}"`)
    }
    expect(component).not.toContain('v-if="index === activeIndex && isPlaying"\n          name="sound"')
  })

  test('keeps audio source and fresh mp output free of Wot runtime components and HTTP fonts', () => {
    for (const relativePath of [
      'src/components/ArchiveWaterfall.vue',
      'src/components/AuthorPostColumns.vue',
      'src/components/AudioPostDetailView.vue',
    ]) {
      expect(source(relativePath)).not.toMatch(/<wd-(?:icon|slider)\b/)
    }

    const compiledRoot = projectPath('dist/build/mp-weixin/node-modules')
    if (existsSync(compiledRoot)) {
      const compiledFiles = readdirSync(compiledRoot, { recursive: true, encoding: 'utf8' })
      expect(compiledFiles.some(relativePath => relativePath.replaceAll('\\', '/').includes('wot-design-uni/'))).toBe(false)
      for (const relativePath of compiledFiles.filter(relativePath => relativePath.endsWith('.wxss'))) {
        const contents = readFileSync(resolve(compiledRoot, relativePath), 'utf8')
        expect(contents, relativePath).not.toMatch(/@font-face\s*\{[^}]*url\(\s*['"]?https?:\/\//i)
      }
    }
  })

  test('avoids source constructs rejected by the mp critical-runtime scanner', () => {
    const files = [
      'src/components/widgets/AudioPublishEditor.vue',
      'src/store/audio.ts',
      'src/utils/archive-feed.ts',
      'src/utils/audio-display.ts',
      'src/utils/audio-publish.ts',
      'src/utils/author-post-feed.ts',
    ]
    for (const relativePath of files) {
      const contents = source(relativePath)
      expect(contents, relativePath).not.toMatch(/Array\.from\(/)
      expect(contents, relativePath).not.toMatch(/\{\s*\.\.\.[A-Za-z_$]/)
      expect(contents, relativePath).not.toMatch(/\[\s*\.\.\.[A-Za-z_$]/)
    }
    expect(source('src/components/widgets/AudioPublishEditor.vue')).not.toMatch(
      /watch\(\(\)\s*=>\s*\[[^\]]+\][\s\S]*?,\s*\(\s*\[/,
    )
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
