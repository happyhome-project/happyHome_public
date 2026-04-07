// cloud/lib/auth.ts
// 共享权限校验函数，所有云函数通过此文件做权限检查
import * as db from './db'

export async function assertSuperAdmin(openId: string): Promise<void> {
  const user = await db.getById('users', openId) as { role: string }
  if (user.role !== 'superAdmin') throw new Error('权限不足')
}

export async function assertCommunityAdmin(openId: string, communityId: string): Promise<void> {
  const members = await db.query('community_members', {
    communityId,
    userId: openId,
    role: 'admin',
    status: 'active',
  })
  if (!members || members.length === 0) throw new Error('权限不足')
}
