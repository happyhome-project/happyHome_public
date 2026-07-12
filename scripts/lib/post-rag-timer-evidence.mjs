export function isFreshSuccessfulTimerEvidence(evidence,startedAt){return Boolean(evidence&&evidence.source==='timer'&&evidence.triggerName==='post-rag-worker-every-minute'&&evidence.invokedAt>startedAt&&evidence.v2Attempted===true&&evidence.v2Succeeded===true&&Number(evidence.v2CompletedCount)>0)}

function isFreshTimerEvidence(evidence,startedAt){return Boolean(evidence&&evidence.source==='timer'&&evidence.triggerName==='post-rag-worker-every-minute'&&evidence.invokedAt>startedAt)}

export function advanceProbeTimerEvidence(state,evidence,{startedAt,outboxId,jobId}){
  const next={probeOutboxSeen:Boolean(state?.probeOutboxSeen),probeV2JobSeen:Boolean(state?.probeV2JobSeen),probeOutboxSeenAt:state?.probeOutboxSeenAt||null}
  if(!isFreshTimerEvidence(evidence,startedAt))return next
  if(evidence.outboxIds?.includes(outboxId)){next.probeOutboxSeen=true;next.probeOutboxSeenAt=next.probeOutboxSeenAt||evidence.invokedAt}
  if(next.probeOutboxSeen&&evidence.invokedAt>=next.probeOutboxSeenAt&&jobId&&isFreshSuccessfulTimerEvidence(evidence,startedAt)&&evidence.v2JobIds?.includes(jobId))next.probeV2JobSeen=true
  return next
}
