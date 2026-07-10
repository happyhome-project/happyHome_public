import { afterEach, describe, expect, test, vi } from 'vitest'

describe('client diagnostics', () => {
  afterEach(() => {
    vi.resetModules()
    vi.unstubAllGlobals()
  })

  test('enables a bounded Home trace that expires automatically', async () => {
    const storage = new Map<string, any>()
    vi.stubGlobal('wx', {
      getStorageSync: vi.fn((key: string) => storage.get(key)),
      setStorageSync: vi.fn((key: string, value: any) => storage.set(key, value)),
      removeStorageSync: vi.fn((key: string) => storage.delete(key)),
    })
    const diagnostics = await import('../client-diagnostics')

    diagnostics.enableClientDiagnostics({ scope: 'home', ttlMs: 1000, now: 10 })

    expect(diagnostics.getClientDiagnosticsState(500)).toMatchObject({ enabled: true, scope: 'home' })
    expect(diagnostics.getClientDiagnosticsState(1011)).toMatchObject({ enabled: false })
  })

  test('keeps only the newest diagnostic events and redacts sensitive fields', async () => {
    const storage = new Map<string, any>()
    vi.stubGlobal('wx', {
      getStorageSync: vi.fn((key: string) => storage.get(key)),
      setStorageSync: vi.fn((key: string, value: any) => storage.set(key, value)),
      removeStorageSync: vi.fn((key: string) => storage.delete(key)),
    })
    const diagnostics = await import('../client-diagnostics')
    diagnostics.enableClientDiagnostics({ scope: 'home', ttlMs: 60_000, now: 10 })

    for (let index = 0; index < 102; index += 1) {
      diagnostics.recordClientDiagnosticEvent({
        level: 'info',
        event: `home.stage.${index}`,
        details: { token: 'secret', openId: 'openid-123456', phone: '13800000000', email: 'test@example.com', count: index },
        now: 10 + index,
      })
    }

    const events = diagnostics.readClientDiagnosticEvents()
    expect(events).toHaveLength(100)
    expect(events[0]?.event).toBe('home.stage.2')
    expect(events.at(-1)?.details).toMatchObject({ token: '[redacted]', openId: '[redacted]', phone: '[redacted]', email: '[redacted]', count: 101 })
  })

  test('keeps captured evidence uploadable after the trace has expired or been disabled', async () => {
    const storage = new Map<string, any>()
    vi.stubGlobal('wx', {
      getStorageSync: vi.fn((key: string) => storage.get(key)),
      setStorageSync: vi.fn((key: string, value: any) => storage.set(key, value)),
      removeStorageSync: vi.fn((key: string) => storage.delete(key)),
    })
    const diagnostics = await import('../client-diagnostics')
    diagnostics.enableClientDiagnostics({ scope: 'home', ttlMs: 1000, now: 10 })
    diagnostics.recordClientDiagnosticEvent({ level: 'warn', event: 'home.watchdog.timeout', now: 20 })
    diagnostics.disableClientDiagnostics()

    const send = vi.fn(async () => true)
    await expect(diagnostics.flushClientDiagnosticEvents(send)).resolves.toEqual({ attempted: 1, uploaded: 1 })
    expect(send).toHaveBeenCalledTimes(1)
  })
})
