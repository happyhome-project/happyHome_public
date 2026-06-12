// cloud/lib/auth.ts
// 共享权限校验函数，所有云函数通过此文件做权限检查
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto'
import * as db from './db'
import { isBoundSuperAdmin } from './admin-identity'
import type { AdminCtx, Community, CommunityMember } from '../shared/types'

export async function assertSuperAdmin(openId: string): Promise<void> {
  try {
    const user = await db.getById('users', openId) as { role: string }
    if (user.role === 'superAdmin') return
  } catch (error) {
    if (await isBoundSuperAdmin(openId)) return
    throw error
  }
  if (await isBoundSuperAdmin(openId)) return
  throw new Error('权限不足')
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

// 社区归属：创建者或 community_members 里的 active admin
export async function isOwnCommunity(userId: string, communityId: string): Promise<boolean> {
  if (!userId || !communityId) return false
  try {
    const community = await db.getById('communities', communityId) as Community | null
    if (community && community.creatorId === userId) return true
  } catch {
    // community 不存在时 getById 会抛；兜底当作非归属，让上层报 community not found
  }
  const members = await db.query('community_members', {
    communityId,
    userId,
    role: 'admin',
    status: 'active',
  }) as CommunityMember[]
  return members.length > 0
}

export async function assertOwnCommunityOrSuper(ctx: AdminCtx, communityId: string): Promise<void> {
  if (!communityId) throw new Error('communityId 不能为空')
  if (ctx.role === 'superAdmin') return
  const owned = await isOwnCommunity(ctx.userId, communityId)
  if (!owned) throw new Error('权限不足')
}

export async function listOwnedCommunityIds(userId: string): Promise<string[]> {
  if (!userId) return []
  const [created, asAdmin] = await Promise.all([
    db.query('communities', { creatorId: userId }) as Promise<Community[]>,
    db.query('community_members', { userId, role: 'admin', status: 'active' }) as Promise<CommunityMember[]>,
  ])
  const ids = new Set<string>()
  for (const c of created) ids.add(String(c._id || ''))
  for (const m of asAdmin) ids.add(String(m.communityId || ''))
  ids.delete('')
  return Array.from(ids)
}

// 密码哈希：node 内置 scrypt，避免引入 bcrypt/argon2 增加云函数包体
const SCRYPT_KEYLEN = 64
const SCRYPT_COST = 16384 // N: 2^14，云函数冷启动下 ~100ms
const SCRYPT_BLOCK_SIZE = 8
const SCRYPT_PARALLEL = 1

export function generateSalt(): string {
  return randomBytes(16).toString('hex')
}

export function hashPassword(password: string, salt: string): string {
  const derived = scryptSync(password, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_COST,
    r: SCRYPT_BLOCK_SIZE,
    p: SCRYPT_PARALLEL,
  })
  return derived.toString('hex')
}

export function verifyPassword(password: string, salt: string, expectedHash: string): boolean {
  if (!password || !salt || !expectedHash) return false
  const derived = scryptSync(password, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_COST,
    r: SCRYPT_BLOCK_SIZE,
    p: SCRYPT_PARALLEL,
  })
  const expectedBuf = Buffer.from(expectedHash, 'hex')
  if (derived.length !== expectedBuf.length) return false
  return timingSafeEqual(derived, expectedBuf)
}

export function generateSessionToken(): string {
  return randomBytes(32).toString('hex')
}
