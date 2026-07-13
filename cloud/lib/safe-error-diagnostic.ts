import { createHash } from 'node:crypto'

export type SafeErrorDiagnostic = {
  name: string
  code: string
  fingerprint: string
}

function readStringProperty(value: unknown, key: 'name' | 'code' | 'message'): string {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return ''
  try {
    const property = Reflect.get(value, key)
    return typeof property === 'string' ? property : ''
  } catch {
    return ''
  }
}

function safeToken(value: string, fallback: string): string {
  return /^[A-Za-z0-9_.:-]{1,64}$/.test(value) ? value : fallback
}

export function safeErrorDiagnostic(error: unknown): SafeErrorDiagnostic {
  const rawName = readStringProperty(error, 'name')
  const rawCode = readStringProperty(error, 'code')
  const rawMessage = readStringProperty(error, 'message')
  const name = safeToken(rawName, 'Error')
  const code = safeToken(rawCode, 'UNKNOWN')
  const fingerprint = createHash('sha256')
    .update(`${name}\n${code}\n${rawMessage}`)
    .digest('hex')
    .slice(0, 16)
  return { name, code, fingerprint }
}
