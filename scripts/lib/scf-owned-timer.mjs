const OWNED = new Set(['post-rag-worker-every-5-min', 'post-rag-worker-every-minute'])
const READBACK_ATTEMPTS = 30
const READBACK_DELAY_MS = 1000

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function triggerCronMatches(triggerDesc, cron) {
  if (triggerDesc === cron) return true
  if (typeof triggerDesc !== 'string') return false
  try {
    const parsed = JSON.parse(triggerDesc)
    return parsed !== null
      && typeof parsed === 'object'
      && !Array.isArray(parsed)
      && Object.keys(parsed).length === 1
      && parsed.cron === cron
  } catch {
    return false
  }
}

function isDesiredTrigger(trigger, cron, customArgument) {
  return trigger.TriggerName === 'post-rag-worker-every-minute'
    && triggerCronMatches(trigger.TriggerDesc, cron)
    && trigger.CustomArgument === customArgument
}

export async function reconcileOwnedScfTimer(request, {
  functionName,
  namespace,
  cron,
  customArgument,
  wait = delay,
}) {
  const list = async () => {
    const response = await request('ListTriggers', { FunctionName: functionName, Namespace: namespace })
    return Array.isArray(response?.Triggers) ? response.Triggers : []
  }

  const before = await list()
  const desired = before.filter(trigger => isDesiredTrigger(trigger, cron, customArgument))
  const owned = before.filter(trigger => OWNED.has(trigger.TriggerName))
  const keep = desired.length === 1
    && owned.filter(trigger => trigger.TriggerName === 'post-rag-worker-every-minute').length === 1

  for (const trigger of owned) {
    if (keep && trigger === desired[0]) continue
    await request('DeleteTrigger', {
      FunctionName: functionName,
      Namespace: namespace,
      TriggerName: trigger.TriggerName,
      Type: 'timer',
    })
  }

  if (!keep) {
    await request('CreateTrigger', {
      FunctionName: functionName,
      Namespace: namespace,
      TriggerName: 'post-rag-worker-every-minute',
      Type: 'timer',
      TriggerDesc: cron,
      CustomArgument: customArgument,
      Enable: 'OPEN',
    })
  }

  for (let attempt = 1; attempt <= READBACK_ATTEMPTS; attempt += 1) {
    const after = await list()
    const matches = after.filter(trigger => isDesiredTrigger(trigger, cron, customArgument))
    const hasStaleOwnedTrigger = after.some(trigger => OWNED.has(trigger.TriggerName)
      && trigger.TriggerName !== 'post-rag-worker-every-minute')
    if (matches.length === 1 && !hasStaleOwnedTrigger) {
      return {
        changed: !keep,
        triggerName: 'post-rag-worker-every-minute',
        cron,
        customArgumentHash: await sha256(customArgument),
      }
    }
    if (attempt < READBACK_ATTEMPTS) await wait(READBACK_DELAY_MS)
  }

  throw new Error('SCF timer verification failed')
}

async function sha256(value) {
  const { createHash } = await import('node:crypto')
  return createHash('sha256').update(value).digest('hex')
}
