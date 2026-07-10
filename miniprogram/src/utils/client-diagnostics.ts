export type ClientDiagnosticScope = 'home' | 'all'

export interface ClientDiagnosticsState {
  enabled: boolean
  scope: ClientDiagnosticScope
  traceId: string
  expiresAt: number
}

export interface ClientDiagnosticEventInput {
  level: 'debug' | 'info' | 'warn' | 'error'
  event: string
  details?: Record<string, any>
  now?: number
}

export interface ClientDiagnosticEvent extends ClientDiagnosticEventInput {
  traceId: string
  sequence: number
  createdAt: string
  uploadedAt?: string
}

const DIAGNOSTICS_STATE_KEY = 'hh_debug_trace_v1'
const DIAGNOSTICS_EVENTS_KEY = 'hh_debug_trace_events_v1'
const MAX_EVENTS = 100
const MAX_STRING_LENGTH = 500
const MAX_ARRAY_LENGTH = 12
const MAX_OBJECT_KEYS = 24

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore wx is injected by the miniprogram runtime.
const wxRef: any = typeof wx !== 'undefined' ? wx : undefined

function storageApi() {
  if (wxRef?.getStorageSync && wxRef?.setStorageSync) return wxRef
  try {
    const uniRef: any = (globalThis as any).uni
    if (uniRef?.getStorageSync && uniRef?.setStorageSync) return uniRef
  } catch (_error) {}
  return null
}

function readStorage(key: string) {
  try {
    return storageApi()?.getStorageSync(key)
  } catch (_error) {
    return undefined
  }
}

function writeStorage(key: string, value: any) {
  try {
    storageApi()?.setStorageSync(key, value)
  } catch (_error) {}
}

function removeStorage(key: string) {
  try {
    storageApi()?.removeStorageSync(key)
  } catch (_error) {}
}

function makeTraceId(now: number) {
  const random = Math.random().toString(36).slice(2, 8)
  return `hh-${now.toString(36)}-${random}`
}

function trimString(value: string) {
  return value.length <= MAX_STRING_LENGTH ? value : `${value.slice(0, MAX_STRING_LENGTH)}...`
}

export function normalizeClientDiagnosticValue(value: any, depth = 0): any {
  if (value === null || value === undefined) return value
  const valueType = typeof value
  if (valueType === 'string') return trimString(value)
  if (valueType === 'number' || valueType === 'boolean') return value
  if (valueType === 'function') return '[function]'
  if (value instanceof Error) {
    return {
      name: value.name,
      message: trimString(value.message || ''),
      stack: trimString(value.stack || ''),
    }
  }
  if (depth >= 3) return '[max-depth]'
  if (Array.isArray(value)) {
    const output = value.slice(0, MAX_ARRAY_LENGTH).map((item) => normalizeClientDiagnosticValue(item, depth + 1))
    if (value.length > MAX_ARRAY_LENGTH) output.push(`[+${value.length - MAX_ARRAY_LENGTH} more]`)
    return output
  }
  if (valueType === 'object') {
    const output: Record<string, any> = {}
    const keys = Object.keys(value)
    const limit = Math.min(keys.length, MAX_OBJECT_KEYS)
    for (let index = 0; index < limit; index += 1) {
      const key = keys[index]
      if (/token|secret|password|authorization|cookie|openid|userid|nickname|avatar|phone|mobile|email|address|location|latitude|longitude|idcard/i.test(key)) {
        output[key] = '[redacted]'
        continue
      }
      try {
        output[key] = normalizeClientDiagnosticValue(value[key], depth + 1)
      } catch (_error) {
        output[key] = '[unreadable]'
      }
    }
    if (keys.length > limit) output.__moreKeys = keys.length - limit
    return output
  }
  return String(value)
}

function readEvents(): ClientDiagnosticEvent[] {
  const value = readStorage(DIAGNOSTICS_EVENTS_KEY)
  return Array.isArray(value) ? value.filter((item) => item && typeof item === 'object') : []
}

function writeEvents(events: ClientDiagnosticEvent[]) {
  writeStorage(DIAGNOSTICS_EVENTS_KEY, events.slice(-MAX_EVENTS))
}

function normalizeState(value: any, now: number): ClientDiagnosticsState {
  const expiresAt = Number(value?.expiresAt || 0)
  const scope = value?.scope === 'all' ? 'all' : 'home'
  const enabled = value?.enabled === true && expiresAt > now && !!String(value?.traceId || '')
  if (!enabled && value) removeStorage(DIAGNOSTICS_STATE_KEY)
  return {
    enabled,
    scope,
    traceId: enabled ? String(value.traceId) : '',
    expiresAt: enabled ? expiresAt : 0,
  }
}

export function getClientDiagnosticsState(now = Date.now()): ClientDiagnosticsState {
  return normalizeState(readStorage(DIAGNOSTICS_STATE_KEY), now)
}

export function enableClientDiagnostics(options: { scope?: ClientDiagnosticScope; ttlMs?: number; now?: number } = {}) {
  const now = Number(options.now || Date.now())
  const ttlMs = Math.max(1_000, Number(options.ttlMs || 30 * 60 * 1000))
  const state: ClientDiagnosticsState = {
    enabled: true,
    scope: options.scope === 'all' ? 'all' : 'home',
    traceId: makeTraceId(now),
    expiresAt: now + ttlMs,
  }
  writeStorage(DIAGNOSTICS_STATE_KEY, state)
  return state
}

export function disableClientDiagnostics() {
  removeStorage(DIAGNOSTICS_STATE_KEY)
}

export function clearClientDiagnosticEvents() {
  removeStorage(DIAGNOSTICS_EVENTS_KEY)
}

export function isClientDiagnosticsEnabled(scope: ClientDiagnosticScope = 'home', now = Date.now()) {
  const state = getClientDiagnosticsState(now)
  return state.enabled && (state.scope === 'all' || state.scope === scope)
}

export function recordClientDiagnosticEvent(input: ClientDiagnosticEventInput): ClientDiagnosticEvent | null {
  const now = Number(input.now || Date.now())
  const state = getClientDiagnosticsState(now)
  if (!state.enabled) return null
  const events = readEvents().filter((item) => item.traceId === state.traceId)
  const lastEvent = events.length > 0 ? events[events.length - 1] : null
  const event: ClientDiagnosticEvent = {
    level: input.level,
    event: String(input.event || ''),
    details: normalizeClientDiagnosticValue(input.details || {}, 0),
    now,
    traceId: state.traceId,
    sequence: Number(lastEvent?.sequence || 0) + 1,
    createdAt: new Date(now).toISOString(),
  }
  events.push(event)
  writeEvents(events)
  return event
}

export function readClientDiagnosticEvents() {
  return readEvents()
}

export function markClientDiagnosticEventUploaded(traceId: string, sequence: number, now = Date.now()) {
  const events = readEvents()
  const updated = events.map((event) => {
    if (event.traceId === traceId && event.sequence === sequence) {
      return Object.assign({}, event, { uploadedAt: new Date(now).toISOString() })
    }
    return event
  })
  writeEvents(updated)
}

export async function flushClientDiagnosticEvents(
  send: (event: ClientDiagnosticEvent) => Promise<boolean>,
  limit = 20,
) {
  const pending = readEvents()
    .filter((event) => !event.uploadedAt)
    .slice(0, Math.max(0, limit))
  let uploaded = 0
  for (const event of pending) {
    if (await send(event)) {
      markClientDiagnosticEventUploaded(event.traceId, event.sequence)
      uploaded += 1
    }
  }
  return { attempted: pending.length, uploaded }
}
