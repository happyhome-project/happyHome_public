export interface CreateNavMetricInput {
  isH5?: boolean
  statusBarHeight?: number
  safeAreaTop?: number
  menuTop?: number
  menuHeight?: number
}

export interface CreateNavMetrics {
  statusBarHeight: number
  navRowHeight: number
}

export interface CreateNavTitleInput {
  isEditMode: boolean
  sectionName?: string
  isTextCoverStep: boolean
}

export function computeCreateNavMetrics(input: CreateNavMetricInput = {}): CreateNavMetrics {
  const fallbackStatusBar = input.isH5 ? 44 : 20
  const measuredStatusBar = Number(input.statusBarHeight)
  const measuredSafeAreaTop = Number(input.safeAreaTop)
  const statusBarHeight = measuredStatusBar > 0
    ? measuredStatusBar
    : (measuredSafeAreaTop > 0 ? measuredSafeAreaTop : fallbackStatusBar)

  const menuTop = Number(input.menuTop)
  const menuHeight = Number(input.menuHeight)
  const navRowHeight = menuHeight > 0
    ? Math.max(54, menuHeight + Math.max(0, menuTop - statusBarHeight) * 2)
    : 54

  return {
    statusBarHeight: Math.max(0, Math.round(statusBarHeight)),
    navRowHeight: Math.max(44, Math.round(navRowHeight)),
  }
}

export function resolveCreateNavTitle(input: CreateNavTitleInput): string {
  if (input.isEditMode) return '编辑内容'
  if (input.isTextCoverStep) return '预览'
  return String(input.sectionName || '').trim() || '发帖'
}
