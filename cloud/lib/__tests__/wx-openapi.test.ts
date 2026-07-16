jest.mock('../db', () => ({
  getById: jest.fn(),
  create: jest.fn(),
  updateById: jest.fn(),
}))

jest.mock('https', () => ({
  request: jest.fn(),
}))

import https from 'https'
import * as db from '../db'
import { postWxJson } from '../wx-openapi'

test('postWxJson destroys a stalled WeChat request before the cloud function deadline', async () => {
  process.env.WX_APPID = 'test-appid'
  process.env.WX_APPSECRET = 'test-secret'
  ;(db.getById as jest.Mock).mockResolvedValue({
    _id: 'wx_access_token',
    token: 'cached-token',
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    fetchedAt: new Date().toISOString(),
  })

  let errorHandler: ((error: Error) => void) | undefined
  const request: any = {
    on: jest.fn((event: string, handler: (error: Error) => void) => {
      if (event === 'error') errorHandler = handler
      return request
    }),
    setTimeout: jest.fn((_timeoutMs: number, onTimeout: () => void) => {
      onTimeout()
      return request
    }),
    destroy: jest.fn((error: Error) => errorHandler?.(error)),
    write: jest.fn(),
    end: jest.fn(),
  }
  ;(https.request as jest.Mock).mockReturnValue(request)

  await expect(postWxJson('/wxa/msg_sec_check', { content: '出游邀约' }))
    .rejects.toThrow('WeChat OpenAPI request timed out after 4000ms')

  expect(request.setTimeout).toHaveBeenCalledWith(4000, expect.any(Function))
  expect(request.destroy).toHaveBeenCalledWith(expect.any(Error))
})
