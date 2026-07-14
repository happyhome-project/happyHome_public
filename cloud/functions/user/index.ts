import cloud from 'wx-server-sdk'
import * as db from '../../lib/db'
import { resolveOpenId } from '../../lib/ctx'
import {
  ADMIN_ACCOUNT_ROLE_SOURCE,
  buildUserRolePatch,
  getActiveAdminRoleForUserId,
} from '../../lib/admin-identity'
import { resolveBackgroundFetchTokenState } from '../../lib/background-fetch-token'
import { parsePerformanceTrace, recordDatabaseStage } from '../../lib/performance-trace'
import type { User, UserRole } from '../../shared/types'

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

interface LoginEvent {
  action: string
  nickName: string
  avatarUrl: string
  _testOpenid?: string
  _trace?: unknown
}

export async function handleLogin(
  params: { nickName: string; avatarUrl: string },
  openid: string,
  traceInput?: unknown,
) {
  if (!openid) throw new Error('Missing OPENID: must be called from WeChat miniprogram or via http-gateway')

  const trace = parsePerformanceTrace(traceInput)
  const readStartedAt = Date.now()
  const userPromise = db.getById('users', openid)
    .then((user) => user as User)
    .catch((err: any) => {
      const isNotFound = err?.errCode === -502001 ||
        (err?.message && (err.message.includes('not found') || err.message.includes('does not exist')))
      if (!isNotFound) throw err
      return null
    })
  const [existingUser, adminRole] = await Promise.all([
    userPromise,
    getActiveAdminRoleForUserId(openid),
  ])
  recordDatabaseStage(trace, 'user.login', 'user_and_admin_read', readStartedAt, {
    users: existingUser ? 1 : 0,
    adminBindings: adminRole ? 1 : 0,
  })
  const roleState: { role: UserRole; roleSource?: string } = adminRole === 'superAdmin'
    ? { role: 'superAdmin', roleSource: ADMIN_ACCOUNT_ROLE_SOURCE }
    : existingUser?.role === 'superAdmin' && existingUser.roleSource !== ADMIN_ACCOUNT_ROLE_SOURCE
      ? { role: 'superAdmin', roleSource: existingUser.roleSource }
      : {
        role: 'user',
        roleSource: existingUser?.roleSource === ADMIN_ACCOUNT_ROLE_SOURCE ? '' : existingUser?.roleSource,
      }

  const tokenState = resolveBackgroundFetchTokenState(existingUser)

  if (existingUser) {
    const rolePatch = buildUserRolePatch(existingUser, roleState)
    const writeStartedAt = Date.now()
    await db.updateById('users', openid, {
      nickName: params.nickName,
      avatarUrl: params.avatarUrl,
      ...rolePatch,
      ...tokenState.patch,
    })
    recordDatabaseStage(trace, 'user.login', 'final_user_write', writeStartedAt, { users: 1 })
    return {
      user: {
        ...existingUser,
        nickName: params.nickName,
        avatarUrl: params.avatarUrl,
        role: roleState.role,
        ...(roleState.roleSource !== undefined ? { roleSource: roleState.roleSource } : {}),
        backgroundFetchToken: tokenState.backgroundFetchToken,
        backgroundFetchTokenExpiresAt: tokenState.backgroundFetchTokenExpiresAt,
      },
      isNew: false
    }
  }

  const newUser: User = {
    _id: openid,
    nickName: params.nickName,
    avatarUrl: params.avatarUrl,
    role: roleState.role,
    ...(roleState.roleSource !== undefined ? { roleSource: roleState.roleSource } : {}),
    ...tokenState.patch,
    createdAt: new Date().toISOString()
  }
  const writeStartedAt = Date.now()
  await db.create('users', newUser)
  recordDatabaseStage(trace, 'user.login', 'final_user_write', writeStartedAt, { users: 1 })
  return { user: newUser, isNew: true }
}

// 云函数入口
export const main = async (event: LoginEvent, context?: any) => {
  const openid = resolveOpenId(event, context)
  const { action, _testOpenid, _trace, ...params } = event as any
  if (action === 'login') return handleLogin(params, openid, _trace)
  throw new Error(`Unknown action: ${action}`)
}
