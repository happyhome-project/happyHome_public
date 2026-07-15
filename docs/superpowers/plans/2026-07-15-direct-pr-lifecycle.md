# Direct PR Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make each feature session directly own its GitHub PR through Merge Queue terminal state without webhook or watchdog dependency.

**Architecture:** `AGENTS.md` and `docs/SETUP.md` are the repository-visible contract. The shared `pr-feedback-loop` skill mirrors that contract for any session that enters PR work. A targeted documentation-policy test prevents regression.

**Tech Stack:** Markdown, Node.js `node:test`, GitHub CLI, GitHub Merge Queue.

---

### Task 1: Lock the repository contract

- [x] Add a failing policy test requiring GitHub exact HEAD authority, non-blocking webhook behavior, no watchdog, and direct Merge Queue ownership.
- [x] Update `AGENTS.md`, `docs/SETUP.md`, and the change note with the approved lifecycle.
- [x] Run the targeted and complete documentation-policy tests.

### Task 2: Align the shared skill

- [x] Capture baseline behavior showing the old skill waits for synchronize webhook.
- [x] Rewrite `pr-feedback-loop/SKILL.md` so GitHub is authoritative and the feature session owns CI and Merge Queue to terminal state.
- [x] Re-run the pressure scenario against the revised skill and inspect for contradictions.

### Task 3: Integrate

- [ ] Commit as AngryBird, push the feature branch, open a ready PR, follow exact-head CI, arm Merge Queue, and monitor to `MERGED` or `CLOSED`.
