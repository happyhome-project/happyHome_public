import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

const read = (...parts: string[]) => readFileSync(join(process.cwd(), 'src', ...parts), 'utf8')

describe('archive publishing entry', () => {
  test('uses a controlled custom navigation bar on create', () => {
    const pages = read('pages.json')
    const create = read('pages', 'create', 'index.vue')
    const createPage = JSON.parse(pages).pages.find((page: any) => page.path === 'pages/create/index')
    expect(createPage?.style?.navigationStyle).toBe('custom')
    expect(create).toContain('class="create-custom-nav"')
    expect(create).toContain('@tap="handlePageExit"')
    expect(create).toContain('env(safe-area-inset-top)')
    expect(create).toContain('navigateBackOrHome')
    expect(create).toContain(':style="createCustomNavStyle"')
    expect(create).toContain('{{ createNavTitle }}')
    expect(create).toContain('computeCreateNavMetrics')
    expect(create).toContain('resolveCreateNavTitle')
    expect(create).toContain('isEditMode: isEditMode.value')
  })
  test('keeps archive topic navigation on the shared page background', () => {
    const source = read('components', 'ArchiveTopicTabs.vue')
    const rule = source.match(/\.archive-topic-tabs\s*\{([^}]*)\}/s)?.[1] || ''
    expect(rule).not.toMatch(/(?:^|\s)background\s*:/)
  })

  test('offers one image/video media choice plus text and collaboration', () => {
    const source = read('components', 'AppTabBar.vue')
    expect(source).toContain("{ key: 'media', label: '发图片/视频', icon: '/static/publish-icons/trade.svg', tone: 'image-text' }")
    expect(source).toContain("{ key: 'text', label: '写文字', icon: '/static/publish-icons/lost.svg', tone: 'text' }")
    expect(source).toContain("{ key: 'collaboration', label: '发起协作', icon: '/static/publish-icons/neighbor.svg', tone: 'collaboration' }")
    expect(source).toContain("mediaType: ['image', 'video']")
    expect(source).toContain('accept="image/*,video/*"')
    expect(source).toContain('detectFirstMediaType')
    expect(source).toContain('storeArchiveMediaIntent')
    expect(source).toContain("if (props.current === 'create')")
    expect(source).toContain("type AppTabBarCurrent = AppTabKey | 'create'")
    expect(source).toContain("emit('media-selected', token)")
    expect(source).toContain('source: file')
    expect(source).not.toContain('source: URL.createObjectURL(file)')
    expect(source).toContain('fail: () =>')
    expect(source).toContain('discardArchiveMediaIntent(token)')
    expect(source).toContain(':src="option.icon"')
    expect(source).toContain(':class="`publish-icon--${option.tone}`"')
    expect(source).not.toContain('publish-icon-glyph')
    expect(source).not.toContain('option.glyph')
    expect(source).not.toContain('activePublishSections')
    expect(source).not.toContain('option.section')
  })

  test('confirms and clears an existing media format before an inline create-page switch', () => {
    const create = read('pages', 'create', 'index.vue')
    expect(create).toContain('@media-selected="handleInlineMediaIntent"')
    expect(create).toContain('transitionArchiveMediaEditorState')
    expect(create).toContain('hasArchiveMedia')
    expect(create).toContain('切换后将清空当前素材')
    expect(create).toContain('enterArchiveEditor(nextFormat')
    expect(create).toContain('applyArchiveMediaIntent(token)')
    expect(create).toContain('restoreArchiveMediaEditor')
    expect(create).toMatch(/handleBackToSectionPicker[\s\S]*archiveFormat\.value === 'image_text'[\s\S]*selectedSection\.value = null[\s\S]*return/)
  })

  test('create page owns a video archive editor without unlocking ordinary admin media widgets', () => {
    const create = read('pages', 'create', 'index.vue')
    const widgetEditor = read('components', 'widgets', 'WidgetEditor.vue')
    const videoEditor = read('components', 'widgets', 'VideoPublishEditor.vue')

    expect(create).toContain("const archiveFormat = ref<'image_text' | 'text' | 'video' | ''>('')")
    expect(create).toContain("widgetId: 'archive_video_videos'")
    expect(create).toContain("fieldKey: 'videos'")
    expect(create).toContain("type: 'video_group'")
    expect(create).toContain('<VideoPublishEditor')
    expect(create).toContain("archiveFormat.value === 'video'")
    expect(widgetEditor).toContain("widget.type === 'video_group' || widget.type === 'audio_group'")
    expect(videoEditor).toContain('requestMemberVideoUpload')
    expect(videoEditor).toContain('requestMemberVideoCoverUpload')
    expect(videoEditor).toContain('uploadCloudFile')
    expect(videoEditor).toContain('onProgress')
    expect(videoEditor).toContain('重试')
    expect(videoEditor).toContain('移除失败封面')
    expect(videoEditor).toContain("emit('readiness'")
    expect(videoEditor).toContain('shouldConsumeInitialVideo')
    expect(videoEditor).toContain("emit('initial-state', 'pending',")
    expect(videoEditor).toContain("emit('initial-state', 'failed',")
    expect(videoEditor).toContain("emit('initial-state', 'resolved',")
    expect(videoEditor).toContain("emit('selected-file'")
    expect(videoEditor).toContain("emit('navigation-blocked', true)")
    expect(videoEditor).toContain("emit('navigation-blocked', false)")
    const acceptVideoBlock = videoEditor.slice(
      videoEditor.indexOf('async function acceptVideo'),
      videoEditor.indexOf('function startVideoUpload'),
    )
    expect(acceptVideoBlock).toMatch(/uploadGeneration \+= 1[\s\S]*coverPending\.value = false[\s\S]*emit\('navigation-blocked', false\)/)
    expect(videoEditor).toContain('isVideoUploadResultCurrent')
    expect(videoEditor).toContain('releasePreview(previewSource.value)')
    expect(videoEditor).toContain('releasePreview(coverPreview.value)')
    expect(create).toContain('archiveVideoIntentState')
    expect(create).toContain('@initial-state="handleVideoInitialState"')
    expect(create).toContain('@selected-file="handleVideoSelectedFile"')
    expect(create).toContain('reduceArchiveVideoRetention')
    expect(create).toContain('@navigation-blocked="videoNavigationBlocked = $event"')
    expect(create).toContain('请重试或移除失败封面')
    expect(create).toContain('@readiness="videoPublishReady = $event.ready"')
    expect(create).toContain(':disabled="submitting || !videoPublishReady"')
    expect(create).toContain("requestedArchiveFormat === 'image_text' || requestedArchiveFormat === 'text' || requestedArchiveFormat === 'video'")
    expect(create).toContain('onBackPress(')
    expect(create).toContain("window.addEventListener('beforeunload'")
    const coverUpload = videoEditor.slice(videoEditor.indexOf('async function uploadCover'), videoEditor.indexOf('function publishModel'))
    expect(coverUpload.indexOf('validateVideoCoverFile')).toBeLessThan(coverUpload.indexOf('requestMemberVideoCoverUpload'))
  })

  test('isolates archive drafts by community and format', () => {
    const create = read('pages', 'create', 'index.vue')
    expect(create).toContain('createDraftStorageKey')
    expect(create).toContain('communityStore.currentCommunityId')
    expect(create).toContain('archiveFormat.value')
    expect(create).toContain('restoreDraft')
  })

  test('keeps the publish button free of a tinted outer shadow', () => {
    const source = read('components', 'AppTabBar.vue')
    const pillRule = source.match(/\.fab-pill\s*\{([^}]*)\}/s)?.[1] || ''

    expect(pillRule).not.toMatch(/box-shadow\s*:/)
  })

  test('archive editors submit without a section while collaboration filters realtime sections', () => {
    const create = read('pages', 'create', 'index.vue')
    expect(create).toContain('postApi.createArchive({')
    expect(create).toContain("area: 'archive'")
    expect(create).toContain("section?.type === 'realtime'")
  })

  test('enters an archive editor before the first asynchronous create-page load', () => {
    const create = read('pages', 'create', 'index.vue')
    const onLoadStart = create.indexOf('onLoad(async (options: any) => {')
    const firstAwait = create.indexOf('await ensureSectionsLoaded()', onLoadStart)
    const archiveEditor = create.indexOf('enterArchiveEditor(requestedArchiveFormat', onLoadStart)

    expect(onLoadStart).toBeGreaterThanOrEqual(0)
    expect(archiveEditor).toBeGreaterThan(onLoadStart)
    expect(archiveEditor).toBeLessThan(firstAwait)
    expect(create).not.toContain('检查社区成员身份中')
    expect(create).not.toContain('memberApi.myStatus(')
  })

  test('native archive detail builds a virtual renderer while legacy section posts keep section loading', () => {
    const detail = read('pages', 'detail', 'index.vue')
    const adapter = read('utils', 'archive-detail.ts')
    expect(detail).toContain("post.value?.area === 'archive' && !post.value?.sectionId")
    expect(detail).toContain('buildNativeArchiveDetailSection')
    expect(detail).toContain("from '../../utils/archive-detail'")
    expect(adapter).toContain('image_note_images: content.images')
    expect(adapter).toContain('image_note_topics: currentPost.topics || []')
    expect(detail).toContain("sectionApi.get(post.value.sectionId")
  })

  test('topic switching invalidates stale archive requests', () => {
    const home = read('pages', 'index', 'index.vue')
    expect(home).toContain('const requestEpoch = ++archiveRequestEpoch')
    expect(home).toContain('requestEpoch !== archiveRequestEpoch')
  })
})
