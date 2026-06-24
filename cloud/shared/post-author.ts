export function resolvePostAuthorNickname(
  post: { adminCreatedByUsername?: unknown },
  userNickName?: unknown,
  options: { audience?: 'admin' | 'public' } = {},
): string {
  const adminUsername = String(post?.adminCreatedByUsername || '').trim()
  if (adminUsername) {
    return options.audience === 'admin' ? `后台代发：${adminUsername}` : '社区管理员'
  }
  return String(userNickName || '').trim()
}
