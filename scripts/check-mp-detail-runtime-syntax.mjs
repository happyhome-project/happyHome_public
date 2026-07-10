import path from 'node:path'
import process from 'node:process'

import { scanCriticalRuntimeSyntax } from './lib/mp-critical-runtime-syntax.mjs'

const distRoot = path.join(process.cwd(), 'miniprogram', 'dist', 'build', 'mp-weixin')

try {
  const { findings } = scanCriticalRuntimeSyntax(distRoot)
  if (findings.length > 0) {
    console.error('mp-weixin project-owned critical dependency chunks contain syntax/runtime APIs that have caused blank pages in WeChat trial runtime:')
    for (const finding of findings) {
      console.error(`- ${finding.file}: ${finding.rule} at ${finding.offset}: ${finding.snippet}`)
    }
    process.exit(1)
  }
  console.log('mp-weixin app/home/detail/profile critical runtime syntax check passed')
} catch (error) {
  console.error(error?.message || error)
  console.error('Run npm.cmd --workspace miniprogram run build:mp-weixin first.')
  process.exit(1)
}
