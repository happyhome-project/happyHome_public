import { getPostRagV2Health } from '../post-rag-v2-health'

function rows(prefix:string,count:number,extra:Record<string,any>={}) { return Array.from({length:count},(_,i)=>({_id:`${prefix}-${String(i+1).padStart(3,'0')}`,...extra})) }

test('v2 health paginates beyond 100 and proves exact current source versions', async()=>{
  const sections=rows('section',2,{communityId:'c1',status:'active',widgets:[]})
  const posts=rows('post',125,{communityId:'c1',sectionId:'section-001',status:'active',auditStatus:'pass',content:{},updatedAt:'2026-07-13T00:00:00.000Z'})
  const states=posts.map(post=>({_id:post._id,postId:post._id,schemaVersion:2,state:'active',sourceVersion:`source-${post._id}`}))
  const jobs=[{_id:'j1',communityId:'c1',schemaVersion:2,status:'completed'},{_id:'j2',communityId:'c1',schemaVersion:2,status:'pending'}]
  const collections:any={sections,posts,post_rag_jobs:jobs}
  const pageCalls:string[]=[]
  const result=await getPostRagV2Health('c1',{
    queryAfterId:async(name,where,afterId,limit)=>{pageCalls.push(`${name}:${afterId||''}`);return collections[name].filter((x:any)=>Object.entries(where).every(([k,v])=>x[k]===v)&&(!afterId||x._id>afterId)).slice(0,limit)},
    getByIds:async(_name,ids)=>states.filter(x=>ids.includes(x._id)),
    buildProjection:(post:any)=>({eligible:true,sourceVersion:`source-${post._id}`}),
  })
  expect(result).toMatchObject({eligibleActivePostCount:125,exactSourceVersionCount:125,missingExactSourceVersionCount:0,pendingJobCount:1,processingJobCount:0,retryJobCount:0,failedJobCount:0,coverageRatio:1})
  expect(pageCalls.filter(x=>x.startsWith('posts:')).length).toBe(2)
})

test('v2 health distinguishes missing stale and failed work',async()=>{
  const sections=[{_id:'s1',communityId:'c1',status:'active',widgets:[]}]
  const posts=[{_id:'p1',communityId:'c1',sectionId:'s1'},{_id:'p2',communityId:'c1',sectionId:'s1'}]
  const states=[{_id:'p1',schemaVersion:2,state:'active',sourceVersion:'old'}]
  const jobs=[{_id:'j1',communityId:'c1',schemaVersion:2,status:'retry'},{_id:'j2',communityId:'c1',schemaVersion:2,status:'processing'},{_id:'j3',communityId:'c1',schemaVersion:2,status:'failed'}]
  const collections:any={sections,posts,post_rag_jobs:jobs}
  const result=await getPostRagV2Health('c1',{queryAfterId:async(name,where,afterId,limit)=>collections[name].filter((x:any)=>Object.entries(where).every(([k,v])=>x[k]===v)&&(!afterId||x._id>afterId)).slice(0,limit),getByIds:async()=>states,buildProjection:(post:any)=>({eligible:true,sourceVersion:`new-${post._id}`})})
  expect(result).toMatchObject({eligibleActivePostCount:2,exactSourceVersionCount:0,missingExactSourceVersionCount:2,missingStateCount:1,staleSourceVersionCount:1,retryJobCount:1,processingJobCount:1,failedJobCount:1,coverageRatio:0})
})
