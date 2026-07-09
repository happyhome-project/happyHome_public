import { runBounded } from './release-concurrency.mjs'

function nowMs() {
  return Date.now()
}

function failureReason(error, fallback) {
  if (!error) return fallback
  if (typeof error === 'string') return error
  return error.reason || error.message || fallback
}

export async function deployFunctionsWithConcurrency(options) {
  const fns = options.functions || []
  const concurrency = options.concurrency || 1
  const deployOne = options.deployOne
  const detailOne = options.detailOne
  const clock = options.now || nowMs

  if (typeof deployOne !== 'function') throw new Error('deployOne is required')
  if (typeof detailOne !== 'function') throw new Error('detailOne is required')

  const tasks = fns.map((fn) => async () => {
    const startedAtMs = clock()
    const deployStartedAtMs = clock()
    let deployResult
    let deployFinishedAtMs
    try {
      deployResult = await deployOne(fn)
      deployFinishedAtMs = clock()
    } catch (error) {
      deployFinishedAtMs = clock()
      const reason = failureReason(error, 'deploy failed')
      return {
        fn,
        status: 'failed',
        durationMs: Math.max(0, deployFinishedAtMs - startedAtMs),
        deploy: {
          durationMs: Math.max(0, deployFinishedAtMs - deployStartedAtMs),
          reason,
        },
        detail: null,
        reason,
      }
    }
    if (!deployResult?.ok) {
      return {
        fn,
        status: 'failed',
        durationMs: Math.max(0, deployFinishedAtMs - startedAtMs),
        deploy: {
          durationMs: Math.max(0, deployFinishedAtMs - deployStartedAtMs),
          reason: deployResult?.reason || 'deploy failed',
        },
        detail: null,
        reason: deployResult?.reason || 'deploy failed',
      }
    }

    const detailStartedAtMs = clock()
    let detailResult
    let detailFinishedAtMs
    try {
      detailResult = await detailOne(fn)
      detailFinishedAtMs = clock()
    } catch (error) {
      detailFinishedAtMs = clock()
      const reason = failureReason(error, 'detail failed')
      return {
        fn,
        status: 'failed',
        durationMs: Math.max(0, detailFinishedAtMs - startedAtMs),
        deploy: {
          durationMs: Math.max(0, deployFinishedAtMs - deployStartedAtMs),
          reason: deployResult.reason || 'ok',
        },
        detail: {
          durationMs: Math.max(0, detailFinishedAtMs - detailStartedAtMs),
          reason,
        },
        reason,
      }
    }
    if (!detailResult?.ok) {
      return {
        fn,
        status: 'failed',
        durationMs: Math.max(0, detailFinishedAtMs - startedAtMs),
        deploy: {
          durationMs: Math.max(0, deployFinishedAtMs - deployStartedAtMs),
          reason: deployResult.reason || 'ok',
        },
        detail: {
          durationMs: Math.max(0, detailFinishedAtMs - detailStartedAtMs),
          reason: detailResult?.reason || 'detail failed',
        },
        reason: detailResult?.reason || 'detail failed',
      }
    }

    return {
      fn,
      status: 'passed',
      durationMs: Math.max(0, detailFinishedAtMs - startedAtMs),
      deploy: {
        durationMs: Math.max(0, deployFinishedAtMs - deployStartedAtMs),
        reason: deployResult.reason || 'ok',
      },
      detail: {
        durationMs: Math.max(0, detailFinishedAtMs - detailStartedAtMs),
        reason: detailResult.reason || 'ok',
      },
    }
  })

  const functionResults = await runBounded(tasks, concurrency)
  const failed = functionResults.find((item) => item?.status === 'failed')
  if (failed) {
    const stage = failed.detail ? 'detail' : 'deploy'
    const error = new Error(`${failed.fn} ${stage} failed: ${failed.reason}`)
    error.functionResults = functionResults
    throw error
  }
  return functionResults
}
