export function isDevtoolsLoginSigningFailure(reason) {
  return /signed-header|login\/signing|not logged in|not login|未登录|登录失败|getCloudAPISignedHeader/i.test(String(reason || ''))
}

export function shouldFallbackAfterDevtoolsFailure({ target, reason, forceCi = false }) {
  if (forceCi) return true
  if (isDevtoolsLoginSigningFailure(reason)) return false
  if (target === 'miniprogram-upload') return false
  return true
}
