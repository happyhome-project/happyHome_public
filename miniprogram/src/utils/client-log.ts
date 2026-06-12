import { BUILD_INFO } from '../generated/build-info'

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore wx is injected by the miniprogram runtime.
const wxRef: any = typeof wx !== 'undefined' ? wx : undefined

const MAX_STRING_LENGTH = 500
const MAX_ARRAY_LENGTH = 12
const MAX_OBJECT_KEYS = 24
const SESSION_ID = makeSessionId()

let hooksInstalled = false

function makeSessionId() {
  const rand = Math.random().toString(36).slice(2, 8)
  return 's-' + Date.now().toString(36) + '-' + rand
}

function trimString(value: string) {
  if (value.length <= MAX_STRING_LENGTH) return value
  return value.slice(0, MAX_STRING_LENGTH) + '...'
}

function normalizeValue(value: any, depth: number): any {
  if (value === null || value === undefined) return value
  const valueType = typeof value
  if (valueType === 'string') return trimString(value)
  if (valueType === 'number' || valueType === 'boolean') return value
  if (valueType === 'function') return '[function]'
  if (value instanceof Error) {
    const normalized: Record<string, any> = {
      name: value.name,
      message: trimString(value.message || ''),
      stack: trimString(value.stack || ''),
    }
    for (const key of ['errCode', 'errMsg', 'cloudFunction', 'action', 'requestId', 'trace']) {
      if ((value as any)[key] !== undefined) normalized[key] = normalizeValue((value as any)[key], depth + 1)
    }
    return normalized
  }
  if (depth >= 3) return '[max-depth]'
  if (Array.isArray(value)) {
    const output: any[] = []
    const limit = Math.min(value.length, MAX_ARRAY_LENGTH)
    for (let i = 0; i < limit; i += 1) {
      output.push(normalizeValue(value[i], depth + 1))
    }
    if (value.length > limit) output.push('[+' + (value.length - limit) + ' more]')
    return output
  }
  if (valueType === 'object') {
    const output: Record<string, any> = {}
    const keys = Object.keys(value)
    const limit = Math.min(keys.length, MAX_OBJECT_KEYS)
    for (let i = 0; i < limit; i += 1) {
      const key = keys[i]
      if (/token|secret|password|authorization|cookie/i.test(key)) {
        output[key] = '[redacted]'
      } else {
        try {
          output[key] = normalizeValue(value[key], depth + 1)
        } catch (error) {
          output[key] = '[unreadable]'
        }
      }
    }
    if (keys.length > limit) output.__moreKeys = keys.length - limit
    return output
  }
  return String(value)
}

function currentRoute() {
  try {
    const pages = getCurrentPages()
    const page = pages && pages.length ? pages[pages.length - 1] : null
    return page && page.route ? String(page.route) : ''
  } catch (_error) {
    return ''
  }
}

function emitConsole(level: LogLevel, event: string, payload: Record<string, any>) {
  const method = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'
  try {
    console[method]('[client-log]', event, payload)
  } catch (_error) {
    // Never let diagnostics affect product behavior.
  }
}

function isVerboseCloudLoggingEnabled() {
  try {
    const value = wxRef?.getStorageSync ? wxRef.getStorageSync('hh_client_log_verbose') : ''
    return value === true || value === '1' || value === 'true'
  } catch (_error) {
    return false
  }
}

function shouldUploadToCloud(level: LogLevel) {
  if (level === 'warn' || level === 'error') return true
  return isVerboseCloudLoggingEnabled()
}

export function clientLog(level: LogLevel, event: string, details: Record<string, any> = {}) {
  const payload = {
    action: 'clientLog',
    level,
    event,
    sessionId: SESSION_ID,
    route: currentRoute(),
    clientTime: new Date().toISOString(),
    build: BUILD_INFO,
    details: normalizeValue(details, 0),
  }

  emitConsole(level, event, payload)

  try {
    if (!shouldUploadToCloud(level)) return
    if (!wxRef || !wxRef.cloud || !wxRef.cloud.callFunction) return
    wxRef.cloud.callFunction({
      name: 'post',
      data: payload,
      success: () => {},
      fail: (error: any) => emitConsole('warn', 'clientLog.send.fail', {
        event,
        error: normalizeValue(error, 0),
      }),
    })
  } catch (error) {
    emitConsole('warn', 'clientLog.send.throw', {
      event,
      error: normalizeValue(error, 0),
    })
  }
}

export function installRuntimeLogHooks() {
  if (hooksInstalled) return
  hooksInstalled = true
  try {
    if (wxRef && wxRef.onError) {
      wxRef.onError((message: any) => {
        clientLog('error', 'runtime.error', { message: String(message || '') })
      })
    }
    if (wxRef && wxRef.onUnhandledRejection) {
      wxRef.onUnhandledRejection((res: any) => {
        clientLog('error', 'runtime.unhandledRejection', {
          reason: res && res.reason ? res.reason : res,
        })
      })
    }
    if (wxRef && wxRef.onPageNotFound) {
      wxRef.onPageNotFound((res: any) => {
        clientLog('error', 'runtime.pageNotFound', res || {})
      })
    }
  } catch (error) {
    clientLog('warn', 'runtime.hooks.install.fail', { error })
  }
}
