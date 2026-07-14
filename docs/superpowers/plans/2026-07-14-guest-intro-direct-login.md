# Guest Intro Direct Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the first-visit welcome popup start login on the home page and rename its community-creation action.

**Architecture:** Keep guest-intro visibility and routing unchanged. Render the mini-program avatar/nickname flow and H5 credentials form inside the existing home overlay, and delegate authentication to the existing user store without introducing another authentication abstraction.

**Tech Stack:** Vue 3, uni-app, Pinia, TypeScript, Vitest.

---

### Task 1: Lock the required behavior with tests

**Files:**
- Modify: `miniprogram/src/utils/__tests__/guest-intro.test.ts`

- [x] Add a source contract asserting the home primary action contains no profile `switchTab`/`reLaunch`, exposes `chooseAvatar`, includes an inline submit action, and the secondary default text is `创建我自己的社群`.
- [x] Run `npm.cmd --workspace miniprogram run test:unit -- src/utils/__tests__/guest-intro.test.ts` and confirm the new assertion fails for the missing behavior.

### Task 2: Implement direct login in the home popup

**Files:**
- Modify: `miniprogram/src/pages/index/index.vue`
- Modify: `cloud/shared/guest-intro-config.ts`

- [x] Replace the primary `view` with a platform-aware login trigger: `open-type="chooseAvatar"` on supported mini-programs and an inline H5-form trigger elsewhere.
- [x] Add nickname confirmation and H5 account fields inside the existing overlay, with cancel, busy, validation, and error states.
- [x] On mini-program submit call `userStore.login`; on H5 submit call `userStore.webLogin`; on success mark the intro seen and refresh home data, while failures remain on the home page.
- [x] Change the default secondary text to `创建我自己的社群` without changing `handleGuestIntroSecondary` routing.
- [x] Re-run the focused tests and confirm they pass.

### Task 3: Verify the integrated result

**Files:**
- Modify: `docs/superpowers/plans/2026-07-14-guest-intro-direct-login.md`

- [x] Run `npm.cmd --workspace miniprogram run type-check`.
- [x] Run `npm.cmd --workspace miniprogram run test:unit`.
- [x] Run `npm.cmd --workspace miniprogram run build:mp-weixin` and `npm.cmd --workspace miniprogram run build:h5`.
- [x] Run `git diff --check`, inspect the final diff, mark completed checklist items, and commit the implementation with the configured AngryBird identity.
