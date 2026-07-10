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

  test('uploads the app launch canary without enabling verbose logging', async () => {
    const callFunction = vi.fn()
    vi.stubGlobal('wx', {
      cloud: { callFunction },
      getStorageSync: vi.fn(() => ''),
    })
    vi.stubGlobal('getCurrentPages', vi.fn(() => []))
    const { clientLog } = await import('../client-log')

    clientLog('info', 'app.launch.start', { SDKVersion: '3.15.1', platform: 'android' })

    expect(callFunction).toHaveBeenCalledTimes(1)
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

  test('uploads and retains Home startup diagnostics only while the opt-in trace is active', async () => {
    const storage = new Map<string, any>()
    const callFunction = vi.fn((options: any) => options.success?.({ result: { success: true } }))
    vi.stubGlobal('wx', {
      cloud: { callFunction },
      getStorageSync: vi.fn((key: string) => storage.get(key)),
      setStorageSync: vi.fn((key: string, value: any) => storage.set(key, value)),
      removeStorageSync: vi.fn((key: string) => storage.delete(key)),
    })
    vi.stubGlobal('getCurrentPages', vi.fn(() => []))
    const diagnostics = await import('../client-diagnostics')
    const { clientLog } = await import('../client-log')
    diagnostics.enableClientDiagnostics({ scope: 'home' })

    clientLog('info', 'home.module.enter', { token: 'never-upload-raw' })

    expect(callFunction).toHaveBeenCalledTimes(1)
    expect(diagnostics.readClientDiagnosticEvents()[0]).toMatchObject({
      event: 'home.module.enter',
      details: { token: '[redacted]' },
    })
  })

  test('does not broaden a Home-only trace to unrelated routes or events', async () => {
    const storage = new Map<string, any>()
    const callFunction = vi.fn()
    vi.stubGlobal('wx', {
      cloud: { callFunction },
      getStorageSync: vi.fn((key: string) => storage.get(key)),
      setStorageSync: vi.fn((key: string, value: any) => storage.set(key, value)),
      removeStorageSync: vi.fn((key: string) => storage.delete(key)),
    })
    vi.stubGlobal('getCurrentPages', vi.fn(() => [{ route: 'pages/profile/index' }]))
    const diagnostics = await import('../client-diagnostics')
    const { clientLog } = await import('../client-log')
    diagnostics.enableClientDiagnostics({ scope: 'home' })

    clientLog('info', 'profile.refresh.success', { phone: 'not-for-home-trace' })

    expect(callFunction).not.toHaveBeenCalled()
    expect(diagnostics.readClientDiagnosticEvents()).toEqual([])
  })
})
