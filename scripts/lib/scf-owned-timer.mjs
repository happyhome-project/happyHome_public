const OWNED=new Set(['post-rag-worker-every-5-min','post-rag-worker-every-minute'])
export async function reconcileOwnedScfTimer(request,{functionName,namespace,cron,customArgument}){
  const list=async()=>{const r=await request('ListTriggers',{FunctionName:functionName,Namespace:namespace});return Array.isArray(r?.Triggers)?r.Triggers:[]}
  const before=await list();const desired=before.filter(x=>x.TriggerName==='post-rag-worker-every-minute'&&x.TriggerDesc===cron&&x.CustomArgument===customArgument)
  const owned=before.filter(x=>OWNED.has(x.TriggerName))
  const keep=desired.length===1&&owned.filter(x=>x.TriggerName==='post-rag-worker-every-minute').length===1
  for(const trigger of owned){if(keep&&trigger===desired[0])continue;await request('DeleteTrigger',{FunctionName:functionName,Namespace:namespace,TriggerName:trigger.TriggerName,Type:'timer'})}
  if(!keep)await request('CreateTrigger',{FunctionName:functionName,Namespace:namespace,TriggerName:'post-rag-worker-every-minute',Type:'timer',TriggerDesc:cron,CustomArgument:customArgument,Enable:'OPEN'})
  const after=await list();const matches=after.filter(x=>x.TriggerName==='post-rag-worker-every-minute'&&x.TriggerDesc===cron&&x.CustomArgument===customArgument)
  if(matches.length!==1||after.some(x=>OWNED.has(x.TriggerName)&&x.TriggerName!=='post-rag-worker-every-minute'))throw new Error('SCF timer verification failed')
  return{triggerName:'post-rag-worker-every-minute',cron,customArgumentHash:await sha256(customArgument)}
}
async function sha256(value){const {createHash}=await import('node:crypto');return createHash('sha256').update(value).digest('hex')}
