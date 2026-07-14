# Community Initial Share Avatar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the default Logo used by avatarless communities with an elegant brand-green initial avatar in all community-avatar surfaces and native WeChat share cards.

**Architecture:** A pure `community-avatar` utility owns grapheme-safe initial extraction and the visual constants. A reusable `CommunityShareImageCanvas` component owns the mounted offscreen canvas, image probing, drawing, stale-result protection, and exposes a prepared `imageUrl`; home and profile pages feed it the current community and synchronously read the prepared result in `onShareAppMessage`.

**Tech Stack:** Vue 3, uni-app, WeChat mini-program canvas APIs, TypeScript, Vitest.

---

## File map

- Create `miniprogram/src/utils/community-avatar.ts`: grapheme-safe initial extraction and shared visual constants.
- Create `miniprogram/src/utils/__tests__/community-avatar.test.ts`: initial extraction coverage including fallback segmentation.
- Create `miniprogram/src/components/CommunityShareImageCanvas.vue`: offscreen canvas and async share image preparation.
- Create `miniprogram/src/utils/__tests__/community-share-image.test.ts`: pure share-priority/stale-key behavior used by the component.
- Modify `miniprogram/src/utils/community-share.ts`: share preparation key and result-selection helpers.
- Modify `miniprogram/src/utils/__tests__/community-share.test.ts`: helper tests.
- Modify `miniprogram/src/pages/index/index.vue`: shared initial, image-error fallback, canvas component, prepared share URL.
- Modify `miniprogram/src/pages/profile/index.vue`: canvas component and prepared share URL.
- Modify `miniprogram/src/pages/community-switch/index.vue`: shared initial helper and unified font styling.
- Modify `miniprogram/src/pages/onboarding/index.vue`: shared initial helper and unified font styling.
- Modify `miniprogram/src/utils/__tests__/community-share-pages.test.ts`: page/component integration contracts.

### Task 1: Grapheme-safe community initials

**Files:**
- Create: `miniprogram/src/utils/community-avatar.ts`
- Create: `miniprogram/src/utils/__tests__/community-avatar.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
expect(communityInitial('明士班')).toBe('明')
expect(communityInitial('  Alpha')).toBe('A')
expect(communityInitial('')).toBe('群')
expect(communityInitial('👨‍👩‍👧‍👦之家', { segmenter: null })).toBe('👨‍👩‍👧‍👦')
expect(communityInitial('👍🏽邻里', { segmenter: null })).toBe('👍🏽')
expect(communityInitial('e\u0301cole', { segmenter: null })).toBe('e\u0301')
```

- [ ] **Step 2: Verify RED**

Run: `npx.cmd vitest run miniprogram/src/utils/__tests__/community-avatar.test.ts`
Expected: FAIL because `community-avatar` does not exist.

- [ ] **Step 3: Implement the minimal utility**

Export `COMMUNITY_AVATAR_BACKGROUND = '#E8F8F0'`, `COMMUNITY_AVATAR_FOREGROUND = '#1F7A50'`, `COMMUNITY_AVATAR_FONT_WEIGHT = 600`, and `communityInitial(value, options?)`. Prefer `Intl.Segmenter`; the fallback consumes one code point plus combining marks, variation selectors, emoji modifiers, and repeated ZWJ-linked code points.

- [ ] **Step 4: Verify GREEN**

Run the Task 1 Vitest command. Expected: all tests PASS.

- [ ] **Step 5: Commit**

Commit message: `feat: add grapheme-safe community initials`.

### Task 2: Share image preparation model and canvas component

**Files:**
- Modify: `miniprogram/src/utils/community-share.ts`
- Modify: `miniprogram/src/utils/__tests__/community-share.test.ts`
- Create: `miniprogram/src/components/CommunityShareImageCanvas.vue`
- Create: `miniprogram/src/utils/__tests__/community-share-image.test.ts`

- [ ] **Step 1: Write failing helper and component-contract tests**

```ts
expect(buildCommunityShareImageKey({ id: 'c1', name: ' 明士班 ', coverImage: '' }))
  .toBe('v1|c1|明士班|')
expect(selectPreparedCommunityShareImage('v1|c1|明士班|', { key: 'v1|c2|青山|', imageUrl: '/tmp/old.png' }))
  .toBe('')
expect(componentCode).toContain('uni.createCanvasContext')
expect(componentCode).toContain('uni.canvasToTempFilePath')
expect(componentCode).toContain('uni.getImageInfo')
```

