import * as db from './db'
import type { AdminAccount, AdminRole, User, UserRole } from '../shared/types'

export const ADMIN_ACCOUNT_ROLE_SOURCE = 'admin_account'

type UserWithRoleSource = User & { roleSource?: string }

function isNotFoundError(error: any) {
  return error?.errCode === -502001 ||
    (error?.message && (error.message.includes('not found') || error.message.includes('does not exist')))
}

export async function getActiveAdminRoleForUserId(userId: string): Promise<AdminRole | null> {
  if (!userId) return null
  const accounts = await db.query('admin_accounts', {
    userId,
    status: 'active',
  }, { limit: 20 }) as AdminAccount[] | undefined
  const list = Array.isArray(accounts) ? accounts : []
  if (list.some((account) => account.role === 'superAdmin')) return 'superAdmin'
  if (list.some((account) => account.role === 'communityAdmin')) return 'communityAdmin'
  return null
}

export async function isBoundSuperAdmin(userId: string): Promise<boolean> {
  return (await getActiveAdminRoleForUserId(userId)) === 'superAdmin'
}

export async function resolveMiniProgramUserRole(
  userId: string,
  existingUser: UserWithRoleSource | null,
): Promise<{ role: UserRole; roleSource?: string }> {
  const adminRole = await getActiveAdminRoleForUserId(userId)
  if (adminRole === 'superAdmin') {
    return { role: 'superAdmin', roleSource: ADMIN_ACCOUNT_ROLE_SOURCE }
  }

  // Preserve legacy/manual superAdmin users that were not created from admin_accounts.
  if (existingUser?.role === 'superAdmin' && existingUser.roleSource !== ADMIN_ACCOUNT_ROLE_SOURCE) {
    return { role: 'superAdmin', roleSource: existingUser.roleSource }
  }

  return {
    role: 'user',
    roleSource: existingUser?.roleSource === ADMIN_ACCOUNT_ROLE_SOURCE ? '' : existingUser?.roleSource,
  }
}

export function buildUserRolePatch(
  existingUser: UserWithRoleSource,
  next: { role: UserRole; roleSource?: string },
) {
  const patch: { role?: UserRole; roleSource?: string } = {}
  if (existingUser.role !== next.role) patch.role = next.role
  if (next.roleSource !== undefined && existingUser.roleSource !== next.roleSource) {
    patch.roleSource = next.roleSource
  }
  return patch
}

export async function syncMiniProgramUserRoleForAdminAccount(
  userId: string,
  adminRole: AdminRole,
  profile: { nickName?: string; avatarUrl?: string } = {},
) {
  if (!userId || adminRole !== 'superAdmin') return

  let existingUser: UserWithRoleSource | null = null
  try {
    existingUser = await db.getById('users', userId) as UserWithRoleSource
  } catch (error: any) {
    if (!isNotFoundError(error)) throw error
  }

  if (existingUser) {
    await db.updateById('users', userId, {
      role: 'superAdmin',
      roleSource: ADMIN_ACCOUNT_ROLE_SOURCE,
    })
    return
  }

  await db.create('users', {
    _id: userId,
    nickName: profile.nickName || '微信管理员',
    avatarUrl: profile.avatarUrl || '',
    role: 'superAdmin',
    roleSource: ADMIN_ACCOUNT_ROLE_SOURCE,
    createdAt: new Date().toISOString(),
  })
}
