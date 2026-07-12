#!/usr/bin/env node
import{invokeAdmin,parseRebuildArgs}from'./rebuild-post-search-index.mjs';import{DEFAULT_ENV_ID,defaultRunner}from'./cloud-release-smoke.mjs'
import{advanceProbeTimerEvidence}from'./lib/post-rag-timer-evidence.mjs'
const startedAt=new Date().toISOString(),base=parseRebuildArgs([],process.env);const options={...base,envId:process.env.TCB_ENV||DEFAULT_ENV_ID,commandTimeoutMs:180000,adminInvokeRetries:3},runId=String(process.env.HH_RELEASE_RUN_ID||Date.now())
if(!options.adminInternalToken)throw new Error('ADMIN_INTERNAL_CALL_TOKEN is required')
let evidence=null,probe=null,probeEvidence={probeOutboxSeen:false,probeV2JobSeen:false}
try{probe=(await invokeAdmin('post.ragTimerProbeCreateAdmin',{runId},options,defaultRunner)).functionResult
for(let attempt=0;attempt<20;attempt++){const [e,s]=await Promise.all([invokeAdmin('post.ragTimerEvidenceAdmin',{},options,defaultRunner),invokeAdmin('post.ragTimerProbeStatusAdmin',{outboxId:probe.outboxId,postId:probe.postId},options,defaultRunner)]);evidence=e.functionResult?.evidence;const status=s.functionResult;probeEvidence=advanceProbeTimerEvidence(probeEvidence,evidence,{startedAt,outboxId:probe.outboxId,jobId:status?.job?._id});if(probeEvidence.probeOutboxSeen&&probeEvidence.probeV2JobSeen&&status?.complete)break;await new Promise(resolve=>setTimeout(resolve,5000))}
const status=(await invokeAdmin('post.ragTimerProbeStatusAdmin',{outboxId:probe.outboxId,postId:probe.postId},options,defaultRunner)).functionResult
if(!probeEvidence.probeOutboxSeen||!probeEvidence.probeV2JobSeen||!status?.complete)throw new Error('fresh authenticated timer did not complete the unique V2 probe')
console.log(`[post-rag-timer] verified runId=${runId} trigger=${evidence.triggerName} postId=${probe.postId}`)
}finally{if(probe)await invokeAdmin('post.ragTimerProbeCleanupAdmin',{communityId:probe.communityId,sectionId:probe.sectionId,postId:probe.postId},options,defaultRunner)}
