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
