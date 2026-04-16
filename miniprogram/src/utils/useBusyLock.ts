// useBusyLock — guard an async action against repeat-clicks / double-submits.
//
// Usage:
//   const apply = useBusyLock(async (community) => {
//     await memberApi.apply(community._id)
//   })
//   // in template: @tap="apply.run(community)"
//   // apply.busy is a ref<boolean> you can bind to [disabled] / loading UI.
//
// Keyed variant: useKeyedBusyLock — locks per-key so different items don't block each other.
//   const approve = useKeyedBusyLock(async (member) => {
//     await memberApi.memberApprove(member.communityId, member._id)
//   }, (member) => member._id)
//   // in template: @tap="approve.run(member)"
//   // approve.isBusy(member._id) → true only for that row

import { ref, reactive, readonly } from 'vue'

export interface BusyLock<Args extends any[], R> {
  busy: Readonly<{ value: boolean }>
  run: (...args: Args) => Promise<R | undefined>
}

/**
 * Wrap an async action so concurrent calls are suppressed.
 * If called while busy, the second call resolves to undefined immediately.
 */
export function useBusyLock<Args extends any[], R>(
  action: (...args: Args) => Promise<R>,
): BusyLock<Args, R> {
  const busy = ref(false)
  const run = async (...args: Args): Promise<R | undefined> => {
    if (busy.value) return undefined
    busy.value = true
    try {
      return await action(...args)
    } finally {
      busy.value = false
    }
  }
  return { busy: readonly(busy) as any, run }
}

export interface KeyedBusyLock<Args extends any[], R> {
  isBusy: (key: string) => boolean
  run: (...args: Args) => Promise<R | undefined>
}

/**
 * Per-key busy lock: multiple concurrent calls allowed as long as each
 * call's derived key differs. Same key → suppressed.
 *
 * Example: approving 3 different pending members in parallel OK, but clicking
 * approve on the SAME member twice → 2nd click ignored.
 */
export function useKeyedBusyLock<Args extends any[], R>(
  action: (...args: Args) => Promise<R>,
  keyFn: (...args: Args) => string,
): KeyedBusyLock<Args, R> {
  const locks = reactive<Record<string, boolean>>({})
  const isBusy = (key: string): boolean => !!locks[key]
  const run = async (...args: Args): Promise<R | undefined> => {
    const key = keyFn(...args)
    if (locks[key]) return undefined
    locks[key] = true
    try {
      return await action(...args)
    } finally {
      delete locks[key]
    }
  }
  return { isBusy, run }
}
