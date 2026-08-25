# Figma 0710 Visual QA

> **Historical / point-in-time:** This document is historical: it records dated visual QA evidence and is not current implementation authority. **当前权威 / Current authority:** follow the [documentation authority map](./docs/README.md) and [interaction principles](./docs/UX-PRINCIPLES.md).

## Scope and source of truth

- Figma file: `社区资源共享_小程序_0710` (`a0yB3Ht7e3LZ1FguQdft7L`).
- Home reference: node `20001:13955`.
- Logged-in profile reference: node `20001:14442`.
- Logged-out profile reference: node `20032:1165`.
- Search was explicitly excluded from review and implementation.
- Reviewed only the approved findings 1, 4, 5, 6, and 7.

## Evidence

- Combined source/implementation canvas: `output/visual-qa/figma-0710/comparison.png`.
- Native mini-program logged-out profile: `output/visual-qa/figma-0710/implementation-profile-logged-out-native.png`.
- H5 viewport captures: `output/visual-qa/figma-0710/implementation-home.png`, `implementation-profile-logged-out.png`, and `implementation-profile-logged-in.png` at 402 x 874.
- Figma exports: `output/figma-0710/home-20001-13955.png`, `profile-logged-out-20032-1165.png`, and `profile-logged-in-20001-14442.png`.
- Native release gate: `HH_RELEASE_PROFILE_LOGIN_CLEAN` passed and captured the logged-out profile after clearing user/community stores.

## Focused findings

| Finding | Visual comparison result | Supporting check | Severity after fix |
| --- | --- | --- | --- |
| 1. Logged-out developer/debug UI | Logged-out H5 and native captures show one `登录` entry and no visible DEV login, build version, or diagnostics card. | Native release UI gate passed; H5 DOM check reported `devText=false`, `versionText=false`, and `diagnostics=false`. | None |
| 4. Emoji home tabs | Both rendered tab rows use text-only labels; no emoji/glyph prefix remains. | H5 DOM projection returned four plain labels and `hasEmoji=false`. | None |
| 5. Raw HTML in post titles | Rendered home feed contains plain titles without visible HTML tags. | H5 DOM check reported `hasRawHtml=false`; formatter unit tests cover block, inline, entity, script/style, numeric-entity, and object inputs. | None |
| 6. Long community title hides switch | Logged-in capture truncates `HappyHome H5 固定测试社区` while preserving the adjacent `切换` control and `编辑`. | Static UI test locks title shrink/ellipsis and switch non-shrink behavior. | None |
| 7. Edit/logout stacking | Logged-in identity card contains `编辑`; `退出登录` is a separate bottom action below `退出当前社区`. | H5 rendered-state checks found exactly one edit, one community exit, and one logout action after data settled. | None |

## Full-frame review

- The overall profile hierarchy, spacing, card grouping, action order, and mint/white palette remain consistent with the 0710 reference at the target viewport.
- Home content imagery and section data differ because the implementation capture uses the fixed H5 test community. Those data differences are not visual regressions in the five approved findings.
- The H5 test community has one membership, so the home switch is conditionally absent there. The logged-in profile provides the rendered long-title/switch evidence; home flex behavior is separately guarded by the static visual contract.
- Search copy and styling differences were not evaluated because the user explicitly excluded search.

## Comparison history

1. Initial implementation review found the H5 manual login form opened automatically; it was changed to preserve the Figma logged-out shell until the user selects `登录`.
2. Code-quality review found inline rich-text spacing and release-gate login-entry coverage gaps; both were corrected and re-reviewed.
3. Final 402 x 874 H5 comparison and native mini-program release-state capture found no remaining P0, P1, or P2 issue within the approved scope.

final result: passed

## Full-page remediation follow-up (2026-07-13)

The later full-file pass stayed on the same Figma 0710 source. Search and the
`AI帮你写` affordance remained explicitly out of scope. The implementation fixes
were limited to the visible discrepancies found in that pass:

| Surface | Corrected visual behavior | Verification |
| --- | --- | --- |
| Home empty state | Shows the Figma empty illustration, explanation, and existing create CTA only after community and section loading have settled. | Focused state tests and the home static contract. |
| Default detail | Leads with the resolved post title, then author/avatar/date, then section metadata and body. Rich semantic fields remain visible instead of being consumed as titles. | Detail formatter/component tests and H5 402 x 874 capture. |
| Notice detail | Keeps the independent notice route and uses the white 0710 hierarchy without fabricating section creation metadata. | Notice component tests and static contract. |
| Publish sheet | Uses content-driven height, four-column layout, safe-area spacing, and stable Figma-derived neutral/semantic icons. | Publish UI tests, static contracts, and H5 402 x 874 capture. |
| Publish form | Uses only the native navigation header; the duplicate in-content back arrow was removed. | Static contract and H5 402 x 874 capture. |
| Profile editing | Keeps the profile visible below a 55% mask and opens an accessible bottom sheet with avatar, nickname, cancel, save, and safe-area handling. | Profile session/race tests, static contract, and H5 402 x 874 capture. |

