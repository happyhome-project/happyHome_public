import { computeCreateNavMetrics } from './create-nav'

export interface SearchNavMetricInput {
  isH5?: boolean
  windowWidth?: number
  statusBarHeight?: number
  safeAreaTop?: number
  menuTop?: number
  menuHeight?: number
  menuLeft?: number
}

export interface SearchNavMetrics {
  statusBarHeight: number
  navRowHeight: number
  menuSpacerWidth: number
}

export function computeSearchNavMetrics(input: SearchNavMetricInput = {}): SearchNavMetrics {
  const base = computeCreateNavMetrics(input)
  const windowWidth = Number(input.windowWidth)
  const menuLeft = Number(input.menuLeft)
  const menuSpacerWidth = input.isH5 || !Number.isFinite(windowWidth) || !Number.isFinite(menuLeft)
    ? 0
    : Math.max(0, Math.round(windowWidth - menuLeft))
  return {
    statusBarHeight: base.statusBarHeight,
    navRowHeight: base.navRowHeight,
    menuSpacerWidth,
  }
}
