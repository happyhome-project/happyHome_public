// cloud/lib/wx-openapi.ts
//
// 直接走 HTTPS 调微信开放接口的 fallback 实现。
// 背景：CloudBase 云函数环境跟「微信小程序云开发」是两个不同产品，
//      cloud.openapi.wxacode.getUnlimited 在 CloudBase 不通（access_token 拿不到）。
//      所以这里自己管 access_token 缓存 + HTTP 直调微信 wxa API。
//
// 依赖环境变量（admin 云函数 env）：
//   WX_APPID         小程序 appid (manifest.json 里就有)
//   WX_APPSECRET     小程序 secret（小程序后台 → 开发管理 → AppSecret）
//
// access_token 缓存：admin_runtime collection，_id='wx_access_token'
//   微信全局唯一 token，有效期 7200s，提前 5 分钟续期
//
// 使用 Node 内置 https 模块，不依赖 fetch（CloudBase 函数运行时可能是
// Node 16，没有全局 fetch；用 https 模块兼容所有 Node 版本）。

import https from 'https'
import { URL } from 'url'
import * as db from './db'

const RUNTIME_COLLECTION = 'admin_runtime'
const ACCESS_TOKEN_DOC_ID = 'wx_access_token'
const REFRESH_AHEAD_MS = 5 * 60 * 1000  // 提前 5 分钟续期

interface AccessTokenDoc {
  _id: string
  token: string
  expiresAt: string  // ISO timestamp
  fetchedAt: string
}

interface HttpResponse {
  statusCode: number
  contentType: string
  body: Buffer
}

function httpsRequest(method: 'GET' | 'POST', urlStr: string, body?: string): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr)
    const headers: Record<string, string | number> = {}
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json'
      headers['Content-Length'] = Buffer.byteLength(body)
    }
    const req = https.request({
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      method,
      headers,
    }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c: any) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)))
      res.on('end', () => resolve({
        statusCode: res.statusCode || 0,
        contentType: String(res.headers['content-type'] || ''),
        body: Buffer.concat(chunks),
      }))
    })
    req.on('error', reject)
    if (body !== undefined) req.write(body)
    req.end()
  })
}

async function fetchFreshAccessToken(appid: string, secret: string): Promise<{ token: string; expiresIn: number }> {
  const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(appid)}&secret=${encodeURIComponent(secret)}`
  const res = await httpsRequest('GET', url)
  let json: any = {}
  try { json = JSON.parse(res.body.toString('utf-8')) } catch { /* not JSON */ }
  if (!json?.access_token) {
    // 微信 errmsg 在 errcode=40164 时会自带"invalid ip <IP>, not in whitelist"，
    // 把 errmsg 原样透出，运维看到错误信息就知道把哪个 IP 加到白名单。
    throw new Error(`fetch wx access_token failed: errcode=${json?.errcode} errmsg=${json?.errmsg || res.body.toString('utf-8').slice(0, 200)}`)
  }
  return { token: String(json.access_token), expiresIn: Number(json.expires_in) || 7200 }
}

export async function getAccessToken(): Promise<string> {
  const appid = String(process.env.WX_APPID || '').trim()
  const secret = String(process.env.WX_APPSECRET || '').trim()
  if (!appid || !secret) {
    throw new Error('admin 函数缺少 WX_APPID / WX_APPSECRET 环境变量，无法生成微信小程序码')
  }

  let cached: AccessTokenDoc | null = null
  try {
    cached = await db.getById(RUNTIME_COLLECTION, ACCESS_TOKEN_DOC_ID) as AccessTokenDoc
  } catch {
    cached = null
  }

  // 命中缓存且未临近过期 → 直接返回
  if (cached?.token && cached?.expiresAt) {
    const expireMs = Date.parse(cached.expiresAt)
    if (Number.isFinite(expireMs) && expireMs - Date.now() > REFRESH_AHEAD_MS) {
      return cached.token
    }
  }

  // 续期
  const fresh = await fetchFreshAccessToken(appid, secret)
  const now = Date.now()
  const expiresAt = new Date(now + fresh.expiresIn * 1000).toISOString()
  const fetchedAt = new Date(now).toISOString()

  if (cached) {
    try {
      await db.updateById(RUNTIME_COLLECTION, ACCESS_TOKEN_DOC_ID, {
        token: fresh.token,
        expiresAt,
        fetchedAt,
      })
    } catch {
      // 并发场景：另一进程已先更新，忽略
    }
  } else {
    try {
      await db.create(RUNTIME_COLLECTION, {
        _id: ACCESS_TOKEN_DOC_ID,
        token: fresh.token,
        expiresAt,
        fetchedAt,
      })
    } catch {
      // 并发：另一进程先创建了
    }
  }
  return fresh.token
}

export interface WxacodeUnlimitedParams {
  scene: string
  page: string
  envVersion?: 'release' | 'trial' | 'develop'
  width?: number
  checkPath?: boolean
}

/**
 * POST https://api.weixin.qq.com/wxa/getwxacodeunlimit?access_token=...
 * 成功 → image/jpeg buffer
 * 失败 → JSON { errcode, errmsg }
 */
export async function getWxacodeUnlimited(params: WxacodeUnlimitedParams): Promise<Buffer> {
  const accessToken = await getAccessToken()
  const url = `https://api.weixin.qq.com/wxa/getwxacodeunlimit?access_token=${encodeURIComponent(accessToken)}`
  const body = JSON.stringify({
    scene: params.scene,
    page: params.page,
    env_version: params.envVersion || 'release',
    width: params.width || 280,
    check_path: params.checkPath !== false,
  })
  const res = await httpsRequest('POST', url, body)
  if (res.contentType.includes('image')) {
    return res.body
  }
  // 微信返回 JSON 错误
  let errPayload: any = {}
  try { errPayload = JSON.parse(res.body.toString('utf-8')) } catch { /* not JSON */ }
  throw new Error(
    `wxacode.getUnlimited HTTP failed: errcode=${errPayload?.errcode} errmsg=${errPayload?.errmsg || res.body.toString('utf-8').slice(0, 200)}`
  )
}
