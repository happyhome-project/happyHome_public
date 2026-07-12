import { spawnSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { classifyChanges, OUTPUT_KEYS, parseNameStatusBuffer, parseNumstatBuffer } from './lib/ci-impact.mjs'

function argument(name) {
  const prefix = `--${name}=`
  const value = process.argv.slice(2).find((item) => item.startsWith(prefix))?.slice(prefix.length)
  if (!value) throw new Error(`Missing required ${prefix}<commit> argument`)
  return value
}

function gitDiff(args) {
  const result = spawnSync('git', ['--no-pager', 'diff', ...args], {
    windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  })
  if (result.error || result.status !== 0) throw new Error(`git diff failed: ${result.error?.message || result.stderr.toString('utf8').trim() || `exit ${result.status}`}`)
  return result.stdout
}

try {
  const base = argument('base')
  const head = argument('head')
  const range = `${base}..${head}`
  const changes = parseNameStatusBuffer(gitDiff(['--name-status', '-z', '--find-renames', '--find-copies', '--no-ext-diff', range]))
  parseNumstatBuffer(gitDiff(['--numstat', '-z', '--no-renames', '--no-ext-diff', range]), changes)
  const impact = classifyChanges(changes)
  process.stdout.write(`${JSON.stringify(impact)}\n`)
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${OUTPUT_KEYS.map((key) => `${key}=${impact[key]}`).join('\n')}\n`)
} catch (error) {
  process.stderr.write(`ci-impact: ${error.message}\n`)
  process.exitCode = 1
}
