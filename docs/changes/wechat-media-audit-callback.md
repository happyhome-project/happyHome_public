# WeChat media audit callback

> **Historical / point-in-time:** This fragment records the 2026-07-15 feature delivery and does not represent current deployment or merge status.
> **Current authority:** Use the [formal release gate](../release-gate.md), current code, production configuration, and tests.

User text safety checks already completed synchronously, but image/audio checks could remain pending forever because no WeChat message-push endpoint consumed their asynchronous result. This change adds a dedicated, signature-verified HTTP callback function and reuses the existing audit aggregation path so a safe media result automatically publishes the post.

The mini program now tells authors that pending media will publish or update automatically after passing. Release configuration must provide `WX_APPID`, `WX_APPSECRET`, and a strong `WX_MESSAGE_TOKEN` outside Git, deploy the dedicated callback as HTTPS, and configure the Mini Program message-push console for JSON plaintext delivery. Existing pending posts are not silently approved.
