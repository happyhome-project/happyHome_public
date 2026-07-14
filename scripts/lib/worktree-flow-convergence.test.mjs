import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

import { collectStatusMode, decideBootstrap, decideSync, executeBootstrap, executeRetirement, executeWorktreeRemoval, verifySyncSnapshot } from './worktree-lifecycle.mjs'

function git(args, cwd, allowFailure = false) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true })
  if (!allowFailure && result.status !== 0) throw new Error(result.stderr)
  return result
}

test('bootstrap skips only when fingerprint matches and node_modules exists', () => {
  const fingerprint = { packageSha256: 'p', lockSha256: 'l', node: '24.1.0', npm: '11.2.0', platform: 'win32', arch: 'x64' }
  assert.deepEqual(decideBootstrap({ fingerprint, marker: { schemaVersion: 2, fingerprint }, nodeModulesPresent: true }), { action: 'skip' })
  assert.deepEqual(decideBootstrap({ fingerprint, marker: { schemaVersion: 2, fingerprint: { ...fingerprint, lockSha256: 'old' } }, nodeModulesPresent: true }), { action: 'install', reason: 'fingerprint_changed' })
  assert.deepEqual(decideBootstrap({ fingerprint, marker: { schemaVersion: 2, fingerprint }, nodeModulesPresent: false }), { action: 'install', reason: 'node_modules_missing' })
})

test('bootstrap execution ignores HEAD but installs for dependency, toolchain, or modules drift', () => {
  const fingerprint = { packageSha256: 'p', lockSha256: 'l', node: '24', npm: '11', platform: 'win32', arch: 'x64' }
  let installs = 0; let writes = 0
  const run = (marker, modules = true) => executeBootstrap({ fingerprint, marker, nodeModulesPresent: modules, install: () => installs++, writeMarker: () => writes++ })
  assert.equal(run({ schemaVersion: 2, head: 'old', fingerprint }).action, 'skip')
  assert.equal(run({ schemaVersion: 2, head: 'new', fingerprint }).action, 'skip')
  for (const key of ['packageSha256', 'lockSha256', 'node', 'npm', 'platform', 'arch']) assert.equal(run({ schemaVersion: 2, fingerprint: { ...fingerprint, [key]: 'changed' } }).action, 'install')
  assert.equal(run({ schemaVersion: 2, fingerprint }, false).action, 'install')
  assert.equal(installs, 7); assert.equal(writes, 7)
})

test('status local performs no refresh or PR read while fresh performs both', () => {
  let refreshes = 0; let prs = 0; let inventories = 0
  const options = { refresh: () => { refreshes++; return { ok: true } }, readPullRequests: () => { prs++; return [] }, collectLocal: () => { inventories++; return ['entry'] } }
  assert.equal(collectStatusMode({ ...options }).status, 'local')
  assert.deepEqual([refreshes, prs, inventories], [0, 0, 1])
  assert.equal(collectStatusMode({ ...options, fresh: true }).status, 'fresh')
  assert.deepEqual([refreshes, prs, inventories], [1, 1, 2])
})

test('fresh status exits nonzero and retains inventory when gh fails after fetch succeeds', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'happyhome-status-gh-fail-')); t.after(() => rmSync(dir, { recursive: true, force: true }))
  const remote = join(dir, 'remote.git'), repo = join(dir, 'repo'), bin = join(dir, 'bin')
  git(['init','--bare',remote],dir); git(['init','-b','main',repo],dir); git(['config','user.name','Test'],repo); git(['config','user.email','test@example.invalid'],repo)
  git(['commit','--allow-empty','-m','base'],repo); git(['config',`url.${remote.replaceAll('\\','/')}.insteadOf`,'https://github.com/happyhome-project/happyHome_public.git'],repo); git(['remote','add','origin','https://github.com/happyhome-project/happyHome_public.git'],repo); git(['push','-u','origin','main'],repo)
  mkdirSync(bin); writeFileSync(join(bin,'gh.cmd'),'@echo fake gh failure 1>&2\r\n@exit /b 23\r\n')
  const script = fileURLToPath(new URL('../worktree.mjs', import.meta.url))
  const result = spawnSync(process.execPath,[script,'status','--fresh'],{cwd:repo,encoding:'utf8',windowsHide:true,env:{...process.env,PATH:`${bin};${process.env.PATH}`,GH_TOKEN:'definitely-invalid-token',GH_CONFIG_DIR:join(dir,'gh-config')}})
  assert.notEqual(result.status,0); const output = JSON.parse(result.stdout)
  assert.equal(output.status,'stale'); assert.equal(output.entries.length,1); assert.match(JSON.stringify(output),/fake gh failure|gh exited|HTTP 401|bad credentials/i)
})

