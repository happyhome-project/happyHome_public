#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createEvaluationIdentities, runLiveSemanticEvaluation } from './lib/live-semantic-evaluator.mjs'
import { advanceV2Worker, cleanupFixtureRun, invokePostSemanticAdmin, parseArgs, readFixtureIndexState, searchPost, seedFixtureMember, seedFixtureRun } from './verify-post-rag-smoke.mjs'
import { cleanupSemanticEvaluationFixtures } from './lib/semantic-eval-cleanup.mjs'

const dataset=JSON.parse(readFileSync(new URL('./fixtures/post-semantic-search-eval.json',import.meta.url),'utf8'))
const options=parseArgs(); const runId=process.env.HH_RELEASE_RUN_ID||`semantic-${Date.now().toString(36)}`
const definitions={
  'fixture-thrift-guide':'家庭勤俭持家指南，节约粮食水电，从小培养不浪费习惯。','fixture-family-motto':'朱子治家格言：一粥一饭当思来处不易，半丝半缕恒念物力维艰。',
  'fixture-school-route':'学校北门接送与步行安全路线，避开施工路段和拥堵。','fixture-rainy-pickup':'雨天家长接孩子等待位置与接娃注意事项。',
  'fixture-lost-keys':'花园旁捡到蓝色钥匙扣和一串钥匙，请失主联系。','fixture-lost-card':'小区门禁卡失物招领与归还失主方式。',
  'fixture-garden-service':'周末社区花园志愿服务，公共绿地浇水、共享花圃认领和公益劳动。','fixture-garden-tips':'夏季花草养护知识与月季修剪方法。',
}
let fixtureContext
async function createCommunity(name){const r=await invokePostSemanticAdmin('community.createAdmin',{name,description:'temporary semantic evaluation fixture',coverImage:'',location:{province:'P',city:'C',district:'D',address:'semantic-eval'},joinType:'open'},options);return r.functionResult.communityId}
async function createPost(ctx,alias,text,member=false){const r=await invokePostSemanticAdmin('post.createAdmin',{communityId:ctx.communityId,sectionId:ctx.sectionId,content:{[ctx.titleId]:alias,[ctx.bodyId]:member?'public marker':text,[ctx.memberId]:member?text:''}},options);const id=r.functionResult.postId;if(r.functionResult.auditStatus!=='pass')await invokePostSemanticAdmin('audit.approveAdmin',{postId:id},options);ctx.mapping.set(id,alias);ctx.posts.set(alias,id);return id}
async function poll(probe){const end=Date.now()+60_000;while(Date.now()<end){if(await probe())return;await new Promise(r=>setTimeout(r,1000))}throw new Error('live evaluation freshness timeout')}

