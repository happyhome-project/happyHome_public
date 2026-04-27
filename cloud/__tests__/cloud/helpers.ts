// L3 云端测试辅助工具
// 通过 HTTP 调用 CloudBase 上的 admin 函数
//
// 鉴权模式（2026-04-23 起）：
//   admin 云函数改为"认人"后，不再接受共享 ADMIN_TOKEN（除非 cloud 侧显式打开
//   ADMIN_LEGACY_TOKEN_FALLBACK=1）。测试需要先 POST auth.login 拿 session token。
//
//   优先级：
//     1. TEST_ADMIN_SESSION_TOKEN（显式传入现成 session token，跳过 login）
//     2. TEST_ADMIN_USERNAME + TEST_ADMIN_PASSWORD（自动 login）
//     3. ADMIN_TOKEN（兼容 ADMIN_LEGACY_TOKEN_FALLBACK=1 的老模式）

const CLOUD_API_URL = process.env.CLOUD_API_URL || ''
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || ''
const TEST_SESSION = process.env.TEST_ADMIN_SESSION_TOKEN || ''
const TEST_USERNAME = process.env.TEST_ADMIN_USERNAME || ''
const TEST_PASSWORD = process.env.TEST_ADMIN_PASSWORD || ''

if (!CLOUD_API_URL) {
  console.warn(
    '⚠️  CLOUD_API_URL 未设置，云端测试将跳过。\n' +
    '   设置方式:\n' +
    '     CLOUD_API_URL=https://<env>.ap-shanghai.app.tcloudbase.com \\\n' +
    '     TEST_ADMIN_USERNAME=xxx TEST_ADMIN_PASSWORD=yyy \\\n' +
    '     npm run test:cloud'
  )
}

export const isCloudAvailable = !!CLOUD_API_URL

let _cachedToken: string | null = null
async function getAuthToken(): Promise<string> {
  if (_cachedToken) return _cachedToken
  if (TEST_SESSION) { _cachedToken = TEST_SESSION; return _cachedToken }

  if (TEST_USERNAME && TEST_PASSWORD) {
    const res = await fetch(`${CLOUD_API_URL}/admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'auth.login', username: TEST_USERNAME, password: TEST_PASSWORD }),
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`auth.login failed ${res.status}: ${text}`)
    }
    const data = await res.json()
    _cachedToken = data.token
    return _cachedToken!
  }

  if (ADMIN_TOKEN) {
    // 只有 cloud 侧设了 ADMIN_LEGACY_TOKEN_FALLBACK=1 时才会被接受
    _cachedToken = ADMIN_TOKEN
    return _cachedToken
  }

  throw new Error('No credentials: set TEST_ADMIN_USERNAME+TEST_ADMIN_PASSWORD or TEST_ADMIN_SESSION_TOKEN or ADMIN_TOKEN')
}

/** 显式调用，不带 Authorization 头（用于测试鉴权失败场景） */
export async function rawFetch(action: string, params: Record<string, any> = {}, token?: string) {
  return fetch(`${CLOUD_API_URL}/admin`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ action, ...params }),
  })
}

/** 调用 admin 云函数（HTTP trigger），自动带 session token */
export async function callAdmin(action: string, params: Record<string, any> = {}) {
  const token = await getAuthToken()
  const res = await rawFetch(action, params, token)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Cloud API error ${res.status}: ${text}`)
  }
  return res.json()
}

/** 生成唯一测试标识，避免数据冲突 */
export function testId(prefix = 'test') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/** 清理测试数据（通过 admin 接口删除） */
export async function cleanupSection(sectionId: string) {
  try {
    await callAdmin('section.delete', { sectionId })
  } catch {
    // 忽略清理失败
  }
}
