/**
 * useBusyLock / useKeyedBusyLock — guard async actions against repeat-click.
 */
import { describe, test, expect, vi } from 'vitest'
import { useBusyLock, useKeyedBusyLock } from '../useBusyLock'

function deferred<T = void>() {
  let resolve!: (v: T) => void
  let reject!: (e: any) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

describe('useBusyLock', () => {
  test('busy becomes true during run, false after', async () => {
    const d = deferred<string>()
    const lock = useBusyLock(async () => d.promise)
    expect(lock.busy.value).toBe(false)

    const p = lock.run()
    expect(lock.busy.value).toBe(true)

    d.resolve('ok')
    await p
    expect(lock.busy.value).toBe(false)
  })

  test('second call while busy returns undefined and does not invoke action', async () => {
    const action = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 50))
      return 'done'
    })
    const lock = useBusyLock(action)

    const p1 = lock.run()
    const p2 = lock.run() // should be suppressed

    const [r1, r2] = await Promise.all([p1, p2])
    expect(r1).toBe('done')
    expect(r2).toBeUndefined()
    expect(action).toHaveBeenCalledTimes(1)
  })

  test('busy resets to false even if action throws', async () => {
    const lock = useBusyLock(async () => { throw new Error('boom') })
    await expect(lock.run()).rejects.toThrow('boom')
    expect(lock.busy.value).toBe(false)
  })

  test('can run again after previous call finished', async () => {
    const action = vi.fn(async () => 'x')
    const lock = useBusyLock(action)
    await lock.run()
    await lock.run()
    await lock.run()
    expect(action).toHaveBeenCalledTimes(3)
  })

  test('args are forwarded to action', async () => {
    const action = vi.fn(async (a: number, b: string) => `${a}-${b}`)
    const lock = useBusyLock(action)
    const res = await lock.run(1, 'hi')
    expect(res).toBe('1-hi')
    expect(action).toHaveBeenCalledWith(1, 'hi')
  })
})

describe('useKeyedBusyLock', () => {
  test('different keys can run in parallel', async () => {
    const action = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 50))
    })
    const lock = useKeyedBusyLock(action, (id: string) => id)

    const p1 = lock.run('a')
    const p2 = lock.run('b')
    expect(lock.isBusy('a')).toBe(true)
    expect(lock.isBusy('b')).toBe(true)

    await Promise.all([p1, p2])
    expect(action).toHaveBeenCalledTimes(2)
    expect(lock.isBusy('a')).toBe(false)
    expect(lock.isBusy('b')).toBe(false)
  })

  test('same key blocks second call', async () => {
    const action = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 30))
    })
    const lock = useKeyedBusyLock(action, (id: string) => id)

    const p1 = lock.run('same')
    const p2 = lock.run('same')
    const [, r2] = await Promise.all([p1, p2])
    expect(r2).toBeUndefined()
    expect(action).toHaveBeenCalledTimes(1)
  })

  test('key-derived from complex arg', async () => {
    const action = vi.fn(async (obj: { id: string }) => obj.id)
    const lock = useKeyedBusyLock(action, (obj) => obj.id)
    const r = await lock.run({ id: 'x' })
    expect(r).toBe('x')
  })

  test('key unlocked even if action throws', async () => {
    const lock = useKeyedBusyLock(
      async () => { throw new Error('fail') },
      (id: string) => id,
    )
    await expect(lock.run('a')).rejects.toThrow('fail')
    expect(lock.isBusy('a')).toBe(false)
    // can retry same key
    await expect(lock.run('a')).rejects.toThrow('fail')
  })
})