test('bootstrap CLI installs once, skips matching and HEAD-only changes, then reinstalls for dependency or modules drift', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'happyhome-bootstrap-cli-')); t.after(() => rmSync(dir, { recursive: true, force: true }))
  const remote = join(dir,'remote.git'), repo = join(dir,'repo'); git(['init','--bare',remote],dir); git(['init','-b','codex/test',repo],dir)
  git(['config','user.name','Test'],repo); git(['config','user.email','test@example.invalid'],repo); git(['config','extensions.worktreeConfig','true'],repo); git(['config','--worktree','core.hooksPath','.githooks'],repo)
  mkdirSync(join(repo,'.githooks')); writeFileSync(join(repo,'.githooks','post-checkout'),''); writeFileSync(join(repo,'.githooks','pre-push'),''); writeFileSync(join(repo,'AGENTS.md'),'# fixture\n'); writeFileSync(join(repo,'.gitignore'),'.codex-local/\nnode_modules/\n')
  mkdirSync(join(repo,'dep')); writeFileSync(join(repo,'dep','package.json'),'{"name":"fixture-dep","version":"1.0.0"}\n'); writeFileSync(join(repo,'package.json'),'{"name":"fixture","version":"1.0.0","dependencies":{"fixture-dep":"file:dep"}}\n'); const lockResult=spawnSync(process.env.ComSpec || 'cmd.exe',['/d','/s','/c','npm.cmd install --package-lock-only --ignore-scripts'],{cwd:repo,encoding:'utf8',windowsHide:true}); assert.equal(lockResult.status,0,lockResult.stderr)
  git(['add','.'],repo); git(['commit','-m','base'],repo); git(['remote','add','origin',remote],repo); git(['push','--no-verify','origin','HEAD:main'],repo); git(['update-ref','refs/remotes/origin/main','HEAD'],repo)
  const script = fileURLToPath(new URL('../worktree.mjs', import.meta.url)); const bootstrap = () => spawnSync(process.execPath,[script,'bootstrap'],{cwd:repo,encoding:'utf8',windowsHide:true}); const output = (result) => { const index=result.stdout.lastIndexOf('\n{'); return JSON.parse(result.stdout.slice(index < 0 ? 0 : index + 1)) }
  let result=bootstrap(); assert.equal(result.status,0,result.stderr); assert.equal(output(result).action,'installed'); assert.ok(existsSync(join(repo,'.codex-local','bootstrap.json')))
  result=bootstrap(); assert.equal(output(result).action,'skipped')
  git(['commit','--allow-empty','-m','head only'],repo); result=bootstrap(); assert.equal(output(result).action,'skipped')
  const pkg=JSON.parse(readFileSync(join(repo,'package.json'),'utf8')); pkg.description='changed'; writeFileSync(join(repo,'package.json'),JSON.stringify(pkg)); const lock=JSON.parse(readFileSync(join(repo,'package-lock.json'),'utf8')); lock.packages[''].description='changed'; writeFileSync(join(repo,'package-lock.json'),JSON.stringify(lock)); git(['add','.'],repo); git(['commit','-m','deps'],repo)
  result=bootstrap(); assert.equal(output(result).action,'installed'); rmSync(join(repo,'node_modules'),{recursive:true,force:true}); result=bootstrap(); assert.equal(output(result).action,'installed')
  const doctor=spawnSync(process.execPath,[script,'doctor'],{cwd:repo,encoding:'utf8',windowsHide:true}); assert.doesNotMatch(doctor.stdout,/lifecycle|ownership|heartbeat/i)
})

test('retirement evidence blocks every safety gate and eligible removal is nonforce and retains branch', () => {
  const base = { kind: 'worktree', path: 'X:/fixture/wt', branch: 'codex/done', hasOperation: false, isDirty: false, openPr: { known: true, open: false }, uniqueCommits: 0, headInMain: true, pathIsReparsePoint: false }
  for (const [field, value, reason] of [['branch','main','main_branch'],['isDirty',true,'dirty'],['openPr',{known:true,open:true},'open_pr'],['uniqueCommits',1,'unique_commits'],['headInMain',false,'head_not_in_main']]) {
    const result = executeRetirement({ probe: () => ({ ...base, [field]: value }), remove: () => assert.fail('removed') })
    assert.equal(result.status, 'blocked'); assert.ok(result.decision.reasons.includes(reason))
  }
  let argv
  const result = executeRetirement({ probe: () => base, remove: (args) => { argv = args } })
  assert.deepEqual(argv, ['worktree', 'remove', base.path]); assert.equal(result.branch, 'codex/done')
})

