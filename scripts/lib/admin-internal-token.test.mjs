import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveAdminInternalToken } from './admin-internal-token.mjs'

test('resolves the admin internal capability from the explicit environment first', () => {
  const token = resolveAdminInternalToken(
    { ADMIN_INTERNAL_CALL_TOKEN: '  direct-secret  ' },
    { loadFile: () => ({ ADMIN_INTERNAL_CALL_TOKEN: 'file-secret' }) },
  )
  assert.equal(token, 'direct-secret')
})

test('falls back to the private HappyHome admin-internal env file', () => {
  const token = resolveAdminInternalToken({}, {
    loadFile: (filePath) => filePath.endsWith('admin-internal.env')
      ? { ADMIN_INTERNAL_CALL_TOKEN: 'file-secret' }
      : {},
  })
  assert.equal(token, 'file-secret')
})
