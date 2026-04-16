import cloud from 'wx-server-sdk'
import * as db from '../../lib/db'
import { resolveOpenId } from '../../lib/ctx'
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
    await db.updateById('users', openid, {
      nickName: params.nickName,
      avatarUrl: params.avatarUrl
    })
    return {
      user: { ...existingUser, nickName: params.nickName, avatarUrl: params.avatarUrl },
      isNew: false
    }
  } else {
    const newUser: User = {
      _id: openid,
      nickName: params.nickName,
      avatarUrl: params.avatarUrl,
      role: 'user',
      createdAt: new Date().toISOString()
    }
    await db.create('users', newUser)
    return { user: newUser, isNew: true }
  }
}

// 云函数入口
export const main = async (event: LoginEvent) => {
  const openid = resolveOpenId(event)
  const { action, _testOpenid, ...params } = event as any
  if (action === 'login') return handleLogin(params, openid)
  throw new Error(`Unknown action: ${action}`)
}
