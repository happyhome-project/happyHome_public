import test from 'node:test'
import assert from 'node:assert/strict'
import {
  assessPublicIntegrationMain,
  assessRetirementTargetBoundary,
  classifyWorktreeRetirement,
  createWorktreePlan,
  decideSync,
  executeWorktreeMutation,
  githubRepositoryFromRemote,
  interpretAncestorExitStatus,
  normalizeExternalCommandResult,
  verifiedPublicOriginUrl,
  verifyCreateTargetBoundary,
} from './worktree-lifecycle.mjs'

test('public integration operator requires clean synchronized public main', () => {
  const base = { root: 'C:/public', commonDirectory: 'C:/public/.git', repository: 'happyhome-project/happyHome_public', branch: 'main', head: 'a', main: 'a', behind: 0, ahead: 0, isDirty: false, hasOperation: false, pathIsReparsePoint: false }
  assert.equal(assessPublicIntegrationMain(base).eligible, true)
  for (const [field, value] of [['branch','codex/x'],['behind',1],['ahead',1],['isDirty',true],['hasOperation',true],['pathIsReparsePoint',true],['repository','other/repo']]) assert.equal(assessPublicIntegrationMain({ ...base, [field]: value }).eligible, false, field)
})

test('retirement classifier contains only current local and remote evidence gates', () => {
  const base = { kind:'worktree', branch:'codex/done', hasOperation:false, isDirty:false, openPr:{known:true,open:false}, uniqueCommits:0, headInMain:true, pathIsReparsePoint:false }
  const eligible = classifyWorktreeRetirement(base)
  assert.equal(eligible.eligible,true); assert.equal('candidateStale' in eligible,false); assert.equal('owner' in eligible.checks,false); assert.equal('activeOwner' in eligible.checks,false)
  for (const [field,value,reason] of [['branch','main','main_branch'],['hasOperation',true,'git_operation'],['isDirty',true,'dirty'],['openPr',{known:true,open:true},'open_pr'],['uniqueCommits',1,'unique_commits'],['headInMain',false,'head_not_in_main'],['pathIsReparsePoint',true,'reparse_point']]) assert.ok(classifyWorktreeRetirement({ ...base,[field]:value }).reasons.includes(reason),field)
  assert.equal(classifyWorktreeRetirement({kind:'bare'}).classification,'unprobeable')
})

test('worktree mutation probes and verifies under its operation lock before remove', () => {
  const events=[]
  executeWorktreeMutation({ withOperationLock:(action)=>{events.push('lock'); return action()}, probe:()=>{events.push('probe');return {ok:true}}, verify:()=>events.push('verify'), remove:()=>events.push('remove') })
  assert.deepEqual(events,['lock','probe','verify','remove'])
})

test('sync decisions and worktree plans use the streamlined contract', () => {
  const main='b'.repeat(40)
  assert.deepEqual(decideSync({behind:0,ahead:2}),{action:'noop'})
  assert.deepEqual(decideSync({behind:2,ahead:0,main}),{action:'fast_forward',args:['merge','--ff-only',main]})
  assert.deepEqual(decideSync({behind:2,ahead:1,main}),{action:'merge',args:['merge','--no-edit',main]})
  assert.deepEqual(createWorktreePlan({name:'flow-test',path:'X:/tmp/flow'}),{branch:'codex/flow-test',path:'X:/tmp/flow'})
})

test('repository, target boundary, ancestor, and command helpers fail closed', () => {
  assert.equal(githubRepositoryFromRemote('https://github.com/happyhome-project/happyHome_public.git'),'happyhome-project/happyHome_public')
  assert.equal(verifiedPublicOriginUrl('git@github.com:happyhome-project/happyHome_public.git'),'git@github.com:happyhome-project/happyHome_public.git')
  assert.equal(assessRetirementTargetBoundary({registered:true,operatorCommonDirectory:'x',targetCommonDirectory:'x',hasReparseAncestor:false}).eligible,true)
  assert.equal(interpretAncestorExitStatus(128),null)
  assert.equal(normalizeExternalCommandResult({status:1,stderr:'bad'},{allowFailure:true}).ok,false)
  const boundary={targetExists:false,hasReparseAncestor:false,anchorPath:'x',anchorRealPath:'x',anchorDevice:'1',anchorInode:'2'}
  assert.doesNotThrow(()=>verifyCreateTargetBoundary(boundary,{...boundary})); assert.throws(()=>verifyCreateTargetBoundary(boundary,{...boundary,targetExists:true}),/exists/)
})
