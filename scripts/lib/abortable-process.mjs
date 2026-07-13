import { spawn as nodeSpawn } from 'node:child_process'

function cleanupError(message) {
  const error = new Error(message)
  error.code = 'ERR_RELEASE_ATTESTATION_ABORT_CLEANUP'
  return error
}

export function abortableDelay(ms, signal) {
  return new Promise((resolve, reject) => {
    let timer
    const abort = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      reject(new Error('operation aborted during retry backoff'))
    }
    if (signal?.aborted) return abort()
    signal?.addEventListener('abort', abort, { once: true })
    timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort)
      resolve()
    }, ms)
  })
}

function waitForClose(process, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    let timer
    const done = (handler, value) => {
      clearTimeout(timer)
      process.removeListener?.('close', onClose)
      process.removeListener?.('error', onError)
      handler(value)
    }
    const onClose = (code, signal) => done(resolve, { code, signal })
    const onError = (error) => done(reject, error)
    process.once('close', onClose)
    process.once('error', onError)
    timer = setTimeout(() => done(reject, cleanupError(`${label} did not close within ${timeoutMs}ms`)), timeoutMs)
  })
}

export async function terminateProcessTree(child, { spawn = nodeSpawn, platform = process.platform, graceMs = 5_000 } = {}) {
  if (!child?.pid) throw cleanupError('cannot terminate child process without pid')
  const childClose = waitForClose(child, graceMs, 'attestation child process')
  if (platform === 'win32') {
    let taskkillSucceeded = false
    try {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true })
      const killed = await waitForClose(killer, graceMs, 'taskkill process')
      taskkillSucceeded = killed.code === 0
    } catch {
      taskkillSucceeded = false
    }
    if (!taskkillSucceeded) {
      child.kill()
      await childClose
      throw cleanupError('taskkill failed; descendant process cleanup is unconfirmed after shell fallback close')
    }
  } else {
    child.kill('SIGTERM')
    try {
      return await childClose
    } catch (error) {
      if (error.code !== 'ERR_RELEASE_ATTESTATION_ABORT_CLEANUP') throw error
      child.kill('SIGKILL')
      return await waitForClose(child, graceMs, 'attestation child process after SIGKILL')
    }
  }
  return await childClose
}

export function runAbortableShellCapture(commandLine, options = {}, deps = {}) {
  const spawn = deps.spawn || nodeSpawn
  const platform = deps.platform || process.platform
  const child = spawn(commandLine, {
    cwd: options.cwd,
    env: options.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
  })
  let stdout = ''
  let stderr = ''
  let aborting = false
  let settled = false

  return new Promise((resolve, reject) => {
    const finish = (handler, value) => {
      if (settled) return
      settled = true
      options.signal?.removeEventListener('abort', onAbort)
      handler(value)
    }
    const onAbort = async () => {
      if (aborting || settled) return
      aborting = true
      try {
        await terminateProcessTree(child, { spawn, platform, graceMs: options.terminationGraceMs || 5_000 })
        finish(resolve, { ok: false, reason: 'aborted after child close', output: `${stdout}${stderr}`, aborted: true })
      } catch (error) {
        finish(reject, error)
      }
    }
    child.stdout?.on('data', (chunk) => {
      const text = String(chunk)
      stdout += text
      if (!options.silentOutput) options.stdout?.(text)
    })
    child.stderr?.on('data', (chunk) => {
      const text = String(chunk)
      stderr += text
      if (!options.silentOutput) options.stderr?.(text)
    })
    child.once('close', (code) => {
      if (!aborting) finish(resolve, { ok: code === 0, reason: code === 0 ? 'ok' : `exit code ${code}`, output: `${stdout}${stderr}` })
    })
    child.once('error', (error) => {
      if (!aborting) finish(resolve, { ok: false, reason: String(error?.message || error), output: `${stdout}${stderr}` })
    })
    if (options.signal?.aborted) void onAbort()
    else options.signal?.addEventListener('abort', onAbort, { once: true })
  })
}
