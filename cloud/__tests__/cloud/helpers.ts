// L3 云端测试辅助工具
// 通过 HTTP 调用 CloudBase 上的 admin 函数

const CLOUD_API_URL = process.env.CLOUD_API_URL || ''
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'happyhome-admin-2024'

if (!CLOUD_API_URL) {
  console.warn(
    '⚠️  CLOUD_API_URL 未设置，云端测试将跳过。\n' +
    '   设置方式: CLOUD_API_URL=https://<env>.ap-shanghai.app.tcloudbase.com ADMIN_TOKEN=xxx npm run test:cloud'
  )
}

export const isCloudAvailable = !!CLOUD_API_URL

/** 调用 admin 云函数（HTTP trigger） */
export async function callAdmin(action: string, params: Record<string, any> = {}) {
  const res = await fetch(`${CLOUD_API_URL}/admin`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ADMIN_TOKEN}`,
    },
    body: JSON.stringify({ action, ...params }),
  })

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
