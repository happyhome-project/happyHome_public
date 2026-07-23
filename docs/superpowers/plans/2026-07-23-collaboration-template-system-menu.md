# Collaboration Template System Menu Implementation Plan

> **Historical / point-in-time:** This delivery plan records the approved 2026-07-23 implementation sequence. Retain it for traceability; do not treat its task state as current repository status.
> **Current authority:** Use the [documentation authority map](../../README.md), current admin navigation code, and tests.

## Original historical instructions (do not execute)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the super-admin collaboration-template menu entry into the collapsible System Management section and keep that section visible on its routes.

**Architecture:** Preserve the existing route, page, permission guard, local-storage key, and menu test id. Change only the sidebar hierarchy and derive the initial/route-change expansion state from the three System Management routes.

**Tech Stack:** Vue 3, TypeScript, Element Plus, Vue Router, Node test runner.

## Global Constraints

- Keep `/collaboration-templates` and `requiresRole: 'superAdmin'` unchanged.
- Keep the menu restricted to the existing super-admin System Management block.
- Do not change collaboration-template CRUD, API, or backend code.

---

### Task 1: Relocate the menu and auto-expand active system routes

**Files:**
- Modify: `admin-web/tests/community-navigation-contract.test.mjs`
- Modify: `admin-web/tests/collaboration-template-admin-contract.test.mjs`
- Modify: `admin-web/src/views/Layout.vue`
- Create: `docs/superpowers/specs/2026-07-23-collaboration-template-system-menu-design.md`
- Create: `docs/superpowers/plans/2026-07-23-collaboration-template-system-menu.md`

**Interfaces:**
- Consumes: Vue Router `route.name`, existing `SYSTEM_EXPANDED_KEY`, and existing System Management toggle.
- Produces: `isSystemManagementRoute()` and a System Management child menu order of collaboration templates, administrator management, then guest-intro configuration.

- [x] **Step 1: Write the failing contract tests**

Add assertions that the collaboration-template item appears after `system-management-toggle`, is gated by `systemManagementExpanded`, precedes `menu-admin-accounts`, and that the layout recognizes all three System Management route names.

- [x] **Step 2: Run the tests to verify RED**

Run:

```powershell
node --test admin-web/tests/community-navigation-contract.test.mjs admin-web/tests/collaboration-template-admin-contract.test.mjs
```

Expected: FAIL because `menu-collaboration-templates` is still above `system-management-toggle` and no route-aware expansion helper exists.

- [x] **Step 3: Write the minimal implementation**

Move the existing collaboration-template menu item under the System Management toggle. Add:

```ts
function isSystemManagementRoute(routeName: unknown): boolean {
  return ['collaboration-templates', 'admin-accounts', 'guest-intro-config'].includes(String(routeName || ''))
}
```

Initialize `systemManagementExpanded` from either the active route or the existing local-storage preference, and expand it when navigation enters one of those routes.

- [x] **Step 4: Run targeted tests to verify GREEN**

Run:

```powershell
node --test admin-web/tests/community-navigation-contract.test.mjs admin-web/tests/collaboration-template-admin-contract.test.mjs
```

Expected: all tests pass.

- [x] **Step 5: Run full admin verification**

Run:

```powershell
npm.cmd --workspace admin-web run test:unit
npm.cmd --workspace admin-web run type-check
npm.cmd --workspace admin-web run build
git diff --check
```

Expected: every command exits 0.

- [x] **Step 6: Commit**

Stage only the two documentation files, the two test files, and `Layout.vue`, then commit as:

```text
fix(admin): move collaboration templates under system management
```
