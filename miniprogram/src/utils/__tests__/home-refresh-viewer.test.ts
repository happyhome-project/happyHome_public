import { describe, expect, test } from 'vitest'
import {
  captureHomeRefreshViewer,
  isSameHomeRefreshViewer,
} from '../home-refresh-viewer'

describe('home refresh viewer snapshot', () => {
  test('treats a login completed during a guest request as a viewer change', () => {
    const requestedViewer = captureHomeRefreshViewer(false, '')
    const currentViewer = captureHomeRefreshViewer(true, 'user-after-login')

    expect(requestedViewer).toEqual({ loggedIn: false, openId: '' })
    expect(isSameHomeRefreshViewer(requestedViewer, currentViewer)).toBe(false)
  })

  test('keeps the same authenticated viewer stable and detects account replacement', () => {
    const requestedViewer = captureHomeRefreshViewer(true, 'user-a')

    expect(isSameHomeRefreshViewer(
      requestedViewer,
      captureHomeRefreshViewer(true, 'user-a'),
    )).toBe(true)
    expect(isSameHomeRefreshViewer(
      requestedViewer,
      captureHomeRefreshViewer(true, 'user-b'),
    )).toBe(false)
  })

  test('normalizes an incomplete authenticated identity to the guest contract', () => {
    expect(captureHomeRefreshViewer(true, '   ')).toEqual({
      loggedIn: false,
      openId: '',
    })
  })
})
