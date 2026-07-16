# Guest Login First Paint Design

> **Historical / point-in-time:** This specification records the design accepted for the 2026-07-16 delivery. It does not override later product or implementation decisions.
> **Current authority:** Use the [documentation authority map](../../README.md), current home-page code, and tests.

## Goal

For a signed-out cold start, show the existing guest login introduction on the first rendered frame instead of briefly exposing the uninitialized "选择社区" or empty-feed page. Home data loading begins at app startup in parallel with the login flow.

## Startup state model

The home page distinguishes three states:

1. **Signed out:** render the guest login mask immediately from the compiled default guest-intro configuration. Community and home bootstrap requests start immediately behind it.
2. **Signed in, home pending:** dismiss the login mask and render a dedicated home-entry skeleton. Do not render "选择社区", an empty feed, or a publish empty state while the authenticated home snapshot is unresolved.
3. **Home ready:** atomically replace the skeleton with the normal community home.

The server-provided guest-intro configuration still replaces the local default when bootstrap returns. A server-disabled intro may then hide it, while the compiled default prevents the initial blank-page flash on a fresh installation.

## Login interaction

- Choosing an avatar moves the existing mini-program form to nickname mode.
- The `type="nickname"` input receives focus after the avatar chooser closes, allowing WeChat's nickname suggestion UI to appear without another tap.
- The implementation does not call a keyboard API or invent a nickname.
- Home bootstrap starts independently during page initialization; avatar selection and login never gate the request.

## Error handling

- Guest bootstrap failure leaves the login flow usable.
- After successful login, an unresolved home refresh shows the entry skeleton.
- A failed authenticated refresh exits the skeleton into the existing retryable home error state rather than returning to the login mask.

## Scope

- Modify only mini-program home startup/render state and focused tests.
- Do not change authentication APIs, cloud data, guest-intro administration, community selection, or release behavior.

## Verification

- Unit/static tests prove the first-frame guest mask is seeded synchronously, bootstrap still starts during initialization, nickname focus follows avatar selection, and pending authenticated data renders a skeleton rather than an empty page.
- Build the WeChat mini-program.
- With a free validation lease, clear local login state in DevTools and verify the cold-start sequence visually.
