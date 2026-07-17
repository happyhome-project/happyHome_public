import { describe, expect, test, vi } from 'vitest'
import {
  VIDEO_ALLOWED_EXTENSIONS,
  VIDEO_MAX_SIZE_BYTES,
  buildCosVideoItems,
  decideMediaTypeSwitch,
  detectFirstMediaType,
  normalizeChosenVideo,
} from '../video-publish'
import * as videoPublish from '../video-publish'

describe('member video selection', () => {
  test('supports mp4, mov, m4v, and webm up to 200 MiB', () => {
    expect(VIDEO_ALLOWED_EXTENSIONS).toEqual(['mp4', 'mov', 'm4v', 'webm'])
    expect(VIDEO_MAX_SIZE_BYTES).toBe(200 * 1024 * 1024)

    for (const extension of VIDEO_ALLOWED_EXTENSIONS) {
      expect(normalizeChosenVideo({
        tempFiles: [{
          tempFilePath: `wxfile://tmp/clip.${extension.toUpperCase()}`,
          size: VIDEO_MAX_SIZE_BYTES,
          duration: 12.5,
          thumbTempFilePath: 'wxfile://tmp/cover.jpg',
          fileType: 'video',
        }],
      })).toEqual({
        tempFilePath: `wxfile://tmp/clip.${extension.toUpperCase()}`,
        size: VIDEO_MAX_SIZE_BYTES,
        duration: 12.5,
        thumbTempFilePath: 'wxfile://tmp/cover.jpg',
        name: `clip.${extension.toUpperCase()}`,
        type: 'video',
      })
    }
  })

  test('normalizes uni chooseMedia fields and preserves an explicit file name', () => {
    expect(normalizeChosenVideo({
      tempFiles: [{
        path: 'blob:https://happyhome.test/video-id',
        tempFilePath: 'blob:https://happyhome.test/video-id',
        name: 'family.MOV',
        size: 4096,
        duration: '8.25',
        thumbTempFilePath: '',
        type: 'video/mp4',
      }],
    })).toEqual({
      tempFilePath: 'blob:https://happyhome.test/video-id',
      size: 4096,
      duration: 8.25,
      thumbTempFilePath: '',
      name: 'family.MOV',
      type: 'video',
    })
  })

  test.each([
    [{ tempFiles: [] }, 'exactly one video'],
    [{ tempFiles: [
      { tempFilePath: 'wxfile://one.mp4', size: 1, fileType: 'video' },
      { tempFilePath: 'wxfile://two.mp4', size: 1, fileType: 'video' },
    ] }, 'exactly one video'],
    [{ tempFiles: [{ tempFilePath: 'wxfile://zero.mp4', size: 0, fileType: 'video' }] }, 'empty'],
    [{ tempFiles: [{ tempFilePath: 'wxfile://large.mp4', size: VIDEO_MAX_SIZE_BYTES + 1, fileType: 'video' }] }, '200 MiB'],
    [{ tempFiles: [{ tempFilePath: 'wxfile://clip.avi', size: 1, fileType: 'video' }] }, 'unsupported'],
    [{ tempFiles: [{ tempFilePath: 'wxfile://song.mp4', size: 1, fileType: 'audio' }] }, 'video'],
    [{ tempFiles: [{ tempFilePath: 'wxfile://song.mp4', size: 1, fileType: 'video', type: 'audio/mp4' }] }, 'video'],
    [{ tempFiles: [{ tempFilePath: '', name: 'clip.mp4', size: 1, fileType: 'video' }] }, 'path'],
  ])('rejects an invalid chooseMedia result %#', (result, message) => {
    expect(() => normalizeChosenVideo(result)).toThrow(message)
  })
})

