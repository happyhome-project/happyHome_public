import cloud from 'wx-server-sdk'
import * as db from '../../lib/db'
import { resolveOpenId } from '../../lib/ctx'
import { buildUserRolePatch, resolveMiniProgramUserRole } from '../../lib/admin-identity'
import { buildBackgroundFetchTokenPatch, ensureBackgroundFetchToken } from '../../lib/background-fetch-token'
import type { User } from '../../shared/types'

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

interface LoginEvent {
  action: string
  nickName: string
  avatarUrl: string
  _testOpenid?: string
}

export async function handleLogin(
  params: { nickName: string; avatarUrl: string },
  openid: string,
) {
  if (!openid) throw new Error('Missing OPENID: must be called from WeChat miniprogram or via http-gateway')

  let existingUser: User | null = null
  try {
    existingUser = await db.getById('users', openid) as User
  } catch (err: any) {
    const isNotFound = err?.errCode === -502001 ||
      (err?.message && (err.message.includes('not found') || err.message.includes('does not exist')))
    if (!isNotFound) throw err
  }

  if (existingUser) {
    const roleState = await resolveMiniProgramUserRole(openid, existingUser)
    const rolePatch = buildUserRolePatch(existingUser, roleState)
    const tokenState = await ensureBackgroundFetchToken(openid, existingUser)
    await db.updateById('users', openid, {
      nickName: params.nickName,
      avatarUrl: params.avatarUrl,
      ...rolePatch,
    })
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
  } else {
    const roleState = await resolveMiniProgramUserRole(openid, null)
    const tokenPatch = buildBackgroundFetchTokenPatch()
    const newUser: User = {
      _id: openid,
      nickName: params.nickName,
      avatarUrl: params.avatarUrl,
      role: roleState.role,
      ...(roleState.roleSource !== undefined ? { roleSource: roleState.roleSource } : {}),
      ...tokenPatch,
      createdAt: new Date().toISOString()
    }
    await db.create('users', newUser)
    return { user: newUser, isNew: true }
  }
}

// 云函数入口
export const main = async (event: LoginEvent, context?: any) => {
  const openid = resolveOpenId(event, context)
  const { action, _testOpenid, ...params } = event as any
  if (action === 'login') return handleLogin(params, openid)
  throw new Error(`Unknown action: ${action}`)
}
