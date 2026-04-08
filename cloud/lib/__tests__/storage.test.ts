const mockUploadFile = jest.fn()
const mockDeleteFile = jest.fn()
const mockGetTempFileURL = jest.fn()

jest.mock('wx-server-sdk', () => ({
  init: jest.fn(),
  DYNAMIC_CURRENT_ENV: 'test',
  uploadFile: (...args: any[]) => mockUploadFile(...args),
  deleteFile: (...args: any[]) => mockDeleteFile(...args),
  getTempFileURL: (...args: any[]) => mockGetTempFileURL(...args),
}))

import { uploadFile, deleteFile, getTempUrl } from '../storage'

beforeEach(() => jest.clearAllMocks())

describe('uploadFile', () => {
  test('上传文件返回 fileID', async () => {
    mockUploadFile.mockResolvedValue({ fileID: 'cloud://env/path/file.png' })

    const result = await uploadFile('path/file.png', Buffer.from('data'))

    expect(mockUploadFile).toHaveBeenCalledWith({
      cloudPath: 'path/file.png',
      fileContent: expect.any(Buffer),
    })
    expect(result).toBe('cloud://env/path/file.png')
  })

  test('上传失败时错误向上传播', async () => {
    mockUploadFile.mockRejectedValue(new Error('quota exceeded'))
    await expect(uploadFile('path/file.png', Buffer.from('data'))).rejects.toThrow('quota exceeded')
  })
})

describe('deleteFile', () => {
  test('删除文件列表', async () => {
    mockDeleteFile.mockResolvedValue({})

    await deleteFile(['fileID-1', 'fileID-2'])

    expect(mockDeleteFile).toHaveBeenCalledWith({ fileList: ['fileID-1', 'fileID-2'] })
  })
})

describe('getTempUrl', () => {
  test('获取临时访问 URL', async () => {
    mockGetTempFileURL.mockResolvedValue({
      fileList: [{ tempFileURL: 'https://tmp.wx.com/file.png' }],
    })

    const url = await getTempUrl('cloud://env/file.png')

    expect(mockGetTempFileURL).toHaveBeenCalledWith({ fileList: ['cloud://env/file.png'] })
    expect(url).toBe('https://tmp.wx.com/file.png')
  })
})
