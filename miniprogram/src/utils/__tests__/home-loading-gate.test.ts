import { describe, expect, test } from 'vitest'
import { createHomeLoadingGate } from '../home-loading-gate'

describe('home loading gate', () => {
  test('redirect release cannot clear an active or newer refresh owner', () => {
    const loading = { value: true }
    const gate = createHomeLoadingGate(loading)

    expect(gate.releaseInitial()).toBe(true)
    expect(loading.value).toBe(false)

    const firstOwner = gate.beginRefresh()
    expect(loading.value).toBe(true)
    expect(gate.releaseInitial()).toBe(false)
    expect(loading.value).toBe(true)

    const newerOwner = gate.beginRefresh()
    expect(gate.endRefresh(firstOwner)).toBe(false)
    expect(loading.value).toBe(true)
    expect(gate.endRefresh(newerOwner)).toBe(true)
    expect(loading.value).toBe(false)
  })
})
