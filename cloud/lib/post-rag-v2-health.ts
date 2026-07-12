import * as db from './db'
import { buildPostRagSourceProjection } from './post-rag-indexing'

const PAGE_SIZE = 100
type Dependencies = Pick<typeof db, 'queryAfterId' | 'getByIds'> & { buildProjection: (post:any,section:any)=>{eligible:boolean,sourceVersion:string} }

async function readAll(deps:Dependencies, collection:string, where:Record<string,any>) {
  const rows:any[]=[]; let afterId:string|null=null
  while(true) {
    const page=await deps.queryAfterId(collection,where,afterId,PAGE_SIZE)
    rows.push(...page)
    if(page.length<PAGE_SIZE) break
    const next=String(page[page.length-1]?._id||'')
    if(!next||next===afterId) throw new Error(`${collection} pagination did not advance`)
    afterId=next
  }
  return rows
}

export async function getPostRagV2Health(communityId:string,deps:Dependencies={...db,buildProjection:buildPostRagSourceProjection}) {
  const id=String(communityId||'').trim(); if(!id) throw new Error('communityId is required')
  const [sections,posts,jobs]=await Promise.all([
    readAll(deps,'sections',{communityId:id}),
    readAll(deps,'posts',{communityId:id}),
    readAll(deps,'post_rag_jobs',{communityId:id,schemaVersion:2}),
  ])
  const sectionById=new Map(sections.map((row:any)=>[String(row._id),row]))
  const eligible=posts.map((post:any)=>({post,projection:deps.buildProjection(post,sectionById.get(String(post.sectionId)) as any)})).filter(row=>row.projection.eligible)
  const states:any[]=[]
  for(let offset=0;offset<eligible.length;offset+=PAGE_SIZE) states.push(...await deps.getByIds('post_rag_index_state_v2',eligible.slice(offset,offset+PAGE_SIZE).map(row=>String(row.post._id))))
  const stateById=new Map(states.map((row:any)=>[String(row.postId||row._id),row]))
  let exactSourceVersionCount=0,missingStateCount=0,staleSourceVersionCount=0
  for(const row of eligible) {
    const state:any=stateById.get(String(row.post._id))
    if(!state) missingStateCount+=1
    else if(state.schemaVersion===2&&state.state==='active'&&state.sourceVersion===row.projection.sourceVersion) exactSourceVersionCount+=1
    else staleSourceVersionCount+=1
  }
  const count=(status:string)=>jobs.filter((job:any)=>job.status===status).length
  const eligibleActivePostCount=eligible.length
  const missingExactSourceVersionCount=eligibleActivePostCount-exactSourceVersionCount
  return {communityId:id,schemaVersion:2,sectionCount:sections.length,sourcePostCount:posts.length,eligibleActivePostCount,exactSourceVersionCount,missingExactSourceVersionCount,missingStateCount,staleSourceVersionCount,pendingJobCount:count('pending'),retryJobCount:count('retry'),processingJobCount:count('processing'),failedJobCount:count('failed'),coverageRatio:eligibleActivePostCount?exactSourceVersionCount/eligibleActivePostCount:1}
}
