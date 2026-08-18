import { afterEach, describe, expect, test, vi } from 'vitest'
import * as audioPublish from '../audio-publish'

type DurationProbe = {
  promise: Promise<number>
  cancel(): void
}

type MiniAudioContext = {
  duration: number
  src: string
  onCanplay(callback: () => void): void
  offCanplay(callback: () => void): void
  onError(callback: () => void): void
  offError(callback: () => void): void
  destroy(): void
}

function createProbe(options: {
  readDuration: () => unknown
  cleanup: () => void
  subscribe: (resolve: () => void, reject: (error: Error) => void) => void
  timeoutMs: number
}): DurationProbe {
  return (audioPublish as any).createCancelableAudioDurationProbe(options)
}

function createMiniProbe(
  context: MiniAudioContext,
  options: { timeoutMs?: number; pollIntervalMs?: number } = {},
): DurationProbe {
  return (audioPublish as any).createMiniProgramAudioDurationProbe(context, '/tmp/track.m4a', options)
}

function createMiniContext() {
  let canplay: (() => void) | undefined
  let error: (() => void) | undefined
  const events: string[] = []
  const context: MiniAudioContext = {
    duration: 0,
    src: '',
    onCanplay(callback) { canplay = callback },
    offCanplay(callback) {
      if (canplay === callback) events.push('off-canplay')
    },
    onError(callback) { error = callback },
    offError(callback) {
      if (error === callback) events.push('off-error')
    },
    destroy() { events.push('destroy') },
  }
  return {
    context,
    events,
    emitCanplay: () => canplay?.(),
  }
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

  test('cancelled mini adapter ignores a late canplay without scheduling a timer', async () => {
    vi.useFakeTimers()
    const runtime = createMiniContext()
    const probe = createMiniProbe(runtime.context, { timeoutMs: 1000, pollIntervalMs: 100 })
    const outcome = probe.promise.then(() => 'resolved', (error) => String(error?.message || error))

    probe.cancel()
    runtime.emitCanplay()

    expect(await outcome).toContain('取消')
    expect(vi.getTimerCount()).toBe(0)
    expect(runtime.events).toEqual(['off-canplay', 'off-error', 'destroy'])
  })

  test('deduplicates repeated mini canplay polling and clears every timer during cleanup', async () => {
    vi.useFakeTimers()
    const runtime = createMiniContext()
    const probe = createMiniProbe(runtime.context, { timeoutMs: 1000, pollIntervalMs: 100 })
    const outcome = probe.promise.then(() => 'resolved', (error) => String(error?.message || error))

    runtime.emitCanplay()
    runtime.emitCanplay()
    expect(vi.getTimerCount()).toBe(2)

    probe.cancel()
    runtime.emitCanplay()

    expect(await outcome).toContain('取消')
    expect(vi.getTimerCount()).toBe(0)
    expect(runtime.events.filter((event) => event === 'destroy')).toHaveLength(1)
  })
})
