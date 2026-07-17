import { safeErrorDiagnostic } from '../safe-error-diagnostic'

describe('safeErrorDiagnostic', () => {
  test('returns only allowlisted metadata and a deterministic truncated fingerprint', () => {
    const error = Object.assign(new Error('request https://secret:9200 token=abc'), {
      code: 'DATABASE_TRANSACTION_CONFLICT',
      endpoint: 'https://secret:9200',
      token: 'abc',
    })

    const first = safeErrorDiagnostic(error)
    const second = safeErrorDiagnostic(error)

    expect(first).toEqual({
      name: 'Error',
      code: 'DATABASE_TRANSACTION_CONFLICT',
      fingerprint: expect.stringMatching(/^[a-f0-9]{16}$/),
    })
    expect(second).toEqual(first)
    expect(Object.keys(first).sort()).toEqual(['code', 'fingerprint', 'name'])
    expect(JSON.stringify(first)).not.toContain('secret')
    expect(JSON.stringify(first)).not.toContain('token=abc')
  })

  test('replaces unsafe name and code tokens without reflecting them', () => {
    const result = safeErrorDiagnostic({
      name: 'Database error at https://secret:9200',
      code: 'token=abc\nDATABASE_FAILURE',
      message: 'password=hunter2',
    })

    expect(result).toMatchObject({ name: 'Error', code: 'UNKNOWN' })
    expect(JSON.stringify(result)).not.toMatch(/secret|token=abc|hunter2/)
  })

  test('rejects plausible-looking alphanumeric secrets that are not explicitly allowlisted', () => {
    const result = safeErrorDiagnostic({
      name: 'AbcToken123',
      code: 'hunter2',
      message: 'opaque',
    })

    expect(result).toMatchObject({ name: 'Error', code: 'UNKNOWN' })
    expect(JSON.stringify(result)).not.toMatch(/AbcToken123|hunter2/)
  })

  test.each(['CloudBaseError', 'DatabaseError', 'TimeoutError'])('allows the reviewed error name %s', (name) => {
    expect(safeErrorDiagnostic({ name })).toMatchObject({ name })
  })
})
