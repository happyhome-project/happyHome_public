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

const SAFE_ERROR_NAMES = new Set(['Error', 'CloudBaseError', 'DatabaseError', 'TimeoutError'])
const SAFE_ERROR_CODES = new Set(['DATABASE_TRANSACTION_CONFLICT'])

export function safeErrorDiagnostic(error: unknown): SafeErrorDiagnostic {
  const rawName = readStringProperty(error, 'name')
  const rawCode = readStringProperty(error, 'code')
  const rawMessage = readStringProperty(error, 'message')
  const name = SAFE_ERROR_NAMES.has(rawName) ? rawName : 'Error'
  const code = SAFE_ERROR_CODES.has(rawCode) ? rawCode : 'UNKNOWN'
  const fingerprint = createHash('sha256')
    .update(`${rawName}\n${rawCode}\n${rawMessage}`)
    .digest('hex')
    .slice(0, 16)
  return { name, code, fingerprint }
}
