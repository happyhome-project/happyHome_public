#!/usr/bin/env node
import process from 'node:process'

import { inspectValidationLease, recoverValidationLease } from './lib/validation-lease.mjs'

function parseRecover(args) {
  if (args.length !== 3) throw new Error('recover requires --expected-owner-token=<uuid> --confirm-no-owner --reason=<text>')
  const owner = args.find((arg) => arg.startsWith('--expected-owner-token='))?.slice(23)
  const reason = args.find((arg) => arg.startsWith('--reason='))?.slice(9)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(owner || '')) {
    throw new Error('--expected-owner-token must be a UUID')
  }
  if (!args.includes('--confirm-no-owner')) throw new Error('--confirm-no-owner is required')
  if (!reason?.trim()) throw new Error('--reason=<text> is required')
  return { expectedOwnerToken: owner, confirmNoOwner: true, reason }
}

try {
  const [command, ...args] = process.argv.slice(2)
  let result
  if (command === 'status' && args.length === 0) result = await inspectValidationLease()
  else if (command === 'recover') result = await recoverValidationLease(parseRecover(args))
  else throw new Error('usage: validation-lease.mjs status | recover --expected-owner-token=<uuid> --confirm-no-owner --reason=<text>')
  console.log(JSON.stringify(result, null, 2))
} catch (error) {
  console.error(`[validation-lease] ${error?.message || error}`)
  process.exitCode = 1
}
