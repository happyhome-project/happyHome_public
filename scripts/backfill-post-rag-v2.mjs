#!/usr/bin/env node
import fs from 'node:fs/promises'; import path from 'node:path'
import { executePostRagV2Backfill } from './lib/post-rag-v2-backfill.mjs'
import { parseRagRebuildArgs, runPostRagRebuild } from './rebuild-post-rag-index.mjs'

const base=parseRagRebuildArgs(['--all-active','--worker-rounds=1000'])
const runId=String(process.env.HH_RELEASE_RUN_ID||'manual').replace(/[^A-Za-z0-9._-]/g,'_')
const evidencePath=path.resolve('.codex-local','release-evidence',runId,'post-rag-v2-backfill.json')
const evidence=await executePostRagV2Backfill({
  rebuild:async()=>runPostRagRebuild({...base,allActive:true,processJobs:true,health:false,healthV2:false,v2:true,workerStage:'combined'}),
  health:async()=>runPostRagRebuild({...base,allActive:true,processJobs:false,health:false,healthV2:true}),
  wait:async()=>new Promise(resolve=>setTimeout(resolve,3000)),
  recordEvidence:async value=>{await fs.mkdir(path.dirname(evidencePath),{recursive:true});await fs.writeFile(evidencePath,JSON.stringify(value,null,2))},
})
console.log(`[post-rag-v2-backfill] complete covered=${evidence.coveredPostCount} evidence=${evidencePath}`)
