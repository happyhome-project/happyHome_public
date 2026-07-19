# 帖子正式 RAG

正式路径是按实际调用付费的 RAG：CloudBase 保存业务数据、同步状态、chunk 和向量；腾讯原子 Embedding、Rerank、LLM 只在索引或查询时调用。系统不依赖 ADP，也不依赖按小时收费的 ES 集群。

## 数据边界

CloudBase 的当前业务数据是唯一事实来源。社区必须显式设置 `ragIndexPolicy`：

- `business`：正式业务数据，可进入普通用户检索。
- `validation`：隔离的 RAG 验证数据，只能由签名 smoke 身份检索。
- `excluded`：测试或非业务数据，必须清出索引。
- 未设置策略：按 `excluded` 处理，直到发布后人工分类。

任何带 `fixtureKey` 的社区或帖子都会失败关闭，即使策略被误设为 `business` 也不能进入正式索引。帖子年龄不参与资格判断；旧帖子只要属于已分类业务社区且仍是当前有效内容，就可以被 reconcile。

## 当前状态同步

每篇帖子只有一条 `post_rag_sync_state/<postId>`。发帖、改帖、审核、删除、板块变化和社区状态变化只提高 `desiredRevision`，不会追加历史任务。连续修改会合并成一条待处理状态。

`post-rag-worker` 获得短租约后重新读取当前 `posts`、`communities`、板块或协作模板；它不相信调度时的内容，也不相信历史的 upsert/delete 动作。worker 根据当前数据决定索引或清理：

- 当前数据有效：生成带 `sourceVersion` 和 `indexScope` 的 chunk，按帖子替换 `post_rag_chunks`，写 `post_rag_index_state`。
- 帖子缺失、删除、审核不通过、社区未分类/停用、板块停用或 fixture 数据：清理已有 chunk；从未索引过的帖子不调用供应商。
- 外部调用结束后，只有租约、worker 和 `desiredRevision` 仍完全一致才能标记 `synced`。期间出现新修改时，旧结果不会获准成为当前状态。
- 失败只保存有限错误码，按有界退避重试，达到上限进入 `dead_letter`；不保存原始异常或密钥。

可选视频分析仍使用 `post_video_rag_jobs` 和 `post_video_rag_assets`。默认先索引视频标题、描述和文件名；只有明确启用成本策略时才运行 ASR/OCR/视频理解，分析完成后重新调度父帖子当前状态。

## 检索闸门

`post.search` 调用 `tencent-cloudbase-atomic`，返回真实 `answer`、`citations` 和 `items`。候选证据返回前必须同时满足：

- 请求社区处于 active，策略与请求 scope 一致且不是 fixture；
- 当前帖子 active、审核通过、社区一致且不是 fixture；
- 当前板块 active；
- chunk、`post_rag_sync_state`、`post_rag_index_state` 的 `sourceVersion` 和 `indexScope` 完全一致；
- 同步状态为 `synced`，索引状态为 `indexed`，帖子更新时间与证据一致；
- 当前查看者有权查看 member-only 字段。

任一条件不满足就丢弃证据。供应商不可用时返回 `mode=fallback` 且不拿普通关键词结果冒充 RAG；没有合格证据时返回 `mode=no_answer`。

## 发布与发布后启用

正式发布只负责上传代码、worker 配置、环境变量和通用数据库索引。发布流程禁止运行 RAG timer 证明、历史回填、RAG smoke、真实检索或语义评测。

发布完成后由 RAG 负责人分步执行，每一步单独确认：

```powershell
# 默认只读：查看所有已分类社区健康状态
npm.cmd run rebuild:post-rag-index

# 首次启用时显式分类；旧的、测试的社区应标为 excluded
npm.cmd run rebuild:post-rag-index -- --classify-community <communityId> --policy business

# 为该社区所有当前帖子生成/覆盖一条同步状态
npm.cmd run rebuild:post-rag-index -- --reconcile --community-id <communityId>

# 单独驱动当前状态 worker
npm.cmd run rebuild:post-rag-index -- --process

# 使用 validation 社区做真实回答与引用闭环，完成后清理 fixture
npm.cmd run verify:post-rag-smoke
```

分类、reconcile 和 process 不能在同一次命令中混用。默认命令是只读健康检查。生产集合或历史索引的物理删除不由发布脚本自动执行；应在新路径稳定、健康检查和 smoke 全部通过后另行审计执行。

## 正式环境变量

正式运行只需要 CloudBase 模式和腾讯原子模型配置：

- `TENCENT_RAG_PROVIDER=cloudbase`
- `TENCENT_RAG_CLOUDBASE_CHUNK_PAGE_SIZE`
- `TENCENT_RAG_CLOUDBASE_MAX_CANDIDATE_CHUNKS`
- `TENCENT_RAG_ATOMIC_SECRET_ID/KEY/REGION`
- `TENCENT_RAG_EMBEDDING_MODEL`
- `TENCENT_RAG_RERANK_MODEL`
- `TENCENT_RAG_LLM_MODEL`
- `POST_RAG_WORKER_TOKEN`、`POST_RAG_TIMER_TOKEN`、`POST_RAG_SMOKE_IDENTITY_SECRET`

`update:rag-env` 会主动移除旧 ES endpoint、用户名、密码、inference id、索引名和向量字段配置。
