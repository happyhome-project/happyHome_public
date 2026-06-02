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

export function analyzeDevtoolsUploadOutput(output) {
  const text = String(output || '')
  const reasons = []

  if (/(?:^|\n)\s*(?:×|x)\s+(?:compile_start|upload)/i.test(text)) {
    reasons.push('DevTools CLI failure marker')
  }

  if (/\[error\]/i.test(text)) {
    reasons.push('DevTools CLI error line')
  }

  if (/ENOENT|no such file or directory/i.test(text)) {
    reasons.push('missing file during upload compile')
  }

  if (/getCloudAPISignedHeader failed|success=false|not logged in|not login|未登录|登录失败/i.test(text)) {
    reasons.push('IDE login/signing problem')
  }

  if (reasons.length === 0) return { ok: true, reason: 'ok' }

  return {
    ok: false,
    reason: [...new Set(reasons)].join('; '),
  }
}
