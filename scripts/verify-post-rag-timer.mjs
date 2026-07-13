#!/usr/bin/env node
import { runPostRagTimerProbe } from './lib/post-rag-timer-probe-runner.mjs'

const evidence = await runPostRagTimerProbe()
console.log(`[post-rag-timer] verified runId=${evidence.runId} trigger=${evidence.triggerName} postId=${evidence.postId}`)
