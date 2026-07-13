export async function cleanupSemanticEvaluationFixtures(input,deps){const errors=[];const attempt=async(kind,id,fn)=>{try{await fn(id)}catch{errors.push(new Error(`${kind} cleanup failed for fixture ${String(id).replace(/[^A-Za-z0-9_-]/g,'').slice(0,40)}`))}}
  for(const id of input.runIds||[])await attempt('identity',id,deps.cleanupRun)
  for(const id of input.communityIds||[]){await attempt('community disable',id,deps.disable);await attempt('community delete',id,deps.hardDelete)}
  if(errors.length)throw new AggregateError(errors,`semantic evaluation cleanup failed (${errors.length} operations)`)
}
