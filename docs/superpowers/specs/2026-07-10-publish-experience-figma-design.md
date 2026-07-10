# Publish Experience Figma Alignment Design

## Objective

Align the mini-program publish entry and publish forms with the current `0709_v2` Figma source while preserving the existing section/widget data model.

## Confirmed Design Sources

- Publish sheet: Figma node `20022:1286`, especially sheet node `20022:1502`.
- Publish icons: Figma nodes `20040:4379`, `20040:4434`, `20040:4465`, `20040:4500`, `20040:4537`, and `20040:4559`.
- Date field icon: Figma node `20023:1670` inside field node `20023:1663`.
- Save-draft icon: Figma node `20023:1552` inside footer node `20001:14969`.
- Guide content card: Figma node `20001:14790`.

## First-Principles Decisions

1. The backend widget schema remains the source of truth. Visual grouping must not rename, duplicate, or discard saved fields.
2. Shared controls are fixed once at the shared renderer. Every `datetime` widget receives the same date-field presentation, and every publish form uses the same draft action.
3. Figma assets are copied into the repository. Runtime UI must not depend on expiring Figma asset URLs.
4. Activity title and detail describe one piece of content, while date and location are metadata. On the `活动公告` publish page, title and detail therefore share the first content card; date, location, and additional widgets remain independent cards below it.
5. The activity layout is semantic and defensive: it activates for an activity-announcement section only when both a title-like widget and a body-like widget exist. Otherwise the existing generic renderer remains in control.

## UI Structure

### Publish Sheet

- Keep the current four-column responsive grid.
- Keep each icon slot at 52 CSS pixels with a 36 CSS pixel foreground asset.
- Replace the locally approximated icons with assets exported from the Figma nodes above.
- Preserve current dynamic section labels and the `活动召集` compatibility label normalization from main.

### Date Field

- Keep `uni-datetime-picker` as the interaction engine and current value format (`YYYY-MM-DDTHH:mm:00`).
- Present it as the Figma-style bordered control with the exact calendar icon and `选择日期时间` placeholder.
- Apply the presentation inside `WidgetEditor.vue`, so all section forms receive it without per-page branching.

### Draft Action

- Replace the text glyph with the exact Figma `md-save` asset.
- Keep the existing save behavior, storage key, toast, and footer layout.

### Activity Announcement

- Detect the section by normalized name containing `活动公告`.
- Resolve the first title-like widget (`fieldKey`/label/type semantics) and first body-like widget (`rich_text`, `rich_note`, `note_blocks`, or remaining `summary`).
- Render both in one top card using the same compact title/body editor treatment as the guide publish page.
- Render all unconsumed widgets in their original order below the top card.
- If either main widget is absent, render every widget generically.

## Validation

- Pure unit tests cover semantic widget resolution and fallback behavior.
- A static UI guard covers Figma asset usage, the shared date control, the draft asset, and the activity content block.
- H5 browser QA covers publish sheet, a generic datetime form, activity announcement, and guide publishing.
- Type-check, unit tests, H5 build, and mp-weixin build verify packaging and platform compatibility.