Rendered comparison artifacts are under
`output/figma-0710-full-audit/comparisons-after/`; green-framed left images are
the corrected implementation and blue-framed right images are the corresponding
Figma 0710 references. Fixture-dependent content and the intentionally excluded
AI affordance are not treated as visual regressions.

---

## 发布入口图标风格 QA（2026-07-15）

- Machine-local source and capture paths were intentionally not retained as repository evidence; use the checked-in evidence and verification references above.
- Viewport: 390 × 844 CSS pixels (browser capture content width 360 pixels)
- State: 首页打开发布面板，三种发布入口全部可见

## Full-view comparison evidence

The implementation preserves the reference's visual grammar: saturated flat illustration icons, softly tinted rounded-square tiles, centered labels, a white bottom sheet, and a circular close control. The implementation intentionally contains three product-level publishing actions instead of the six historical section categories shown in the reference, so the sheet is shorter.

## Focused region comparison evidence

The focused comparison was required because icon scale, color density, and label alignment are too small to judge reliably in the full-screen capture. All three implementation tiles use the same relative scale and corner treatment as the reference. The blue, orange, and cyan roles remain visually distinct without relying on color alone because each option also has a unique illustration and label.

## Required fidelity surfaces

- Fonts and typography: existing product font stack, label size, weight, line height, and single-line alignment are preserved; no wrapping or truncation is visible.
- Spacing and layout rhythm: three equal grid tracks, even horizontal gaps, consistent icon-to-label spacing, and centered close control match the reference pattern.
- Colors and visual tokens: pale blue, pale amber, and pale cyan tile backgrounds support the corresponding saturated illustrations without competing with the green primary action color.
- Image quality and asset fidelity: existing project SVG illustration assets are used at their native aspect ratio; no text glyphs, emoji, CSS drawings, or handcrafted replacement artwork remain.
- Copy and content: labels remain `发图文`, `写文字`, and `发起协作`, matching the current publishing information architecture.

## Findings

- No actionable P0, P1, or P2 visual mismatch.
- Acceptable intentional deviation: the reference shows six historical section categories, while the implementation shows only the three current publishing modes.
- Environment note: the local H5 tenant could not load home cloud data and logged cloud-call errors, but the publish panel rendered correctly and the `发图文` interaction still navigated to the expected editor route. This does not affect the icon-style comparison.

## Comparison history

- Pass 1: no actionable P0/P1/P2 differences found; no visual fix was required after the side-by-side full-view and focused-region comparisons.

## Interaction evidence

- Flow: 首页 → 点击底部加号 → 三个彩色发布入口出现 → 点击 `发图文` → 路由包含 `archiveFormat=image_text`，编辑器状态显示 `发图文`。
- Console: checked errors and warnings; only the explained local cloud-data failures were present.

## Final result

final result: passed

---

## Video note detail design QA (2026-08-26)

### Evidence and normalization

- Source visual truth: `X:\Users\86136\.codex\visualizations\2026\07\14\019f5f60-1e10-7a11-9332-fd699c500d42\video-note-mockup\video-note-detail.png`.
- Browser-rendered implementation: `X:\Users\86136\.codex\visualizations\2026\07\14\019f5f60-1e10-7a11-9332-fd699c500d42\video-note-mockup\video-note-detail-implementation-390x844.png`.
- Side-by-side comparison input: `X:\Users\86136\.codex\visualizations\2026\07\14\019f5f60-1e10-7a11-9332-fd699c500d42\video-note-mockup\video-note-comparison-final.png`.
- Viewport: 390 x 844 CSS pixels; device pixel ratio 1.
- Source pixels: 390 x 844. Implementation pixels: 390 x 844. No density resampling was used in the final comparison.
- State: paused native archive video note, author-owned post, cover visible, author/date/community/title/body/topic/footer visible.
- Host normalization: the source includes the WeChat status bar and capsule while the H5 implementation capture begins at the native page navigation bar. The content regions were aligned by their navigation and hero boundaries; this host-chrome difference is not application UI drift.

### Full-view comparison evidence

- The production renderer preserves the approved sequence and proportions: native navigation, full-width 16:9 cover, centered play affordance, author/community row, title, body, topics, and a quiet footer.
- The hero crop uses the exact approved `鲲鹏` cover and preserves its sharpness, subject, contrast, and aspect-fill treatment.
- The page remains intentionally free of comment, like, and favorite controls because those interaction loops do not exist in the product yet.

### Focused region comparison evidence

- A separate crop was not needed: both 390 x 844 images are readable at 1:1 in the combined comparison, including the author row, title wrapping, topic pill, divider, and settings affordance.

### Required fidelity surfaces

