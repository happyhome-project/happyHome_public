export interface MenuSafeAreaInput {
  windowWidth: number
  menuLeft: number
  pageRightPadding: number
  gap: number
}

export function resolveMenuSafeRightInset(input: MenuSafeAreaInput): number {
  const values = [input.windowWidth, input.menuLeft, input.pageRightPadding, input.gap]
  if (!values.every(Number.isFinite) || input.windowWidth <= 0 || input.menuLeft <= 0) return 0

  return Math.max(
    0,
    Math.round(input.windowWidth - input.menuLeft - input.pageRightPadding + input.gap),
  )
}
