const RELEASE_PAGE_TEXT_ROOTS = [
  'page',
  '.phone-inner',
  '.profile-page',
  'view',
]

export async function readReleasePageText(page) {
  for (const selector of RELEASE_PAGE_TEXT_ROOTS) {
    const root = await page.$(selector).catch(() => null)
    if (!root) continue
    const text = String(await root.text().catch(() => '') || '')
    if (text.trim()) return text
  }
  return ''
}

export function hasReleaseHomeNavigationEvidence(evidence = {}) {
  return evidence.navigationEvidencePassed === true ||
    Number(evidence.appTabBarCount || 0) > 0 ||
    String(evidence.text || '').trim().endsWith('首页+我的')
}