test('eligible retirement removes a temporary linked worktree nonforce while retaining its branch', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'happyhome-retire-flow-')); t.after(() => rmSync(dir, { recursive: true, force: true }))
  const repo = join(dir, 'repo'), linked = join(dir, 'linked')
  git(['init','-b','main',repo],dir); git(['config','user.name','Test'],repo); git(['config','user.email','test@example.invalid'],repo); git(['commit','--allow-empty','-m','base'],repo)
  git(['worktree','add','-b','codex/done',linked,'main'],repo)
  const result = executeRetirement({ probe: () => ({ kind:'worktree', path:linked, branch:'codex/done', hasOperation:false, isDirty:false, openPr:{known:true,open:false}, uniqueCommits:0, headInMain:true, pathIsReparsePoint:false }), remove: (args) => git(args, repo) })
  assert.equal(result.status,'retired'); assert.equal(existsSync(linked),false); assert.equal(git(['show-ref','--verify','refs/heads/codex/done'],repo).status,0)
  const script = fileURLToPath(new URL('../worktree.mjs', import.meta.url))
  for (const flag of ['--prepare','--apply','--confirm-no-owner']) assert.match(spawnSync(process.execPath,[script,'retire',flag,linked],{cwd:repo,encoding:'utf8',windowsHide:true}).stderr,/legacy retire flags/i)
})

test('retirement clears workspace junctions before nonforce Git removal', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'happyhome-retire-junction-')); t.after(() => rmSync(dir, { recursive: true, force: true }))
  const repo = join(dir, 'repo'), linked = join(dir, 'linked')
  git(['init','-b','main',repo],dir); git(['config','user.name','Test'],repo); git(['config','user.email','test@example.invalid'],repo); git(['commit','--allow-empty','-m','base'],repo)
  git(['worktree','add','-b','codex/junction',linked,'main'],repo)
  const workspace = join(linked, 'workspace'), modules = join(linked, 'node_modules')
  mkdirSync(workspace); mkdirSync(modules); symlinkSync(workspace, join(modules, 'workspace'), process.platform === 'win32' ? 'junction' : 'dir')

  let gitArgs
  const result = executeWorktreeRemoval({
    path: linked,
    removeInstallArtifacts: () => rmSync(modules, { recursive: true, force: true }),
    removeWorktree: (args) => {
      gitArgs = args
      const outcome = git(args, repo, true)
      return { ok: outcome.status === 0, status: outcome.status, stderr: outcome.stderr }
    },
    isRegistered: () => git(['worktree','list','--porcelain'],repo).stdout.includes(linked.replaceAll('\\','/')),
    removeResidual: () => rmSync(linked, { recursive: true, force: true }),
    inspectResidual: () => ({ exists: existsSync(linked), empty: existsSync(linked) ? readdirSync(linked).length === 0 : true }),
  })

  assert.deepEqual(gitArgs, ['worktree', 'remove', linked])
  assert.equal(result.status, 'retired')
  assert.equal(existsSync(linked), false)
  assert.equal(git(['show-ref','--verify','refs/heads/codex/junction'],repo).status, 0)
})

test('sync CLI executes no-op, fast-forward, divergent merge, blockers, and preserves conflict evidence', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'happyhome-sync-flow-')); t.after(() => rmSync(dir, { recursive: true, force: true }))
  const remote = join(dir, 'remote.git'), seed = join(dir, 'seed'), work = join(dir, 'work')
  git(['init', '--bare', remote], dir); git(['init', '-b', 'main', seed], dir)
  git(['config','user.name','Test'],seed); git(['config','user.email','test@example.invalid'],seed)
  writeFileSync(join(seed,'file.txt'),'base\n'); git(['add','.'],seed); git(['commit','-m','base'],seed); git(['remote','add','origin',remote],seed); git(['push','-u','origin','main'],seed); git(['symbolic-ref','HEAD','refs/heads/main'],remote)
  git(['clone',remote,work],dir); git(['switch','-c','codex/test'],work); git(['config','user.name','Test'],work); git(['config','user.email','test@example.invalid'],work)
  const script = fileURLToPath(new URL('../worktree.mjs', import.meta.url)); const sync = () => spawnSync(process.execPath,[script,'sync-main'],{cwd:work,encoding:'utf8',windowsHide:true})
  assert.equal(JSON.parse(sync().stdout).action,'noop')
  git(['commit','--allow-empty','-m','remote ff'],seed); git(['push','origin','main'],seed); assert.equal(JSON.parse(sync().stdout).action,'fast_forward')
  git(['commit','--allow-empty','-m','ahead'],work); assert.equal(JSON.parse(sync().stdout).action,'noop')
  git(['commit','--allow-empty','-m','remote'],seed); git(['push','origin','main'],seed); assert.equal(JSON.parse(sync().stdout).action,'merge')
  writeFileSync(join(work,'dirty.txt'),'dirty'); assert.notEqual(sync().status,0); rmSync(join(work,'dirty.txt'))
  writeFileSync(join(work,'.git','MERGE_HEAD'),git(['rev-parse','HEAD'],work).stdout.trim()); const operation = sync(); assert.notEqual(operation.status,0); assert.match(operation.stderr,/git_operation/); rmSync(join(work,'.git','MERGE_HEAD'))
  writeFileSync(join(seed,'file.txt'),'remote\n'); git(['add','.'],seed); git(['commit','-m','remote conflict'],seed); git(['push','origin','main'],seed)
  writeFileSync(join(work,'file.txt'),'local\n'); git(['add','.'],work); git(['commit','-m','local conflict'],work)
  const conflict = sync(); assert.notEqual(conflict.status,0); assert.equal(existsSync(join(work,'.git','MERGE_HEAD')),true); assert.match(readFileSync(join(work,'file.txt'),'utf8'),/<<<<<<<|>>>>>>>/)
})

