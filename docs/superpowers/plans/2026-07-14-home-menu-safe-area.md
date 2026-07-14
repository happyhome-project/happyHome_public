# Home Menu Safe Area Implementation Plan

> **Historical / point-in-time:** This delivery plan records the approved 2026-07-14 implementation sequence. Retain it for traceability; do not treat its task state as current repository status.
> **Current authority:** Use the [documentation authority map](../../README.md), current home-page code, WeChat runtime behavior, and tests.

## Original historical instructions (do not execute)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the home-page community switch control outside the WeChat capsule area on every supported device.

**Architecture:** Add a pure geometry helper that converts window, capsule, page-padding, and gap measurements into a right inset. The home page measures WeChat geometry at mount/show, binds the inset to the top bar, and falls back to zero outside a valid WeChat runtime.

**Tech Stack:** Vue 3, uni-app, TypeScript, Vitest, WeChat mini-program runtime.

---

### Task 1: Capsule inset geometry

**Files:**
- Create: `miniprogram/src/utils/menu-safe-area.ts`
- Test: `miniprogram/src/utils/__tests__/menu-safe-area.test.ts`

- [ ] **Step 1: Write the failing unit tests**

```ts
import { describe, expect, test } from 'vitest'
import { resolveMenuSafeRightInset } from '../menu-safe-area'

describe('resolveMenuSafeRightInset', () => {
  test('reserves the space between the capsule and the page content edge', () => {
    expect(resolveMenuSafeRightInset({ windowWidth: 390, menuLeft: 296, pageRightPadding: 12, gap: 8 })).toBe(90)
  })

  test('returns zero for missing or invalid capsule geometry', () => {
    expect(resolveMenuSafeRightInset({ windowWidth: 390, menuLeft: 0, pageRightPadding: 12, gap: 8 })).toBe(0)
    expect(resolveMenuSafeRightInset({ windowWidth: Number.NaN, menuLeft: 296, pageRightPadding: 12, gap: 8 })).toBe(0)
  })

  test('never returns a negative inset', () => {
    expect(resolveMenuSafeRightInset({ windowWidth: 390, menuLeft: 389, pageRightPadding: 20, gap: 0 })).toBe(0)
  })
})
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm.cmd run test:unit -w miniprogram -- src/utils/__tests__/menu-safe-area.test.ts`

Expected: FAIL because `../menu-safe-area` does not exist.

- [ ] **Step 3: Implement the pure geometry helper**

```ts
export interface MenuSafeAreaInput {
  windowWidth: number
  menuLeft: number
  pageRightPadding: number
  gap: number
}

export function resolveMenuSafeRightInset(input: MenuSafeAreaInput): number {
  const values = [input.windowWidth, input.menuLeft, input.pageRightPadding, input.gap]
  if (!values.every(Number.isFinite) || input.windowWidth <= 0 || input.menuLeft <= 0) return 0
  return Math.max(0, Math.round(input.windowWidth - input.menuLeft - input.pageRightPadding + input.gap))
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npm.cmd run test:unit -w miniprogram -- src/utils/__tests__/menu-safe-area.test.ts`

Expected: three passing tests.

### Task 2: Home-page integration

**Files:**
- Modify: `miniprogram/src/pages/index/index.vue`
- Modify: `miniprogram/src/utils/__tests__/community-pages-figma.test.ts`

- [ ] **Step 1: Add a failing page contract test**

Extend the existing home masthead test with assertions for the helper import, `:style="homeTopbarStyle"`, `wx.getMenuButtonBoundingClientRect()`, and refresh calls from both `onMounted` and `onShow`.

- [ ] **Step 2: Run the page contract test and verify RED**

Run: `npm.cmd run test:unit -w miniprogram -- src/utils/__tests__/community-pages-figma.test.ts`

Expected: FAIL because the home page does not yet measure or bind the menu safe area.

- [ ] **Step 3: Implement the home-page measurement**

Import `resolveMenuSafeRightInset`, add a `homeMenuSafeRightInset` ref and computed `homeTopbarStyle`, and bind it to `.home-topbar`. Add `updateHomeMenuSafeArea()` that:

```ts
const systemInfo = uni.getSystemInfoSync?.()
const menuRect = wx.getMenuButtonBoundingClientRect()
homeMenuSafeRightInset.value = resolveMenuSafeRightInset({
  windowWidth: Number(systemInfo?.windowWidth || 0),
  menuLeft: Number(menuRect?.left || 0),
  pageRightPadding: Number(uni.upx2px?.(24) || 12),
  gap: Number(uni.upx2px?.(16) || 8),
})
```

Guard the WeChat global, reset to zero on invalid geometry/errors, and call the function in `onMounted` and `onShow`.

- [ ] **Step 4: Run focused tests and type-check**

Run:

```powershell
npm.cmd run test:unit -w miniprogram -- src/utils/__tests__/menu-safe-area.test.ts src/utils/__tests__/community-pages-figma.test.ts
npm.cmd run type-check -w miniprogram
npm.cmd run test:mp:home-tabs-scroll-static
```

Expected: all commands pass.

- [ ] **Step 5: Build both affected targets**

Run:

```powershell
npm.cmd run build:mp-weixin -w miniprogram
npm.cmd run build:h5 -w miniprogram
```

Expected: both builds succeed; H5 uses a zero extra inset.

- [ ] **Step 6: Commit the implementation**

```powershell
git add miniprogram/src/utils/menu-safe-area.ts miniprogram/src/utils/__tests__/menu-safe-area.test.ts miniprogram/src/utils/__tests__/community-pages-figma.test.ts miniprogram/src/pages/index/index.vue docs/superpowers/plans/2026-07-14-home-menu-safe-area.md
git commit -m "fix(miniprogram): avoid home capsule overlap"
```