- [ ] **Step 2: Verify RED**

Run: `npx.cmd vitest run miniprogram/src/utils/__tests__/community-share.test.ts miniprogram/src/utils/__tests__/community-share-image.test.ts`
Expected: FAIL because helpers/component do not exist.

- [ ] **Step 3: Implement helpers and component**

Add typed key/result helpers to `community-share.ts`. Implement a permanently mounted `500 × 400` canvas positioned offscreen. Watch `{ communityId, communityName, coverImage }`; clear prior output immediately; resolve/probe cover images; otherwise draw background and centered initial using `600 160px sans-serif`; export PNG; discard any completion whose key is stale. Expose `preparedImageUrl` and emit `update:image-url`.

- [ ] **Step 4: Verify GREEN**

Run the Task 2 Vitest command. Expected: all tests PASS.

- [ ] **Step 5: Commit**

Commit message: `feat: generate community initial share images`.

### Task 3: Integrate home/profile sharing and avatar surfaces

**Files:**
- Modify: `miniprogram/src/pages/index/index.vue`
- Modify: `miniprogram/src/pages/profile/index.vue`
- Modify: `miniprogram/src/pages/community-switch/index.vue`
- Modify: `miniprogram/src/pages/onboarding/index.vue`
- Modify: `miniprogram/src/utils/__tests__/community-share-pages.test.ts`

- [ ] **Step 1: Write failing page-contract tests**

Assert home and profile render `CommunityShareImageCanvas`, bind current community ID/name/cover, and use prepared output without `DEFAULT_COMMUNITY_SHARE_IMAGE`; assert all three avatar pages import and call `communityInitial`; assert home records image error and hides failed hero image.

- [ ] **Step 2: Verify RED**

Run: `npx.cmd vitest run miniprogram/src/utils/__tests__/community-share-pages.test.ts`
Expected: FAIL on missing component/helper integration.

- [ ] **Step 3: Implement page integration**

Mount the canvas component in home and profile, store emitted URL, and omit `imageUrl` when empty. Replace page-local `charAt(0)` initials with `communityInitial`. Make the home hero computed value empty after its current image probe reports `failed`. Add `font-family: $hh-font-sans`, weight 600, and existing brand colors to all fallback styles.

- [ ] **Step 4: Verify GREEN**

Run the Task 3 Vitest command. Expected: all tests PASS.

- [ ] **Step 5: Commit**

Commit message: `feat: use community initials across sharing`.

### Task 4: Full verification and delivery

**Files:**
- Modify only files required by failures attributable to this branch.

- [ ] **Step 1: Run focused tests**

Run: `npx.cmd vitest run miniprogram/src/utils/__tests__/community-avatar.test.ts miniprogram/src/utils/__tests__/community-share.test.ts miniprogram/src/utils/__tests__/community-share-image.test.ts miniprogram/src/utils/__tests__/community-share-pages.test.ts`.
Expected: all PASS.

- [ ] **Step 2: Run the mini-program suite**

Run: `npm.cmd run test:mp`.
Expected: exit 0.

- [ ] **Step 3: Run static checks**

Run: `npm.cmd run docs:check` and `git diff --check origin/main...HEAD`.
Expected: exit 0 with no whitespace errors.

- [ ] **Step 4: Runtime verification when the validation lease and DevTools are available**

Run `npm.cmd run validation:lease:status`, then use the existing mini-program DevTools flow without taking over another owner. Verify an avatarless temporary community from home and profile share entry points, verify an existing-avatar community remains unchanged, and clean up only the temporary fixture created by this task. If DevTools or a logged-in WeChat share target is unavailable, report that exact gap rather than claiming runtime verification.

- [ ] **Step 5: Request code review and fix Critical/Important findings**

Review `origin/main..HEAD` against the design spec, rerun affected tests after fixes, and commit with `fix: address community avatar review` if changes are needed.

- [ ] **Step 6: Push, open PR, and follow Merge Queue to terminal state**

Push `codex/community-initial-share-avatar`, create a non-draft PR documenting tests and runtime gaps, poll exact-HEAD checks/reviews/comments, arm with `gh pr merge <N> --auto --merge` once merge-ready, and continue until `MERGED` or `CLOSED`.
