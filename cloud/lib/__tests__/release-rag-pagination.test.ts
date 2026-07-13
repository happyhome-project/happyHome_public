import { listReleaseRagPage } from '../release-rag-pagination'

test.each([['communities',{status:'active'}],['sections',{communityId:'c1'}]])('%s enumeration advances beyond 100 with stable id cursor',async(collection,where)=>{
  const all=Array.from({length:125},(_,i)=>({_id:`id-${String(i+1).padStart(3,'0')}`,...where})); const calls:any[]=[]
  const deps={queryAfterId:async(_c:string,_w:any,after:string|null,limit:number)=>{calls.push(after);return all.filter(x=>!after||x._id>after).slice(0,limit)}}
  const first=await listReleaseRagPage(collection,where,'',100,deps); const second=await listReleaseRagPage(collection,where,first.nextAfterId,100,deps)
  expect([...first.items,...second.items]).toHaveLength(125);expect(first.hasMore).toBe(true);expect(second.hasMore).toBe(false);expect(calls).toEqual([null,'id-100'])
})