test('sync decision covers equal, ahead, behind, diverged, dirty and conflict-preserving merge choices', () => {
  const main='a'.repeat(40)
  assert.deepEqual(decideSync({ isDirty: false, hasOperation: false, behind: 0, ahead: 0 }), { action: 'noop' })
  assert.deepEqual(decideSync({ isDirty: false, hasOperation: false, behind: 0, ahead: 2 }), { action: 'noop' })
  assert.deepEqual(decideSync({ isDirty: false, hasOperation: false, behind: 2, ahead: 0, main }), { action: 'fast_forward', args: ['merge', '--ff-only', main] })
  assert.deepEqual(decideSync({ isDirty: false, hasOperation: false, behind: 2, ahead: 1, main }), { action: 'merge', args: ['merge', '--no-edit', main] })
  const pinned=decideSync({behind:1,ahead:0,main}); const movedRef='c'.repeat(40); assert.notEqual(movedRef,main); assert.equal(pinned.args.at(-1),main)
  assert.throws(()=>decideSync({behind:1,ahead:0,main:'origin/main'}),/exact.*SHA/i)
  assert.deepEqual(decideSync({ isDirty: true, hasOperation: false, behind: 2, ahead: 0 }), { action: 'blocked', reason: 'dirty' })
  assert.deepEqual(decideSync({ isDirty: false, hasOperation: true, behind: 2, ahead: 0 }), { action: 'blocked', reason: 'git_operation' })
})

test('sync snapshot rejects every identity or operation race immediately before merge', () => {
  const expected={root:'X:/repo',branch:'codex/x',head:'a',main:'b',dirty:false,behind:1,ahead:0}
  assert.doesNotThrow(()=>verifySyncSnapshot(expected,{...expected},false))
  for (const field of Object.keys(expected)) assert.throws(()=>verifySyncSnapshot(expected,{...expected,[field]:field==='dirty'?true:'changed'},false),/changed.*rerun/i,field)
  assert.throws(()=>verifySyncSnapshot(expected,{...expected},true),/changed.*rerun/i)
})

test('CLI source rejects legacy flags, local status is network-free, fresh status opts into network, and retire is non-force', () => {
  const source = readFileSync(fileURLToPath(new URL('../worktree.mjs', import.meta.url)), 'utf8')
  assert.match(source, /status[^]*flags\.has\('fresh'\)/)
  assert.match(source, /legacy[^]*(?:prepare|apply|expected-head|confirm-no-owner)/i)
  assert.match(source, /executeWorktreeRemoval/)
  assert.match(source, /removeRetirementInstallArtifacts/)
  assert.match(source, /removeWorktree:[^]*allowFailure:\s*true/)
  assert.doesNotMatch(source, /worktree', 'remove', '--force'/)
  assert.doesNotMatch(source, /function heartbeat\(|registryPath|retirementRecords|ownerState/)
})

test('collaboration docs assign merge queue arming and terminal ownership to the feature agent', () => {
  for (const relative of ['../../AGENTS.md', '../../docs/SETUP.md']) {
    const source = readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
    assert.match(source, /gh pr merge <N> --auto --merge/)
    assert.match(source, /MERGED.*CLOSED|CLOSED.*MERGED/)
    assert.doesNotMatch(source, /主干协调 AI|协调者/)
    const worktreeSection = source.match(/(?:### Worktree 引导|## Worktree)[\s\S]*?(?=\n##|\n### 机器本地验证租约)/)?.[0] || source
    assert.doesNotMatch(worktreeSection, /heartbeat|candidate_stale/)
  }
})
