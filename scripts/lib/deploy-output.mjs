export function analyzeDevtoolsCloudDeployOutput(output) {
  const text = String(output || '')
  const reasons = []

  if (/(?:^|\n)\s*(?:×|x)\s+deploy cloudfunctions/i.test(text)) {
    reasons.push('DevTools CLI failure marker')
  }

  if (/\[error\]\s+fail to deploy cloudfunction/i.test(text)) {
    reasons.push('DevTools CLI error line')
  }

  if (/success\s*[│|]\s*false/i.test(text) || /[│|]\s*false\s*[│|]/i.test(text)) {
    reasons.push('failed cloud function rows')
  }

  if (/getCloudAPISignedHeader failed/i.test(text)) {
    reasons.push('Cloud API signed-header failure')
  }

  if (reasons.length === 0) return { ok: true, reason: 'ok' }

  return {
    ok: false,
    reason: [...new Set(reasons)].join('; '),
  }
}
