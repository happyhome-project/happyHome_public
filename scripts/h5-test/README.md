# H5 test scenarios

Individual, independently-runnable scenarios against the real CloudBase via `http-gateway`.

Each script:
- Uses a unique `runId` so repeated runs don't collide
- Seeds its own test data (community/section/widgets) when needed
- Exits with code 0 on pass, 1 on fail
- Prints `✓`/`✗` markers for each assertion

## Run

```bash
cd C:\Project\Claude\happyHome

node scripts/h5-test/01-login.mjs
node scripts/h5-test/02-community-create-and-approve.mjs
node scripts/h5-test/03-post-lifecycle.mjs
node scripts/h5-test/04-permission.mjs
node scripts/h5-test/05-required-widgets.mjs
node scripts/h5-test/06-cold-start-user-journey.mjs
node scripts/h5-test/07-approval-community-journey.mjs
node scripts/h5-test/08-concurrent-clicks.mjs
```

Or all at once (any failure → exit 1):

```bash
for f in scripts/h5-test/0*.mjs; do node "$f" || exit 1; done
```

## Environment

- `CLOUD_API_URL` — override the CloudBase HTTP base (default: prod host)
- `ADMIN_TOKEN` — bearer token (default: `happyhome-admin-2024`)

## When to reach for these vs `test-h5-e2e.mjs`

- **Single scenario**: debug one flow, faster iteration
- **`test-h5-e2e.mjs`**: smoke-test everything in one script (CI)

Both use the same `_shared.mjs` helpers.
