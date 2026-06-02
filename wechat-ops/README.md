# WeChat Ops

WeChat operations utilities for HappyHome.

This folder is intentionally separate from the existing deployment scripts. It is for pulling official WeChat analytics data, checking Mini Program customer-service accounts, and adding customer-service accounts when explicitly requested. It does not submit audits or release mini-program versions.

## Setup

1. Copy `.env.example` to `.env.local`.
2. Fill either `WECHAT_APP_ID` + `WECHAT_APP_SECRET`, or `WECHAT_ACCESS_TOKEN`.
3. Keep `.env.local` local. Do not commit secrets.

## Commands

List supported endpoints:

```bash
npm --prefix wechat-ops run list
```

Dry-run a request without calling WeChat:

```bash
npm --prefix wechat-ops run fetch -- official.article-summary --begin 2026-05-25 --end 2026-05-25 --dry-run
```

Fetch and save JSON:

```bash
npm --prefix wechat-ops run fetch -- mini.daily-visit-trend --begin 2026-05-25 --end 2026-05-25
```

List Mini Program customer-service accounts:

```bash
npm --prefix wechat-ops run kf:list
```

Add a Mini Program customer-service account:

```bash
npm --prefix wechat-ops run kf:add -- --account feedback@your_account_suffix --nickname HappyHome客服
```

Invite a WeChat user to bind a customer-service account:

```bash
npm --prefix wechat-ops run kf:invite -- --account feedback@your_account_suffix --invite-wx wx123456
```

Preview a customer-service request without calling WeChat:

```bash
npm --prefix wechat-ops run kf:add -- --account feedback@your_account_suffix --nickname HappyHome客服 --dry-run
```

## Endpoint groups

- `official.*`: Official Account article and user analytics under `/datacube/*`.
- `mini.*`: Mini Program analytics under `/datacube/*` and related performance APIs.

## Safety

- Secrets are loaded from environment variables or `.env.local`.
- The CLI never prints app secrets.
- Output files are written under `reports/` by default.
- Network calls are only made by `fetch` and non-dry-run `kf:*` commands; `list` and `--dry-run` are local.

## Official docs

- Official Account article analytics: https://developers.weixin.qq.com/doc/offiaccount/Analytics/Graphic_Analysis_Data_Interface.html
- Official Account user analytics: https://developers.weixin.qq.com/doc/offiaccount/Analytics/User_Analysis_Data_Interface.html
- Mini Program data analysis: https://developers.weixin.qq.com/miniprogram/dev/server/API/data-analysis/
- Mini Program customer service guide: https://developers.weixin.qq.com/miniprogram/introduction/custom.html
- Mini Program customer-service API list: https://developers.weixin.qq.com/miniprogram/dev/server/API/kf-mgnt/kf-message/
