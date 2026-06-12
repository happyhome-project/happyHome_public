import { afterEach, describe, expect, test, vi } from 'vitest'

describe('clientLog cloud upload policy', () => {
  afterEach(() => {
    vi.resetModules()
    vi.unstubAllGlobals()
  })

  test('does not upload debug/info logs to cloud by default', async () => {
    const callFunction = vi.fn()
    vi.stubGlobal('wx', {
      cloud: { callFunction },
      getStorageSync: vi.fn(() => ''),
    })
    vi.stubGlobal('getCurrentPages', vi.fn(() => []))
    const { clientLog } = await import('../client-log')

    clientLog('debug', 'cloud.call.start', {})
    clientLog('info', 'home.refresh.start', {})

    expect(callFunction).not.toHaveBeenCalled()
  })

  test('uploads warn/error logs to cloud by default', async () => {
    const callFunction = vi.fn()
    vi.stubGlobal('wx', {
      cloud: { callFunction },
      getStorageSync: vi.fn(() => ''),
    })
    vi.stubGlobal('getCurrentPages', vi.fn(() => []))
    const { clientLog } = await import('../client-log')

    clientLog('warn', 'home.refresh.skip.busy', {})
    clientLog('error', 'home.refresh.fail', {})

    expect(callFunction).toHaveBeenCalledTimes(2)
  })

  test('uploads debug/info logs when verbose client logging is enabled', async () => {
    const callFunction = vi.fn()
    vi.stubGlobal('wx', {
      cloud: { callFunction },
      getStorageSync: vi.fn((key: string) => key === 'hh_client_log_verbose' ? '1' : ''),
    })
    vi.stubGlobal('getCurrentPages', vi.fn(() => []))
    const { clientLog } = await import('../client-log')

    clientLog('debug', 'cloud.call.start', {})
    clientLog('info', 'home.refresh.start', {})

    expect(callFunction).toHaveBeenCalledTimes(2)
  })
})
