import * as db from './db'

const MAX_PAGE=100
export async function listReleaseRagPage(collection:string,where:Record<string,any>,afterId:unknown,limit:unknown,deps:Pick<typeof db,'queryAfterId'>=db) {
  const safeLimit=Math.min(MAX_PAGE,Math.max(1,Math.floor(Number(limit)||MAX_PAGE)))
  const rows=await deps.queryAfterId(collection,where,String(afterId||'')||null,safeLimit)
  return {items:rows,hasMore:rows.length===safeLimit,nextAfterId:rows.length===safeLimit?String(rows[rows.length-1]?._id||''):null}
}
