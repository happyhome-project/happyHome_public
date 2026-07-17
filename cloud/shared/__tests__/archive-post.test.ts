import {
  ARCHIVE_POST_FORMATS,
  ArchivePostContractError,
  parseArchivePostCreateInput,
} from '../archive-post'
import { MAX_TOPIC_COUNT } from '../topics'

const richBody = (overrides: Record<string, unknown> = {}) => ({
  format: 'markdown',
  markdown: '正文',
  html: '<p>正文</p>',
  text: '正文',
  imageFileIDs: [],
  schemaVersion: 1,
  ...overrides,
})

function expectCode(input: unknown, code: string): void {
  try {
    parseArchivePostCreateInput(input)
    throw new Error('expected parser to throw')
  } catch (error) {
    expect(error).toBeInstanceOf(ArchivePostContractError)
    expect((error as ArchivePostContractError).code).toBe(code)
  }
}

describe('archive post create contract', () => {
  test('exports the supported formats and topic limit', () => {
    expect(ARCHIVE_POST_FORMATS).toEqual(['image_text', 'text', 'video'])
    expect(MAX_TOPIC_COUNT).toBe(5)
  })

  test('parses an image-text archive post and passes optional structures through', () => {
    const body = richBody()
    const location = { address: '湖畔', lat: 30, lng: 120 }
    expect(parseArchivePostCreateInput({
      area: 'archive',
      format: 'image_text',
      topics: ['亲子出游'],
      content: { title: '春游', images: ['cloud://one'], body, location },
    })).toEqual({
      area: 'archive',
      format: 'image_text',
      topics: ['亲子出游'],
      content: { title: '春游', images: ['cloud://one'], body, location },
    })
  })

  test('parses a text archive post with an explicit normalized theme', () => {
    expect(parseArchivePostCreateInput({
      area: 'archive',
      format: 'text',
      topics: [],
      content: { title: '家风', body: richBody() },
      presentation: { textNoteTheme: 'mint' },
    })).toEqual({
      area: 'archive',
      format: 'text',
      topics: [],
      content: { title: '家风', body: richBody() },
      presentation: { textNoteTheme: 'mint' },
    })
  })

  test('trims and deduplicates ordered values and applies defaults', () => {
    expect(parseArchivePostCreateInput({
      area: 'archive',
      format: 'image_text',
      topics: [' #亲子出游 ', 'ＰＥＴ', 'pet'],
      content: { title: '  标题  ', images: [' one ', 'two', 'one'] },
    })).toEqual({
      area: 'archive',
      format: 'image_text',
      topics: ['亲子出游', 'PET'],
      content: { title: '标题', images: ['one', 'two'] },
    })
    expect(parseArchivePostCreateInput({
      area: 'archive', format: 'text', content: { title: '标题', body: richBody() },
    })).toMatchObject({ topics: [], presentation: { textNoteTheme: 'paper' } })
  })

  test('rejects non-archive inputs and supplied section identifiers', () => {
    expectCode(null, 'invalid_input')
    expectCode({ area: 'forum', format: 'text' }, 'invalid_input')
    for (const sectionId of ['section-1', 0, false]) {
      expectCode({ area: 'archive', format: 'text', sectionId }, 'archive_section_forbidden')
    }
  })

  test('rejects invalid formats', () => {
    expectCode({ area: 'archive', format: 'audio' }, 'archive_format_invalid')
  })

  test('parses one COS video and normalizes its string fields', () => {
    const body = richBody()
    const location = { address: '湖畔', lat: 30, lng: 120 }
    expect(parseArchivePostCreateInput({
      area: 'archive',
      format: 'video',
      topics: [' 社区活动 '],
      content: {
        title: '  夏日记录  ',
        body,
        videos: [{
          source: 'cos',
          itemId: ' video-1 ',
          title: ' 夏日视频 ',
          fileID: ' cloud://video.mp4 ',
          cover: ' cloud://cover.jpg ',
        }],
        location,
      },
    })).toEqual({
      area: 'archive',
      format: 'video',
      topics: ['社区活动'],
      content: {
        title: '夏日记录',
        body,
        videos: [{
          source: 'cos',
          itemId: 'video-1',
          title: '夏日视频',
          fileID: 'cloud://video.mp4',
          cover: 'cloud://cover.jpg',
        }],
        location,
      },
    })
  })

  test('requires exactly one video', () => {
    for (const videos of [undefined, [], [
      { source: 'cos', itemId: 'one', title: '视频一', fileID: 'cloud://one.mp4' },
      { source: 'cos', itemId: 'two', title: '视频二', fileID: 'cloud://two.mp4' },
    ]]) {
      expectCode({
        area: 'archive', format: 'video', content: { title: '标题', videos },
      }, 'archive_videos_required')
    }
  })

  test('requires a COS video with non-empty itemId, title, and fileID', () => {
    for (const video of [
      { source: 'channels_feed', itemId: 'one', title: '视频', fileID: 'cloud://one.mp4' },
      { source: 'cos', itemId: ' ', title: '视频', fileID: 'cloud://one.mp4' },
      { source: 'cos', itemId: 'one', title: '', fileID: 'cloud://one.mp4' },
      { source: 'cos', itemId: 'one', title: '视频', fileID: ' ' },
      { source: 'cos', itemId: 'one', title: '视频', fileID: 'cloud://one.mp4', cover: '' },
    ]) {
      expectCode({
        area: 'archive', format: 'video', content: { title: '标题', videos: [video] },
      }, 'archive_video_invalid')
    }
  })

  test('rejects unknown video item fields', () => {
    expectCode({
      area: 'archive',
      format: 'video',
      content: {
        title: '标题',
        videos: [{
          source: 'cos', itemId: 'one', title: '视频', fileID: 'cloud://one.mp4', unexpected: true,
        }],
      },
    }, 'archive_video_invalid')
  })

  test('rejects forbidden and unknown video content fields', () => {
    const video = { source: 'cos', itemId: 'one', title: '视频', fileID: 'cloud://one.mp4' }
    for (const forbidden of [
      { images: ['cloud://image'] },
      { audio: [] },
      { presentation: {} },
      { extra: true },
    ]) {
      expectCode({
        area: 'archive', format: 'video', content: { title: '标题', videos: [video], ...forbidden },
      }, 'invalid_input')
    }
    expectCode({
      area: 'archive', format: 'video', content: { title: '标题', videos: [video] }, presentation: {},
    }, 'archive_presentation_invalid')
  })

  test('validates optional video body and location', () => {
    const video = { source: 'cos', itemId: 'one', title: '视频', fileID: 'cloud://one.mp4' }
    expectCode({
      area: 'archive', format: 'video', content: { title: '标题', videos: [video], body: {} },
    }, 'archive_body_required')
    expectCode({
      area: 'archive', format: 'video', content: {
        title: '标题', videos: [video], location: { address: '湖畔', lat: Number.NaN, lng: 120 },
      },
    }, 'invalid_input')
  })

  test('uses the shared topic normalization and limits', () => {
    expectCode({
      area: 'archive', format: 'image_text', topicIds: ['legacy-topic'],
      content: { title: '标题', images: ['one'] },
    }, 'archive_topics_invalid')
    expectCode({ area: 'archive', format: 'image_text', topics: 'topic', content: {} }, 'archive_topics_invalid')
    expectCode({ area: 'archive', format: 'image_text', topics: [1], content: {} }, 'archive_topics_invalid')
    expectCode({ area: 'archive', format: 'image_text', topics: ['一'.repeat(21)], content: {} }, 'archive_topics_invalid')
    expectCode({
      area: 'archive', format: 'image_text', topics: ['1', '2', '3', '4', '5', '6'], content: {},
    }, 'archive_topic_limit')
    expect(parseArchivePostCreateInput({
      area: 'archive', format: 'image_text', topics: ['1', '2', '3', '4', '5', '5'],
      content: { title: '标题', images: ['one'] },
    }).topics).toHaveLength(5)
  })

  test('requires a non-empty trimmed title', () => {
    expectCode({ area: 'archive', format: 'image_text', content: { title: ' ', images: ['one'] } }, 'archive_title_required')
  })

  test('requires at least one non-empty image for image-text posts', () => {
    expectCode({ area: 'archive', format: 'image_text', content: { title: '标题' } }, 'archive_images_required')
    expectCode({ area: 'archive', format: 'image_text', content: { title: '标题', images: [' '] } }, 'archive_images_required')
  })

  test('requires non-empty text body content', () => {
    expectCode({ area: 'archive', format: 'text', content: { title: '标题', body: richBody({ text: '  ' }) } }, 'archive_body_required')
  })

  test('forbids embedded and content-level images in text posts', () => {
    expectCode({
      area: 'archive', format: 'text', content: { title: '标题', body: richBody({ imageFileIDs: ['cloud://one'] }) },
    }, 'archive_text_images_forbidden')
    expectCode({
      area: 'archive', format: 'text', content: { title: '标题', body: richBody(), images: ['cloud://one'] },
    }, 'archive_text_images_forbidden')
  })

  test('rejects presentation for image-text posts and invalid text themes', () => {
    expectCode({
      area: 'archive', format: 'image_text', content: { title: '标题', images: ['one'] }, presentation: {},
    }, 'archive_presentation_invalid')
    expectCode({
      area: 'archive', format: 'text', content: { title: '标题', body: richBody() }, presentation: { textNoteTheme: 'neon' },
    }, 'archive_presentation_invalid')
  })

  test('does not mutate the caller input', () => {
    const input = {
      area: 'archive', format: 'text', topics: [' #话题 '],
      content: { title: ' 标题 ', body: richBody({ text: ' 正文 ' }) },
      presentation: { textNoteTheme: 'paper' },
    }
    const before = structuredClone(input)
    parseArchivePostCreateInput(input)
    expect(input).toEqual(before)
  })

  test('validates the complete rich-note shape for both formats', () => {
    for (const body of [
      { ...richBody(), format: 'html' },
      { ...richBody(), markdown: 1 },
      { ...richBody(), html: null },
      { ...richBody(), schemaVersion: 2 },
      { ...richBody(), imageFileIDs: 'cloud://one' },
      { ...richBody(), imageFileIDs: {} },
      { ...richBody(), imageFileIDs: ['cloud://one', 2] },
      { ...richBody(), imageFileIDs: [' '] },
    ]) {
      expectCode({ area: 'archive', format: 'text', content: { title: '标题', body } }, 'archive_body_required')
      expectCode({
        area: 'archive', format: 'image_text', content: { title: '标题', images: ['one'], body },
      }, 'archive_body_required')
    }
  })

  test('distinguishes valid embedded text images from malformed rich-note images', () => {
    expectCode({
      area: 'archive', format: 'text', content: { title: '标题', body: richBody({ imageFileIDs: ['cloud://one'] }) },
    }, 'archive_text_images_forbidden')
  })

  test('validates required and optional location fields', () => {
    for (const location of [
      { address: '湖畔', lat: Number.NaN, lng: 120 },
      { address: '湖畔', lat: 30, lng: Number.POSITIVE_INFINITY },
      { address: 1, lat: 30, lng: 120 },
      { address: '湖畔', lat: 30, lng: 120, coordSystem: 'wgs84' },
      { address: '湖畔', lat: 30, lng: 120, source: 'gps' },
      { address: '湖畔', lat: 30, lng: 120, adjusted: 'yes' },
      { address: '湖畔', lat: 30, lng: 120, province: 1 },
    ]) {
      expectCode({
        area: 'archive', format: 'image_text', content: { title: '标题', images: ['one'], location },
      }, 'invalid_input')
    }
  })

  test('passes valid body and location objects through by reference', () => {
    const body = richBody()
    const location = {
      name: '湖畔', address: '湖畔路', lat: 30, lng: 120, coordSystem: 'gcj02', source: 'manual',
      adjusted: false, amapPoiId: 'poi-1', province: '浙', city: '杭', district: '西湖',
    }
    const parsed = parseArchivePostCreateInput({
      area: 'archive', format: 'image_text', content: { title: '标题', images: ['one'], body, location },
    })
    if (parsed.format !== 'image_text') throw new Error('expected image-text result')
    expect(parsed.content.body).toBe(body)
    expect(parsed.content.location).toBe(location)
  })

  test('returns independent normalized topic and image arrays', () => {
    const topics = [' #话题 ']
    const images = [' image-1 ']
    const parsed = parseArchivePostCreateInput({
      area: 'archive', format: 'image_text', topics, content: { title: '标题', images },
    })
    if (parsed.format !== 'image_text') throw new Error('expected image-text result')
    expect(parsed.topics).not.toBe(topics)
    expect(parsed.content.images).not.toBe(images)
    parsed.topics.push('另一个话题')
    parsed.content.images.push('image-2')
    expect(topics).toEqual([' #话题 '])
    expect(images).toEqual([' image-1 '])
  })

  test('rejects malformed content images on text posts as invalid input', () => {
    for (const images of ['cloud://one', [1], ['']]) {
      expectCode({
        area: 'archive', format: 'text', content: { title: '标题', body: richBody(), images },
      }, 'invalid_input')
    }
  })
})
