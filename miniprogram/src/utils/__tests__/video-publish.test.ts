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
