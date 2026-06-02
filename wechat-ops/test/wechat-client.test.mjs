import assert from "node:assert/strict";
import test from "node:test";
import { getJsonWithAccessToken, postJsonWithAccessToken } from "../src/wechat-client.mjs";

test("getJsonWithAccessToken appends access token and query parameters", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    return jsonResponse({ errcode: 0, kf_list: [] });
  };

  const data = await getJsonWithAccessToken({
    path: "/cgi-bin/customservice/getkflist",
    accessToken: "token-123",
    query: { business_id: "biz-1", empty: "" },
    fetchImpl
  });

  assert.deepEqual(data, { errcode: 0, kf_list: [] });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.method, "GET");
  const url = new URL(calls[0].url);
  assert.equal(url.origin, "https://api.weixin.qq.com");
  assert.equal(url.pathname, "/cgi-bin/customservice/getkflist");
  assert.equal(url.searchParams.get("access_token"), "token-123");
  assert.equal(url.searchParams.get("business_id"), "biz-1");
  assert.equal(url.searchParams.has("empty"), false);
});

test("postJsonWithAccessToken sends JSON body and surfaces WeChat errors", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    return jsonResponse({ errcode: 65400, errmsg: "please enable new custom service" });
  };

  await assert.rejects(
    () => postJsonWithAccessToken({
      path: "/customservice/kfaccount/add",
      accessToken: "token-123",
      body: { kf_account: "feedback@test", nickname: "HappyHome客服" },
      fetchImpl
    }),
    /WeChat API error 65400: please enable new custom service/
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    kf_account: "feedback@test",
    nickname: "HappyHome客服"
  });
});

function jsonResponse(data, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(data);
    }
  };
}
