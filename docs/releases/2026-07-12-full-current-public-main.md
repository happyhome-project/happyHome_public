# 2026-07-12 Full-Current Public-Main Release

> **Historical / point-in-time:** This document records one completed release and is not an operational runbook. **当前权威 / Current authority:** follow the [current release gate](../release-gate.md).

- Public main SHA: `965ab0a4d46078f89ecda832aaddb919a1995133`
- Release strategy: `full-current`
- Release run ID: `20260712T213500-full-current-public-main`
- Mini-program version: `1.0.2607122116`
- Description: `full-current-public-main-ba1e5bd`
- Result: local release ledger `passed`; remote production state confirmed the same SHA and run ID; production lock released; no pending release remained.

All ten CloudBase functions were deployed and returned exact-SHA version probes. Release-owned cloud smoke, log capture, temporary fixture cleanup, admin-web deployment, mini-program package digest verification, and WeChat DevTools development-build upload passed.

The upload did not prove that the development build was selected as the WeChat trial version, and it did not claim true-device success without separate phone or recorded-replay evidence.
