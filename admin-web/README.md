# HappyHome Admin Web

The Admin Web workspace is the Vue 3 and Element Plus management UI for community approval, configuration, moderation, members, sections, widgets, and posts.

## Local development

Run from the repository root:

```powershell
npm.cmd --workspace admin-web run dev
npm.cmd --workspace admin-web run type-check
npm.cmd --workspace admin-web run build
```

The API client reads `VITE_CLOUD_API_URL`. Routing uses browser history by default; set `VITE_ROUTER_MODE=hash` only for a host that cannot serve the SPA fallback. Optional map features read `VITE_AMAP_JS_KEY` and `VITE_AMAP_SECURITY_CODE`.

Do not commit credentials or environment-specific values. See [project setup](../docs/SETUP.md) for environment prerequisites and [Admin Web deployment](../docs/admin-web-deploy.md) for the maintained production-host procedure. Formal release ordering and evidence are owned by the [release gate](../docs/release-gate.md).

## Code entry points

- `src/main.ts`: application bootstrap.
- `src/router/index.ts`: routes and role guards.
- `src/api/cloud.ts`: CloudBase HTTP client.
- `src/views/`: super-admin and community-admin screens.
- `src/components/`: shared editors and management UI.
