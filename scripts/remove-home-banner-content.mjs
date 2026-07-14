#!/usr/bin/env node
import process from 'node:process'
import { pathToFileURL } from 'node:url'

import { invokeAdmin, parseRebuildArgs } from './rebuild-post-search-index.mjs'
import {
  parseHomeBannerCleanupArgs,
  runHomeBannerCleanup,
} from './lib/remove-home-banner-content.mjs'

function printUsage() {
  console.log(`Usage:
  node scripts/remove-home-banner-content.mjs
  node scripts/remove-home-banner-content.mjs --all-communities --apply --confirm-soft-delete-banner-posts

The command is dry-run by default. Apply is rejected unless all three confirmation flags are present.
It only soft-deletes post IDs frozen from homeBanners at the beginning of the run, then clears those communities' homeBanners.

Options:
  --all-communities                  Required with --apply.
  --apply                            Execute soft deletes and Banner clearing.
  --confirm-soft-delete-banner-posts Required with --apply.
  --env-id <envId>                   CloudBase environment override.
  --help                             Show this help.
`)
}

export async function main(argv = process.argv.slice(2)) {
  const safety = parseHomeBannerCleanupArgs(argv)
  if (safety.help) {
    printUsage()
    return null
  }
  const invokeOptions = parseRebuildArgs(argv)
  const invoke = async (action, params) => {
    const record = await invokeAdmin(action, params, invokeOptions)
    return record.functionResult || {}
  }
  const report = await runHomeBannerCleanup({ apply: safety.apply }, invoke)
  console.log(JSON.stringify(report, null, 2))
  if (report.failedCommunityCount > 0) process.exitCode = 1
  return report
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`[home-banner-cleanup] FAILED: ${error?.message || error}`)
    process.exitCode = 1
  })
}
