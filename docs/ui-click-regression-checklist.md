# UI Click Regression Checklist

This checklist focuses on obvious interaction failures in form-like pages (especially mini program pages).

## Scope

- `miniprogram/src/pages/create/index.vue`
- `miniprogram/src/pages/detail/index.vue`
- `miniprogram/src/components/widgets/WidgetEditor.vue`
- `admin-web/src/views/CommunityAdmin/WidgetEditor.vue`

## Must-pass manual click checks

1. Create page entry
- First entry can show membership checking once.
- Returning from picker/map should not flash full-page membership checking again.
- Section switching should not lose page responsiveness.

2. Datetime widgets
- Date picker can open.
- Time picker can open.
- Date then time updates value correctly.
- Time then date also updates value correctly.

3. Location widget
- "选择位置" opens map selector.
- Returning from map keeps current form state.
- No full-page guard flash on return.

4. Widget labels
- No raw placeholder label like `新控件` on user-facing form.
- Admin cannot save placeholder labels.

5. Submit path
- Required fields still block submit correctly.
- Image upload fields still upload and submit correctly.

## Automated coverage in repo

- `miniprogram/src/utils/__tests__/widget-form.test.ts`
  - placeholder label normalization
  - datetime split/build helpers
- `cloud/functions/section/__tests__/section.test.ts`
  - reject placeholder widget labels
- `cloud/functions/admin/__tests__/admin.test.ts`
  - reject placeholder widget labels via admin route

## Guardrails to prevent repeat issues

- Do not use unsupported picker mode values (e.g. `dateTime` in mini program picker).
- Any full-screen loading guard must distinguish:
  - initial blocking check
  - background refresh (non-blocking)
- New widget creation must always assign a semantic default label by type.
- Backend validation must reject placeholder labels even if frontend is bypassed.
