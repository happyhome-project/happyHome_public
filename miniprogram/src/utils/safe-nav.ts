// safe-nav.ts — protect uni navigation APIs from repeat-click crashes.
//
// Problem: `uni.navigateTo / switchTab / reLaunch / navigateBack` all return
// a Promise that REJECTS when called while a previous navigation is still
// pending (common if user taps a link twice). Uncaught rejection surfaces as
// a runtime error and, in some adapters, an error toast.
//
// Solution: patch each API to:
//   1. suppress duplicate calls within a short window (debounce)
//   2. convert rejections into console.warn (never blow up the app)
//
// Call `installSafeNav()` once at app bootstrap.

const DEBOUNCE_MS = 400

const lastCallAt: Record<string, number> = {}

function wrap<K extends 'navigateTo' | 'switchTab' | 'reLaunch' | 'redirectTo' | 'navigateBack'>(
  name: K,
) {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  const uniGlobal: any = typeof uni !== 'undefined' ? uni : null
  if (!uniGlobal || typeof uniGlobal[name] !== 'function') return
  const orig = uniGlobal[name].bind(uniGlobal)
  uniGlobal[name] = (opts: any) => {
    const now = Date.now()
    const key = `${name}:${opts?.url || ''}`
    if (lastCallAt[key] && now - lastCallAt[key] < DEBOUNCE_MS) {
      // duplicate within debounce — drop silently
      return Promise.resolve()
    }
    lastCallAt[key] = now
    try {
      const ret = orig(opts)
      if (ret && typeof ret.then === 'function') {
        return ret.catch((err: any) => {
          const msg = String(err?.errMsg || err?.message || err || '')
          // "already" / "locked" / "in progress" are the known benign races
          if (/already|locked|in progress|redirect/i.test(msg)) {
            console.warn(`[safe-nav] ${name} suppressed: ${msg}`)
            return
          }
          console.warn(`[safe-nav] ${name} failed:`, msg)
        })
      }
      return ret
    } catch (e: any) {
      console.warn(`[safe-nav] ${name} threw:`, e?.message || e)
      return Promise.resolve()
    }
  }
}

export function installSafeNav() {
  wrap('navigateTo')
  wrap('switchTab')
  wrap('reLaunch')
  wrap('redirectTo')
  wrap('navigateBack')
}
