import cloud from 'wx-server-sdk'
import * as db from '../../lib/db'
import type { User } from '../../shared/types'

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

interface LoginEvent {
  action: string
  nickName: string
  avatarUrl: string
}

export async function handleLogin(params: { nickName: string; avatarUrl: string }) {
  const { OPENID } = cloud.getWXContext()

  if (!OPENID) throw new Error('Missing OPENID: must be called from WeChat miniprogram')

  // 查询是否已有用户记录，区分"不存在"与其他数据库错误
  let existingUser: User | null = null
  try {
    existingUser = await db.getById('users', OPENID) as User
  } catch (err: any) {
    // wx-server-sdk 文档不存在时抛出带 errCode 的错误
    // 仅将"文档不存在"视为新用户，其他错误（网络、权限等）向上抛出
    const isNotFound = err?.errCode === -502001 ||
      (err?.message && (err.message.includes('not found') || err.message.includes('does not exist')))
    if (!isNotFound) throw err
  }

  if (existingUser) {
    // 老用户：单独 try/catch，避免更新失败被误判为新用户
    await db.updateById('users', OPENID, {
      nickName: params.nickName,
      avatarUrl: params.avatarUrl
    })
    return {
      user: { ...existingUser, nickName: params.nickName, avatarUrl: params.avatarUrl },
      isNew: false
    }
  } else {
    // 新用户：创建记录
    const newUser: User = {
      _id: OPENID,
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
  const { action, ...params } = event
  if (action === 'login') return handleLogin(params)
  throw new Error(`Unknown action: ${action}`)
}
