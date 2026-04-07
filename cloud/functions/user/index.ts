import cloud from 'wx-server-sdk'
import * as db from '../../lib/db'
import type { User } from '../../shared/types'

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

export async function handleLogin(params: { nickName: string; avatarUrl: string }) {
  const { OPENID } = cloud.getWXContext()
  let isNew = false

  try {
    const existing = await db.getById('users', OPENID) as User
    await db.updateById('users', OPENID, {
      nickName: params.nickName,
      avatarUrl: params.avatarUrl
    })
    return { user: { ...existing, ...params }, isNew }
  } catch {
    // 用户不存在，创建新用户
    isNew = true
    const newUser: User = {
      _id: OPENID,
      nickName: params.nickName,
      avatarUrl: params.avatarUrl,
      role: 'user',
      createdAt: new Date().toISOString()
    }
    await db.create('users', newUser)
    return { user: newUser, isNew }
  }
}

// 云函数入口
export const main = async (event: any) => {
  const { action, ...params } = event
  if (action === 'login') return handleLogin(params)
  throw new Error(`Unknown action: ${action}`)
}
