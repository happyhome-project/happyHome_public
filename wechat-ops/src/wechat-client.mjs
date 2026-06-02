const API_BASE = "https://api.weixin.qq.com";

export async function fetchAccessToken({ appId, appSecret, fetchImpl = fetch }) {
  if (!appId || !appSecret) {
    throw new Error("WECHAT_APP_ID and WECHAT_APP_SECRET are required when WECHAT_ACCESS_TOKEN is not provided");
  }

  const url = new URL("/cgi-bin/token", API_BASE);
  url.searchParams.set("grant_type", "client_credential");
  url.searchParams.set("appid", appId);
  url.searchParams.set("secret", appSecret);

  const data = await fetchJson(url, { fetchImpl });
  if (!data.access_token) {
    throw new Error(`WeChat did not return access_token: ${JSON.stringify(redactTokenPayload(data))}`);
  }

  return data.access_token;
}

export async function postDatacube({ endpoint, dateRange, accessToken, fetchImpl = fetch }) {
  if (!endpoint?.path) {
    throw new Error("endpoint.path is required");
  }
  if (!accessToken) {
    throw new Error("accessToken is required");
  }

  const url = new URL(endpoint.path, API_BASE);
  url.searchParams.set("access_token", accessToken);

  return fetchJson(url, {
    fetchImpl,
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(dateRange)
  });
}

export async function getJsonWithAccessToken({ path, accessToken, query = {}, fetchImpl = fetch }) {
  return requestJsonWithAccessToken({
    method: "GET",
    path,
    accessToken,
    query,
    fetchImpl
  });
}

export async function postJsonWithAccessToken({ path, accessToken, body = {}, query = {}, fetchImpl = fetch }) {
  return requestJsonWithAccessToken({
    method: "POST",
    path,
    accessToken,
    query,
    body,
    fetchImpl
  });
}

async function requestJsonWithAccessToken({ method, path, accessToken, query = {}, body, fetchImpl }) {
  if (!path) {
    throw new Error("path is required");
  }
  if (!accessToken) {
    throw new Error("accessToken is required");
  }

  const url = new URL(path, API_BASE);
  url.searchParams.set("access_token", accessToken);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, value);
    }
  }

  return fetchJson(url, {
    fetchImpl,
    method,
    ...(body === undefined
      ? {}
      : {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body)
        })
  });
}

async function fetchJson(url, { fetchImpl, ...init } = {}) {
  const response = await fetchImpl(url, init);
  const text = await response.text();
  let data;

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Expected JSON from WeChat, got HTTP ${response.status}: ${text.slice(0, 200)}`);
  }

  if (!response.ok) {
    throw new Error(`WeChat HTTP ${response.status}: ${JSON.stringify(redactTokenPayload(data))}`);
  }

  if (data.errcode && data.errcode !== 0) {
    throw new Error(`WeChat API error ${data.errcode}: ${data.errmsg || "unknown error"}`);
  }

  return data;
}

function redactTokenPayload(data) {
  if (!data || typeof data !== "object") {
    return data;
  }

  const copy = { ...data };
  if (copy.access_token) {
    copy.access_token = "[redacted]";
  }

  return copy;
}