describe('VideoItemCos construction', () => {
  test('builds one COS item with a trimmed title and injected stable item ID', () => {
    const createItemId = vi.fn(() => 'video-item-1')

    expect(buildCosVideoItems({
      fileID: '  cloud://env/posts/member-videos/member/video.mp4  ',
      title: '  一起去露营  ',
      cover: '  cloud://env/posts/member-video-covers/member/cover.jpg  ',
      duration: 18.5,
      createItemId,
    })).toEqual([{
      itemId: 'video-item-1',
      title: '一起去露营',
      source: 'cos',
      fileID: 'cloud://env/posts/member-videos/member/video.mp4',
      cover: 'cloud://env/posts/member-video-covers/member/cover.jpg',
      duration: 18.5,
    }])
    expect(createItemId).toHaveBeenCalledTimes(1)
  })

  test('omits an empty optional cover and rejects an empty file ID', () => {
    expect(buildCosVideoItems({
      itemId: 'video-item-fixed',
      fileID: 'cloud://env/video.mp4',
      title: ' 标题 ',
      cover: '  ',
    })).toEqual([{
      itemId: 'video-item-fixed',
      title: '标题',
      source: 'cos',
      fileID: 'cloud://env/video.mp4',
    }])
    expect(() => buildCosVideoItems({
      itemId: 'video-item-fixed',
      fileID: '  ',
      title: '标题',
    })).toThrow('fileID')
  })

  test('rejects a title that is empty after trimming', () => {
    expect(() => buildCosVideoItems({
      itemId: 'video-item-fixed',
      fileID: 'cloud://env/video.mp4',
      title: '   ',
    })).toThrow('title')
  })
})

describe('publish media routing', () => {
  test.each([
    [{ tempFiles: [{ fileType: 'image', tempFilePath: 'wxfile://photo.jpg' }] }, 'image'],
    [{ tempFiles: [{ type: 'image/png', tempFilePath: 'blob:photo' }] }, 'image'],
    [{ tempFiles: [{ fileType: 'video', tempFilePath: 'wxfile://clip.mp4' }] }, 'video'],
    [{ tempFiles: [{ type: 'video/webm', tempFilePath: 'blob:video' }] }, 'video'],
    [{
      type: 'mix',
      tempFiles: [
        { fileType: 'video', tempFilePath: 'wxfile://clip.mp4' },
        { fileType: 'image', tempFilePath: 'wxfile://photo.jpg' },
      ],
    }, 'video'],
    [{
      type: 'mix',
      tempFiles: [
        { fileType: 'image', tempFilePath: 'wxfile://photo.jpg' },
        { fileType: 'video', tempFilePath: 'wxfile://clip.mp4' },
      ],
    }, 'image'],
  ])('uses the first selected image/video as the publish media type', (result, expected) => {
    expect(detectFirstMediaType(result)).toBe(expected)
  })

  test.each([
    [{ tempFiles: [{ fileType: 'audio', tempFilePath: 'wxfile://song.mp3' }] }],
    [{ tempFiles: [{ type: 'audio/mp4', tempFilePath: 'wxfile://song.m4a' }] }],
    [{ tempFiles: [{ tempFilePath: 'wxfile://song.mp3' }] }],
    [{ tempFiles: [] }],
  ])('never treats audio or missing media as a legal publish type', (result) => {
    expect(detectFirstMediaType(result)).toBeNull()
  })

  test('requires confirmation and clearing only when selected media changes type', () => {
    expect(decideMediaTypeSwitch('image', 'video', true)).toEqual({
      requiresConfirmation: true,
      shouldClear: true,
    })
    expect(decideMediaTypeSwitch('video', 'image', true)).toEqual({
      requiresConfirmation: true,
      shouldClear: true,
    })
    expect(decideMediaTypeSwitch('video', 'video', true)).toEqual({
      requiresConfirmation: false,
      shouldClear: false,
    })
    expect(decideMediaTypeSwitch('image', 'video', false)).toEqual({
      requiresConfirmation: false,
      shouldClear: false,
    })
    expect(decideMediaTypeSwitch(null, 'video', true)).toEqual({
      requiresConfirmation: false,
      shouldClear: false,
    })
  })
})

