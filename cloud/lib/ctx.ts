// cloud/lib/ctx.ts
// Unified OPENID resolver. Supports test-mode injection via event._testOpenid,
// gated by env flag ALLOW_TEST_OPENID=true. Production leaves it unset.

import cloud from 'wx-server-sdk'

export function resolveOpenId(event: any): string {
  if (process.env.ALLOW_TEST_OPENID === 'true' && event?._testOpenid) {
    return String(event._testOpenid)
  }
  const { OPENID } = cloud.getWXContext()
  return OPENID || ''
}
