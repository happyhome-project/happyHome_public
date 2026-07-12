import { describe, expect, test, vi } from 'vitest'
import { refreshCommunitiesForCurrentSession } from '../app-session-lifecycle'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((next) => { resolve = next })
  return { promise, resolve }
}

describe('app session lifecycle', () => {
  test('waits for session restore before reading login state', async () => {
    const gate = deferred()
    let loggedIn = false
    const load = vi.fn()
    const running = refreshCommunitiesForCurrentSession({
      sessionReady: gate.promise,
      isLoggedIn: () => loggedIn,
      identity: () => 'user-1',
      load,
      clear: vi.fn(),
    })

    loggedIn = true
    expect(load).not.toHaveBeenCalled()
    gate.resolve()
    await running

    expect(load).toHaveBeenCalledTimes(1)
  })

  test('clears communities when logout changes identity during an in-flight refresh', async () => {
    const request = deferred()
    let loggedIn = true
    let identity = 'user-1'
    const clear = vi.fn()
    const running = refreshCommunitiesForCurrentSession({
      sessionReady: Promise.resolve(),
      isLoggedIn: () => loggedIn,
      identity: () => identity,
      load: () => request.promise,
      clear,
    })
    await Promise.resolve()

    loggedIn = false
    identity = ''
    request.resolve()
    await running

    expect(clear).toHaveBeenCalledTimes(1)
  })
})