describe('video publish readiness', () => {
  test('blocks submission while video or cover work is unresolved', () => {
    expect(typeof (videoPublish as any).resolveVideoPublishReadiness).toBe('function')
    const resolve = (videoPublish as any).resolveVideoPublishReadiness
    if (!resolve) return
    expect(resolve({ uploading: true, videoReady: false, coverPending: false, error: '' })).toEqual({ ready: false, reason: 'uploading' })
    expect(resolve({ uploading: false, videoReady: true, coverPending: true, error: '封面上传失败' })).toEqual({ ready: false, reason: 'cover-pending' })
    expect(resolve({ uploading: false, videoReady: false, coverPending: false, error: '' })).toEqual({ ready: false, reason: 'video-missing' })
    expect(resolve({ uploading: false, videoReady: true, coverPending: false, error: '' })).toEqual({ ready: true, reason: '' })
  })
})

describe('archive media editor transition state', () => {
  test.each([
    ['image_text', 'video'],
    ['video', 'image'],
  ] as const)('requires confirmation before switching %s to %s with retained media', (format, nextType) => {
    const transition = (videoPublish as any).transitionArchiveMediaEditorState
    expect(typeof transition).toBe('function')
    if (!transition) return
    const state = {
      format,
      formData: { retained: ['cloud://old-media'] },
      initialMedia: { source: 'wxfile://old.mp4' },
      hasSelectedMedia: true,
    }
    const result = transition(state, nextType, null)
    expect(result).toEqual({ status: 'confirm', state })
    expect(result.state.formData).toBe(state.formData)
  })

  test('cancel preserves the previous editor state while confirm clears it', () => {
    const transition = (videoPublish as any).transitionArchiveMediaEditorState
    expect(typeof transition).toBe('function')
    if (!transition) return
    const state = {
      format: 'video',
      formData: { archive_video_videos: [{ fileID: 'cloud://old-video' }] },
      initialMedia: { source: 'wxfile://old.mp4' },
      hasSelectedMedia: true,
    }
    const cancelled = transition(state, 'image', false)
    expect(cancelled).toEqual({ status: 'cancelled', state })
    expect(cancelled.state.formData).toBe(state.formData)
    expect(cancelled.state.initialMedia).toBe(state.initialMedia)

    expect(transition(state, 'image', true)).toEqual({
      status: 'switched',
      state: { format: 'image_text', formData: {}, initialMedia: null, hasSelectedMedia: false },
    })
  })
})

describe('one-shot initial video intent', () => {
  test('never consumes stale initial media when a valid uploaded model already exists', () => {
    const shouldConsume = (videoPublish as any).shouldConsumeInitialVideo
    expect(typeof shouldConsume).toBe('function')
    if (!shouldConsume) return
    expect(shouldConsume(
      [{ source: 'cos', fileID: 'cloud://env/current.mp4', itemId: 'video-1', title: '当前视频' }],
      { source: 'wxfile://stale.mp4' },
      false,
    )).toBe(false)
  })

  test('consumes an initial file exactly once while the model is empty', () => {
    const shouldConsume = (videoPublish as any).shouldConsumeInitialVideo
    expect(typeof shouldConsume).toBe('function')
    if (!shouldConsume) return
    const initial = { source: 'wxfile://new.mp4' }
    expect(shouldConsume([], initial, false)).toBe(true)
    expect(shouldConsume([], initial, true)).toBe(false)
    expect(shouldConsume([], initial, false, 'failed')).toBe(false)
    expect(shouldConsume([], initial, false, 'pending')).toBe(false)
    expect(shouldConsume([], null, false)).toBe(false)
  })
})

