import { afterEach, describe, expect, test, vi } from 'vitest'

describe('startup performance capture', () => {
  afterEach(() => {
    vi.resetModules()
  })

  test('buffers only normalized startup entries and drains them once after an explicit flush', async () => {
    let observerCallback: ((entryList: any) => void) | null = null
    const observer = { observe: vi.fn(), disconnect: vi.fn() }
    const performance = {
      getEntries: vi.fn(() => [
        {
          name: 'appLaunch',
          entryType: 'navigation',
          startTime: 10.25,
          duration: 321.75,
          path: 'pages/private/index',
          token: 'must-not-leak',
        },
        {
          name: 'resourceTiming',
          entryType: 'resource',
          startTime: 20,
          duration: 15,
          uri: 'https://private.example/avatar.jpg',
        },
      ]),
      createObserver: vi.fn((callback: (entryList: any) => void) => {
        observerCallback = callback
        return observer
      }),
    }
    const wxRef = { getPerformance: vi.fn(() => performance) }
    const record = vi.fn()
    const { flushStartupPerformanceCapture, installStartupPerformanceCapture } = await import('../startup-performance')

    installStartupPerformanceCapture(wxRef)
    expect(record).not.toHaveBeenCalled()

    observerCallback?.({
      getEntries: () => [
        {
          name: 'firstContentfulPaint',
          entryType: 'render',
          startTime: 456.5,
          duration: 0,
          path: 'pages/startup/index',
        },
        {
          name: 'evaluateScript',
          entryType: 'script',
          startTime: 100,
          duration: 80,
          fileList: ['private.js'],
        },
      ],
    })

    expect(observer.observe).toHaveBeenCalledWith({
      entryTypes: ['navigation', 'render', 'script', 'loadPackage'],
    })
    expect(flushStartupPerformanceCapture(record)).toBe(3)
    expect(observer.disconnect).toHaveBeenCalledTimes(1)
    expect(record).toHaveBeenCalledWith('startup.performance', {
      count: 3,
      entries: [
        { name: 'appLaunch', entryType: 'navigation', startTime: 10.25, duration: 321.75 },
        { name: 'firstContentfulPaint', entryType: 'render', startTime: 456.5, duration: 0 },
        { name: 'evaluateScript', entryType: 'script', startTime: 100, duration: 80 },
      ],
    })
    expect(flushStartupPerformanceCapture(record)).toBe(0)
    expect(record).toHaveBeenCalledTimes(1)
  })

  test('silently degrades when the native performance API is unavailable', async () => {
    const record = vi.fn()
    const { flushStartupPerformanceCapture, installStartupPerformanceCapture } = await import('../startup-performance')

    expect(() => installStartupPerformanceCapture({})).not.toThrow()
    expect(flushStartupPerformanceCapture(record)).toBe(0)
    expect(record).not.toHaveBeenCalled()
  })
})
