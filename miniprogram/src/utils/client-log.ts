import { BUILD_INFO } from '../generated/build-info'
import {
  flushClientDiagnosticEvents,
  getClientDiagnosticsState,
  isClientDiagnosticsEnabled,
  markClientDiagnosticEventUploaded,
  normalizeClientDiagnosticValue,
  readClientDiagnosticEvents,
  recordClientDiagnosticEvent,
} from './client-diagnostics'

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore wx is injected by the miniprogram runtime.
const wxRef: any = typeof wx !== 'undefined' ? wx : undefined

const SESSION_ID = makeSessionId()

let hooksInstalled = false
let homeWatchdogTraceId = ''

function makeSessionId() {
  const rand = Math.random().toString(36).slice(2, 8)
  return 's-' + Date.now().toString(36) + '-' + rand
}

function normalizeValue(value: any, depth: number): any {
  void depth
  return normalizeClientDiagnosticValue(value, 0)
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

function shouldUploadToCloud(level: LogLevel, event: string, diagnosticCapture: boolean) {
  if (level === 'warn' || level === 'error') return true
  if (event === 'app.launch.start') return true
  if (diagnosticCapture) return true
  return isVerboseCloudLoggingEnabled()
}

function emitNativeLog(level: LogLevel, event: string, details: Record<string, any>, diagnosticCapture: boolean) {
  if (!diagnosticCapture) return
  try {
    const manager = wxRef?.getLogManager?.({ level: 0 })
    const method = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'
    manager?.[method]?.(event, details)
  } catch (_error) {
    // Native diagnostics must never affect product behavior.
  }
}

function uploadPayload(payload: Record<string, any>, onSuccess?: () => void) {
  try {
    if (!wxRef?.cloud?.callFunction) return false
    wxRef.cloud.callFunction({
      name: 'post',
      data: payload,
      success: () => onSuccess?.(),
      fail: (error: any) => emitConsole('warn', 'clientLog.send.fail', {
        event: payload.event,
        error: normalizeValue(error, 0),
      }),
    })
    return true
  } catch (error) {
    emitConsole('warn', 'clientLog.send.throw', {
      event: payload.event,
      error: normalizeValue(error, 0),
    })
    return false
  }
}

export function clientLog(level: LogLevel, event: string, details: Record<string, any> = {}) {
  const route = currentRoute()
  const diagnosticCapture = isClientDiagnosticsEnabled('home') && (
    route === 'pages/index/index' ||
    event.startsWith('home.') ||
    event.startsWith('runtime.')
  )
  const payload = {
    action: 'clientLog',
    level,
    event,
    sessionId: SESSION_ID,
    route,
    clientTime: new Date().toISOString(),
    build: BUILD_INFO,
    details: normalizeValue(details, 0),
  }

  emitConsole(level, event, payload)
  emitNativeLog(level, event, payload.details, diagnosticCapture)
  const diagnosticEvent = diagnosticCapture ? recordClientDiagnosticEvent({ level, event, details: payload.details }) : null

  if (!shouldUploadToCloud(level, event, diagnosticCapture)) return
  uploadPayload(payload, () => {
    if (diagnosticEvent) {
      markClientDiagnosticEventUploaded(diagnosticEvent.traceId, diagnosticEvent.sequence)
    }
  })
}

export async function flushClientDiagnostics() {
  return flushClientDiagnosticEvents(async (event) => {
    const payload = {
      action: 'clientLog',
      level: event.level,
      event: event.event,
      sessionId: `diagnostic:${event.traceId}`,
      route: currentRoute(),
      clientTime: event.createdAt,
      build: BUILD_INFO,
      details: Object.assign({}, event.details, {
        diagnosticTraceId: event.traceId,
        diagnosticSequence: event.sequence,
        diagnosticReplay: true,
      }),
    }
    return await new Promise<boolean>((resolve) => {
      try {
        if (!wxRef?.cloud?.callFunction) {
          resolve(false)
          return
        }
        wxRef.cloud.callFunction({
          name: 'post',
          data: payload,
          success: () => resolve(true),
          fail: () => resolve(false),
        })
      } catch (_error) {
        resolve(false)
      }
    })
  })
}

export function markClientDiagnosticStage(event: string, details: Record<string, any> = {}) {
  clientLog('info', event, details)
}

export function startHomeDiagnosticWatchdog() {
  const state = getClientDiagnosticsState()
  if (!state.enabled || state.scope !== 'home' && state.scope !== 'all') return
  if (homeWatchdogTraceId === state.traceId) return
  homeWatchdogTraceId = state.traceId
  for (const delayMs of [2000, 8000]) {
    setTimeout(() => {
      if (!isClientDiagnosticsEnabled('home')) return
      const route = currentRoute()
      if (route !== 'pages/index/index') return
      const committed = readClientDiagnosticEvents().some((event) => event.event === 'home.render.commit')
      if (!committed) {
        clientLog('warn', 'home.watchdog.timeout', { delayMs, route })
      }
    }, delayMs)
  }
}

export function installVueRuntimeLogHooks(app: any) {
  if (!app?.config) return
  const previousErrorHandler = app.config.errorHandler
  const previousWarnHandler = app.config.warnHandler
  app.config.errorHandler = (error: any, instance: any, info: string) => {
    clientLog('error', 'vue.error', {
      error,
      info: String(info || ''),
      component: String(instance?.$options?.name || instance?.type?.name || ''),
    })
    if (typeof previousErrorHandler === 'function') previousErrorHandler(error, instance, info)
  }
  app.config.warnHandler = (message: string, instance: any, trace: string) => {
    if (isClientDiagnosticsEnabled('home')) {
      clientLog('debug', 'vue.warn', {
        message: String(message || ''),
        trace: String(trace || ''),
        component: String(instance?.$options?.name || instance?.type?.name || ''),
      })
    }
    if (typeof previousWarnHandler === 'function') previousWarnHandler(message, instance, trace)
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
