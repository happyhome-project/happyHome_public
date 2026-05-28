import { extractCloudFileIDsFromContent } from '../extract-file-ids'

describe('extractCloudFileIDsFromContent', () => {
  test('extracts cloud files from images, videos and audios', () => {
    const result = extractCloudFileIDsFromContent({
      images: ['cloud://env/img-1.jpg', 'https://cdn/img-2.jpg'],
      videos: [
        { source: 'cos', fileID: 'cloud://env/video-1.mp4', cover: 'cloud://env/cover-1.jpg' },
      ],
      audios: [
        { title: 'Lesson 1', fileID: 'cloud://env/audio-1.mp3', cover: 'cloud://env/audio-cover-1.jpg', duration: 100, size: 1024, ext: 'mp3' },
      ],
    } as any)

    expect(result).toEqual([
      'cloud://env/img-1.jpg',
      'cloud://env/cover-1.jpg',
      'cloud://env/video-1.mp4',
      'cloud://env/audio-cover-1.jpg',
      'cloud://env/audio-1.mp3',
    ])
  })
})

describe('note_blocks media extraction', () => {
  test('extracts cloud images from ordered note blocks', () => {
    const result = extractCloudFileIDsFromContent({
      note: [
        { blockId: 'b1', type: 'text', text: 'hello' },
        { blockId: 'b2', type: 'image', fileID: 'cloud://env/posts/note-1.jpg' },
        { blockId: 'b3', type: 'image', fileID: 'https://cdn.example.com/note-2.jpg' },
      ],
    } as any)

    expect(result).toEqual(['cloud://env/posts/note-1.jpg'])
  })
})
