# Guest Browse Default Community Design

> **Historical / point-in-time:** This specification records the design accepted for the 2026-07-17 delivery. It does not override later product or implementation decisions.
> **Current authority:** Use the [documentation authority map](../../README.md), current home-page code, guest-intro configuration, and tests.

## Goal

Replace the guest introduction's community-creation action with “先随便看看”. Selecting it closes the introduction and reveals the already-prefetched default public community, currently “阳光花园社区”.

## Behavior

- The primary WeChat login action is unchanged.
- The secondary action reads “先随便看看” and has no plus icon.
- Selecting it records the current introduction version as seen and closes the mask.
- It does not open onboarding, create a community, log the user in, or start a duplicate bootstrap request.
- Home bootstrap continues from app startup. If it has not resolved when the mask closes, the existing entry loading treatment remains visible until the public snapshot is ready; the normal home then renders the default public community supplied by the backend.
- Existing stored server configuration values using the old creation copy normalize to the new copy so released configuration cannot restore the obsolete wording.

## Verification

- Unit/static tests cover default copy, legacy-copy normalization, absence of the plus icon, and the secondary handler's no-navigation behavior.
- Run type checking, focused tests, the full mini-program suite, and the WeChat mini-program build.
