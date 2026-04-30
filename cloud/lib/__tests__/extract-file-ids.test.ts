import { extractCloudFileIDsFromContent } from '../extract-file-ids'

describe('extractCloudFileIDsFromContent', () => {
  test('提取音频、视频、图片中的 cloud:// 文件', () => {
    const result = extractCloudFileIDsFromContent({
      images: ['cloud://env/img-1.jpg', 'https://cdn/img-2.jpg'],
      videos: [
        { source: 'cos', fileID: 'cloud://env/video-1.mp4', cover: 'cloud://env/cover-1.jpg' },
      ],
      audios: [
        { title: '第一讲', fileID: 'cloud://env/audio-1.mp3', duration: 100, size: 1024, ext: 'mp3' },
      ],
    } as any)

    expect(result).toEqual([
      'cloud://env/img-1.jpg',
      'cloud://env/cover-1.jpg',
      'cloud://env/video-1.mp4',
      'cloud://env/audio-1.mp3',
    ])
  })
})