describe('pending video intent lifecycle', () => {
  test.each(['pending', 'failed'] as const)('%s marker still requires confirmation before switching to image', (marker) => {
    const transition = (videoPublish as any).transitionArchiveMediaEditorState
    const state = {
      format: 'video',
      formData: {},
      initialMedia: { source: 'wxfile://pending.mp4' },
      hasSelectedMedia: marker !== 'idle',
    }
    expect(transition(state, 'image', null)).toEqual({ status: 'confirm', state })
    expect(transition(state, 'image', false)).toEqual({ status: 'cancelled', state })
  })

  test('explicit removal is the only non-success path that clears a failed marker', () => {
    const reduce = (videoPublish as any).reduceArchiveVideoIntentState
    expect(typeof reduce).toBe('function')
    if (!reduce) return
    expect(reduce('selected', 'started')).toBe('pending')
    expect(reduce('pending', 'failed')).toBe('failed')
    expect(reduce('failed', 'failed')).toBe('failed')
    expect(reduce('failed', 'resolved')).toBe('idle')
  })

  test('rejects async upload completion after unmount or generation replacement', () => {
    const current = (videoPublish as any).isVideoUploadResultCurrent
    expect(typeof current).toBe('function')
    if (!current) return
    expect(current(2, 2, false)).toBe(true)
    expect(current(1, 2, false)).toBe(false)
    expect(current(2, 2, true)).toBe(false)
  })
})

describe('editor-selected video retention', () => {
  test('replacement failure remains retained through back, cancel, retry, and stale completion', () => {
    const reduce = (videoPublish as any).reduceArchiveVideoRetention
    expect(typeof reduce).toBe('function')
    if (!reduce) return
    const replacement = { source: 'wxfile://replacement.mp4', name: 'replacement.mp4' }
    let retained = reduce({ file: null, generation: 0, status: 'idle' }, {
      type: 'selected', file: replacement, generation: 2,
    })
    retained = reduce(retained, { type: 'pending', file: replacement, generation: 2 })
    retained = reduce(retained, { type: 'failed', file: replacement, generation: 2 })
    expect(retained).toEqual({ file: replacement, generation: 2, status: 'failed' })

    const editorState = { format: 'video', formData: {}, initialMedia: retained.file, hasSelectedMedia: true }
    expect((videoPublish as any).transitionArchiveMediaEditorState(editorState, 'image', null).status).toBe('confirm')
    const cancelled = (videoPublish as any).transitionArchiveMediaEditorState(editorState, 'image', false)
    expect(cancelled).toEqual({ status: 'cancelled', state: editorState })

    retained = reduce(retained, { type: 'selected', file: replacement, generation: 3 })
    retained = reduce(retained, { type: 'pending', file: replacement, generation: 3 })
    expect(retained.status).toBe('pending')
    expect(reduce(retained, { type: 'resolved', file: replacement, generation: 2 })).toBe(retained)
    expect(reduce(retained, { type: 'failed', file: replacement, generation: 2 })).toBe(retained)
    expect(reduce(retained, { type: 'resolved', file: replacement, generation: 3 })).toEqual({
      file: null, generation: 3, status: 'idle',
    })
  })
})

describe('cover navigation blocking', () => {
  test('failed cover blocks back until retry success or explicit removal', () => {
    const reduce = (videoPublish as any).reduceCoverNavigationBlock
    expect(typeof reduce).toBe('function')
    if (!reduce) return
    expect(reduce(false, 'selected')).toBe(true)
    expect(reduce(true, 'failed')).toBe(true)
    expect(reduce(true, 'resolved')).toBe(false)
    expect(reduce(true, 'removed')).toBe(false)
  })

  test('failed cover is cleared by video replacement and stale cover completion stays ignored', () => {
    const reduce = (videoPublish as any).reduceCoverNavigationBlock
    const isCurrent = (videoPublish as any).isVideoUploadResultCurrent
    let blocked = reduce(false, 'selected')
    blocked = reduce(blocked, 'failed')
    expect(blocked).toBe(true)

    blocked = reduce(blocked, 'replaced')
    expect(blocked).toBe(false)
    expect(isCurrent(1, 2, false)).toBe(false)
    expect(blocked).toBe(false)
  })
})
