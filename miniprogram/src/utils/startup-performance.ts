const STARTUP_PERFORMANCE_NAMES = new Set([
  'appLaunch',
  'downloadPackage',
  'evaluateScript',
  'firstRender',
  'firstPaint',
  'firstContentfulPaint',
  'largestContentfulPaint',
])

const STARTUP_PERFORMANCE_ENTRY_TYPES = new Set([
  'navigation',
  'render',
  'script',
  'loadPackage',
])

const MAX_BUFFERED_ENTRIES = 64

export interface StartupPerformanceEntry {
  name: string
  entryType: string
  startTime: number
  duration: number
}

type StartupPerformanceRecorder = (
  event: string,
  details: { count: number; entries: StartupPerformanceEntry[] },
) => void

let installed = false
let bufferedEntries: StartupPerformanceEntry[] = []
const bufferedEntryKeys = new Set<string>()
let nativePerformance: any = null
let performanceObserver: any = null

function getWxRef() {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore wx is injected by the mini-program runtime.
  return typeof wx !== 'undefined' ? wx : null
}

function finiteNumber(value: unknown, fallback = 0) {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : fallback
}

function normalizeEntry(raw: any): StartupPerformanceEntry | null {
  const name = String(raw?.name || '')
  const entryType = String(raw?.entryType || '')
  if (!STARTUP_PERFORMANCE_NAMES.has(name) || !STARTUP_PERFORMANCE_ENTRY_TYPES.has(entryType)) return null
  return {
    name,
    entryType,
    startTime: finiteNumber(raw?.startTime),
    duration: finiteNumber(raw?.duration),
  }
}

function bufferPerformanceEntries(entries: unknown) {
  if (!Array.isArray(entries)) return
  entries.forEach((raw) => {
    const entry = normalizeEntry(raw)
    if (!entry) return
    const key = `${entry.name}:${entry.entryType}:${entry.startTime}:${entry.duration}`
    if (bufferedEntryKeys.has(key)) return
    bufferedEntryKeys.add(key)
    bufferedEntries.push(entry)
  })
  if (bufferedEntries.length > MAX_BUFFERED_ENTRIES) {
    bufferedEntries = bufferedEntries.slice(-MAX_BUFFERED_ENTRIES)
  }
}

export function installStartupPerformanceCapture(wxApi: any = getWxRef()) {
  if (installed) return
  installed = true
  try {
    const performance = wxApi?.getPerformance?.()
    if (!performance) return
    nativePerformance = performance
    const observer = performance.createObserver?.((entryList: any) => {
      try {
        bufferPerformanceEntries(entryList?.getEntries?.())
      } catch (_error) {
        // Performance evidence must never affect the product path.
      }
    })
    performanceObserver = observer || null
    observer?.observe?.({ entryTypes: ['navigation', 'render', 'script', 'loadPackage'] })
    bufferPerformanceEntries(performance.getEntries?.())
  } catch (_error) {
    // Unsupported runtimes degrade to no startup trace.
  }
}

export function flushStartupPerformanceCapture(record: StartupPerformanceRecorder) {
  try {
    bufferPerformanceEntries(nativePerformance?.getEntries?.())
    performanceObserver?.disconnect?.()
  } catch (_error) {
    // Unsupported collection methods degrade to the entries already buffered.
  }
  nativePerformance = null
  performanceObserver = null
  if (!bufferedEntries.length) return 0
  const entries = bufferedEntries
  bufferedEntries = []
  bufferedEntryKeys.clear()
  try {
    record('startup.performance', { count: entries.length, entries })
  } catch (_error) {
    // Diagnostics must never affect the post-ready product path.
  }
  return entries.length
}
