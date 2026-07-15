# Figma 0710 Visual QA

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

- Source visual truth: `X:\Users\86136\AppData\Local\Temp\codex-clipboard-1e5d04b9-0028-431c-bc54-a1d0c1635952.png`
- Implementation screenshot: `X:\Users\86136\AppData\Local\Temp\happyhome-publish-icon-style.png`
- Focused implementation screenshot: `X:\Users\86136\AppData\Local\Temp\happyhome-publish-icon-style-focused.png`
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