- Fonts and typography: the existing mini-program font stack, bold title hierarchy, medium author weight, muted date/footer labels, line height, and wrapping follow the approved mock. The H5 host rasterizes Chinese text slightly heavier than the static mock, with no clipping or hierarchy change.
- Spacing and layout rhythm: the 16:9 hero, author-row spacing, content gutter, title/body gaps, pill spacing, divider, and footer rhythm match the approved composition. No horizontal overflow or hidden control was observed.
- Colors and visual tokens: the implementation uses existing HappyHome brand tokens for pale mint surfaces, green labels, neutral text, white canvas, and subtle dividers.
- Image quality and asset fidelity: the approved cover and author asset were used for QA. The play control uses the repository's existing icon font instead of a text glyph, emoji, CSS drawing, or handcrafted SVG.
- Copy and content: `内容沉淀 · 视频笔记`, author/date, community name, title, body, topic, and author-only `编辑和设置` match the approved information architecture.

### Findings

- No actionable P0, P1, or P2 visual mismatch remains.
- P3 acceptable host difference: the H5 QA capture omits the WeChat status bar and capsule that are supplied by the real mini-program host.

### Comparison history

1. Pass 1 found a P2 state-dependent omission: the community pill could disappear when a video detail was opened from a route whose community was not already in the current store.
2. Fix: the detail page now resolves the post's community name from the exact cached community when present and otherwise performs a read-only `community.get` fallback.
3. Pass 2: the final 390 x 844 comparison shows the `明士班` pill and no remaining P0/P1/P2 difference.

### Interaction and console evidence

- Author-only `编辑和设置` opened the existing post settings sheet and exposed the `编辑` and `删除` actions.
- The final isolated render produced no new console error. Earlier retained log entries came from deliberately visiting the real private post without an H5 member session and from an intermediate hot-reload syntax error that was corrected before the final capture.

final result: passed

---

## Audio posts design QA (2026-08-17)

### Scope

- Reference: `X:\Users\86136\AppData\Local\Temp\codex-clipboard-48903ca1-0f1a-401e-87d1-06db1a1d5a68.png`
- Implementation: `miniprogram/src/components/AudioPostDetailView.vue` and `miniprogram/src/components/ArchiveWaterfall.vue`
- Comparison image: `X:\Users\86136\.codex\visualizations\2026\08\17\01a00e38-f564-7040-addc-37d57c2bc3f6\audio-posts-qa\detail-final-comparison.png`
- Detail evidence: `X:\Users\86136\.codex\visualizations\2026\08\17\01a00e38-f564-7040-addc-37d57c2bc3f6\audio-posts-qa\detail-matched-fixed-0202-top-396x844.png`
- Feed evidence: `X:\Users\86136\.codex\visualizations\2026\08\17\01a00e38-f564-7040-addc-37d57c2bc3f6\audio-posts-qa\search-audio-card-final-396x844.png`
- Viewport: 396 px rendered content width, 844 px height. The component comparison removes only the host page's 48 px navigation bar so the reference and implementation begin at the same content boundary.
- State: first track playing at 02:02 of 05:18, two-track playlist, bundled default cover.

### Visual review

- Typography and hierarchy: title, author/date, cover, current track, controls, progress, and ordered tracks follow the approved sequence.
- Spacing and sizing: the full-width production page uses the existing HappyHome page gutter and keeps a square cover, centered controls, and compact track rows without clipping.
- Color: the green action and active states, pale active-row fill, neutral metadata, and white card surface remain consistent with the approved direction and existing product tokens.
- Image fidelity: the bundled watercolor cover has the required Jiangnan lake-and-pagoda subject, quiet palette, square crop, and sufficient contrast for overlaid feed metadata.
- Copy and information boundary: the rendered detail contains title, author/date, playback information, and tracks only. `距离`, `海拔`, `累计爬升`, `参考用时`, `位置`, `导航`, `路线`, and `活动` are absent.
- Reference-alignment fix: the active-track marker was changed from a speaker glyph to the local icon font's bar-chart glyph so it matches the approved equalizer treatment without adding a CDN or hand-drawn asset.

### Interaction and accessibility review

- Play/pause changes the central control and active-track marker through the production audio store.
- Track selection changes the current track; natural end advances to the next track.
- The progress UI updates from the backend time event, and the main transport controls expose descriptive `aria-label` values.
- Feed cards display a static audio affordance, track count, and total duration. They do not start inline playback; the whole card navigates to the detail page.
- The isolated browser run produced no runtime errors. Its only warning was the existing duplicate detail-load guard (`detail.load.skip.busy`).

### Environment boundary

- QA used a local H5 build with an in-page `wx.cloud.callFunction` fixture, local/data-URL audio, and blocked external requests.
- No production deployment, mini-program upload, shared-cloud write, or real user data was used.
- WeChat DevTools and iOS/Android background-audio timing remain runtime-release checks rather than visual blockers for this review.

final result: passed