const report=await runLiveSemanticEvaluation({cases:dataset,environment:options.envId,runId,latencyRuns:100},{
  createFixtures:async()=>{
    const communityId=await createCommunity(`HH_SEMANTIC_EVAL_${runId}`); fixtureContext={communityId,runIds:[]}; const userId=`${runId}-member`; const guestId=`${runId}-guest`
    await seedFixtureMember(communityId,userId)
    const {memberIdentity,guestIdentity}=createEvaluationIdentities({communityId,runId,memberUserId:userId,guestUserId:guestId,now:Date.now(),secret:options.smokeIdentitySecret})
    fixtureContext.runIds=[memberIdentity.runId,guestIdentity.runId];await seedFixtureRun(memberIdentity);await seedFixtureRun(guestIdentity)
    const s=await invokePostSemanticAdmin('section.create',{communityId,name:'Semantic evaluation',icon:'test',order:0,type:'evergreen'},options);const sectionId=s.functionResult.sectionId
    const w=await invokePostSemanticAdmin('section.updateWidgets',{communityId,sectionId,widgets:[{type:'short_text',label:'标题',fieldKey:'title',required:true,showInList:true,order:0,widgetId:''},{type:'rich_text',label:'正文',fieldKey:'body',required:true,showInList:false,order:1,widgetId:''},{type:'short_text',label:'会员专属',fieldKey:'memberNote',required:false,showInList:false,visibility:'member',order:2,widgetId:''}]},options);const widgets=w.functionResult.widgets
    const ctx={communityId,sectionId,titleId:widgets.find(x=>x.fieldKey==='title').widgetId,bodyId:widgets.find(x=>x.fieldKey==='body').widgetId,memberId:widgets.find(x=>x.fieldKey==='memberNote').widgetId,mapping:new Map(),posts:new Map(),memberIdentity,guestIdentity,runIds:[memberIdentity.runId,guestIdentity.runId]}
    for(const [alias,text] of Object.entries(definitions))await createPost(ctx,alias,text)
    ctx.memberOnlyId=await createPost(ctx,'fixture-member-only','会员专属内部互助内容',true)
    ctx.deletedId=await createPost(ctx,'fixture-deleted-post','已经删除的勤俭帖子');await invokePostSemanticAdmin('post.deleteAdmin',{postId:ctx.deletedId},options)
    const crossCommunityId=await createCommunity(`HH_SEMANTIC_CROSS_${runId}`);ctx.crossCommunityId=crossCommunityId;fixtureContext=ctx
    const cs=await invokePostSemanticAdmin('section.create',{communityId:crossCommunityId,name:'Cross community semantic fixture',icon:'test',order:0,type:'evergreen'},options);const crossSectionId=cs.functionResult.sectionId
    const cw=await invokePostSemanticAdmin('section.updateWidgets',{communityId:crossCommunityId,sectionId:crossSectionId,widgets:[{type:'short_text',label:'标题',fieldKey:'title',required:true,showInList:true,order:0,widgetId:''},{type:'rich_text',label:'正文',fieldKey:'body',required:true,showInList:false,order:1,widgetId:''}]},options);const crossWidgets=cw.functionResult.widgets
    const cp=await invokePostSemanticAdmin('post.createAdmin',{communityId:crossCommunityId,sectionId:crossSectionId,content:{[crossWidgets.find(x=>x.fieldKey==='title').widgetId]:'fixture-cross-community',[crossWidgets.find(x=>x.fieldKey==='body').widgetId]:'跨社区勤俭持家内容不应泄漏'}},options);ctx.crossPostId=cp.functionResult.postId;ctx.mapping.set(ctx.crossPostId,'fixture-cross-community')
    if(cp.functionResult.auditStatus!=='pass')await invokePostSemanticAdmin('audit.approveAdmin',{postId:ctx.crossPostId},options)
    for(const id of [...ctx.posts.values(),ctx.crossPostId])await advanceV2Worker(options,id)
    fixtureContext=ctx;return ctx
  },
  verifyFreshness:async(ctx)=>{const id=ctx.posts.get('fixture-thrift-guide');await poll(async()=>{await advanceV2Worker(options,id);return (await readFixtureIndexState(id))?.state==='active'});const initial=await readFixtureIndexState(id);const updated=await invokePostSemanticAdmin('post.updateAdmin',{postId:id,content:{[ctx.titleId]:'fixture-thrift-guide',[ctx.bodyId]:`${definitions['fixture-thrift-guide']} 循环利用旧物。`,[ctx.memberId]:''}},options);if(updated.functionResult.auditStatus!=='pass')await invokePostSemanticAdmin('audit.approveAdmin',{postId:id},options);await poll(async()=>{await advanceV2Worker(options,id);const s=await readFixtureIndexState(id);return s?.state==='active'&&s.sourceVersion!==initial.sourceVersion});await poll(async()=>{await advanceV2Worker(options,ctx.deletedId);return (await readFixtureIndexState(ctx.deletedId))?.state==='removed'});return{initialSourceVersion:initial.sourceVersion,updatedSourceVersion:(await readFixtureIndexState(id)).sourceVersion,deleteState:'removed'}},
  verifyPermissions:async(ctx)=>{const member=await searchPost(options,ctx.communityId,'会员专属内部互助内容',ctx.memberIdentity);const guest=await searchPost(options,ctx.communityId,'会员专属内部互助内容',ctx.guestIdentity);return{memberHit:(member.items||[]).some(x=>x.postId===ctx.memberOnlyId),guestLeak:(guest.items||[]).some(x=>x.postId===ctx.memberOnlyId)}},
  search:async(item,sample)=>{const start=Date.now();const result=await searchPost(options,fixtureContext.communityId,item.query,fixtureContext.guestIdentity);return{durationMs:Date.now()-start,items:result.items||[],cacheClass:sample.cacheClass}},
  writeEvidence:async(e)=>{const dir=resolve('.codex-local','release-evidence',runId);mkdirSync(dir,{recursive:true});const path=resolve(dir,'post-semantic-eval.json');writeFileSync(path,JSON.stringify(e,null,2));return path},
  cleanup:async(ctx)=>{ctx ||= fixtureContext;if(!ctx)return;await cleanupSemanticEvaluationFixtures({runIds:ctx.runIds||[],communityIds:[ctx.communityId,ctx.crossCommunityId].filter(Boolean)},{cleanupRun:cleanupFixtureRun,disable:id=>invokePostSemanticAdmin('community.disable',{communityId:id},options),hardDelete:id=>invokePostSemanticAdmin('community.hardDelete',{communityId:id},options)})},
})
console.log(`[post-semantic-eval] evidence=${report.evidencePath} recallAt5=${report.recallAt5.toFixed(3)} top3Precision=${report.top3Precision.toFixed(3)} p95Ms=${report.p95Ms} errorRate=${report.errorRate.toFixed(3)} forbidden=${report.forbiddenCount}`)
if(!report.passed)process.exitCode=1
