// cloud/lib/ctx.ts
// Unified OPENID resolver. Supports test-mode injection via event._testOpenid,
// gated by env flag ALLOW_TEST_OPENID=true. Production leaves it unset.

import cloud from 'wx-server-sdk'
import { getCloudbaseContext } from '@cloudbase/node-sdk'

type RuntimeContext = Parameters<typeof getCloudbaseContext>[0]

export function resolveOpenId(event: any, context?: RuntimeContext): string {
  if (process.env.ALLOW_TEST_OPENID === 'true' && event?._testOpenid) {
    return String(event._testOpenid)
  }
  const { OPENID } = cloud.getWXContext()
  if (OPENID) return OPENID

  const { TCB_UUID, TCB_ISANONYMOUS_USER } = getCloudbaseContext(context)
  if (TCB_ISANONYMOUS_USER === 'true') {
    throw new Error('Authenticated caller required')
  }
  return TCB_UUID ? `web:${TCB_UUID}` : ''
}
