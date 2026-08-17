import { afterEach, describe, expect, test, vi } from 'vitest'
import * as audioPublish from '../audio-publish'

type DurationProbe = {
  promise: Promise<number>
  cancel(): void
}

function createProbe(options: {
  readDuration: () => unknown
  cleanup: () => void
  subscribe: (resolve: () => void, reject: (error: Error) => void) => void
  timeoutMs: number
}): DurationProbe {
  return (audioPublish as any).createCancelableAudioDurationProbe(options)
}

describe('cancellable audio duration probe', () => {
  afterEach(() => vi.useRealTimers())

  test('times out and destroys media even when the runtime emits no callbacks', async () => {
    vi.useFakeTimers()
    const events: string[] = []
    const probe = createProbe({
      readDuration: () => 0,
      cleanup: () => { events.push('destroy') },
      subscribe: () => {},
      timeoutMs: 1000,
    })
    const outcome = probe.promise.then(() => 'resolved', (error) => String(error?.message || error))

    await vi.advanceTimersByTimeAsync(1000)

    expect(await outcome).toContain('超时')
    expect(events).toEqual(['destroy'])
  })

  test('cancellation settles the probe and destroys its media exactly once', async () => {
    const events: string[] = []
    const probe = createProbe({
      readDuration: () => 12,
      cleanup: () => { events.push('destroy') },
      subscribe: () => {},
      timeoutMs: 1000,
    })
    const outcome = probe.promise.then(() => 'resolved', (error) => String(error?.message || error))

    probe.cancel()
    probe.cancel()

    expect(await outcome).toContain('取消')
    expect(events).toEqual(['destroy'])
  })

  test('cancelling a stuck probe lets later serial queue work start', async () => {
    const events: string[] = []
    const first = createProbe({
      readDuration: () => 0,
      cleanup: () => { events.push('destroy-first') },
      subscribe: () => {},
      timeoutMs: 1000,
    })
    const queue = Promise.resolve()
      .then(() => first.promise)
      .catch(() => undefined)
      .then(() => { events.push('start-second') })

    first.cancel()
    await queue

    expect(events).toEqual(['destroy-first', 'start-second'])
  })
})
