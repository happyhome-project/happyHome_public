# 帖子正式 RAG 搜索服务

本文档记录 HappyHome 帖子搜索的正式 RAG 实现。当前方案不使用 ADP Agentic RAG，也不使用旧 RAG 套件；云函数负责权限、异步同步、证据约束和返回结构，正式检索/生成主路径由腾讯 ES 智能搜索开发提供。

## 分层

源数据层：

- `posts`：帖子正文、视频名、音频名、图文笔记、地点等 widget 内容。
- `sections`：板块名称、字段配置和字段标签。
- CloudBase 仍是业务源数据，不把 ES 当业务主库。

异步同步层：

- `post_rag_jobs`：发帖、改帖、审核、删除、板块字段变化产生的 RAG 索引任务。
- `post_rag_index_state`：每篇帖子在正式 RAG 索引里的 indexed/removed/failed 状态。
- `post-rag-worker` 云函数：分批处理 pending job。
- `post_video_rag_jobs`：低文本信号视频的可选分析任务，按成本策略排队。
- `post_video_rag_assets`：视频 ASR/OCR/关键帧摘要缓存，按 `cacheKey` 复用，避免重复付费分析。
- `post-video-rag-worker` 云函数：分批处理视频分析 job，完成后重新排帖子 RAG upsert。

检索层：

- `TencentRagProvider` 是 provider 接口，正式主路径是腾讯 ES 智能搜索开发：
  - `TENCENT_RAG_PROVIDER=es` 或未配置 provider：ES embedding + `retriever.rank_fusion` hybrid search + rerank + LLM answer。
  - `TENCENT_RAG_PROVIDER=lkeap-cloudbase`：仅作显式调试/旧路径，LKEAP embedding + CloudBase `post_rag_chunks` chunk mirror + LKEAP rerank + LKEAP LLM answer。
- index 文档粒度是 chunk，不是整篇帖子。
- chunk metadata 固定包含：`communityId`、`sectionId`、`postId`、`chunkId`、`fieldType`、`fieldLabel`、`sourceUpdatedAt`、`visibility`。
- 运行时必须有 ES index endpoint/用户名/密码；模型服务默认走腾讯 ES 智能搜索原子 API（Embedding、Rerank、LLM），也兼容已经创建好的 ES inference endpoint。

ES 智能搜索主路径：

- 每个 chunk 写入 ES index，字段包括正文文本、preview、标题、字段标签、板块名、权限 metadata 和 dense vector。
- 查询时先对扩展后的 query 做 embedding，再用 `retriever.rank_fusion` 同时召回全文匹配和向量匹配候选。
- 社区、板块和 `visibility` 过滤在全文 retriever 与 knn retriever 两侧同时生效。
- rerank 后先过滤弱证据；没有合格 citation 时返回 `mode=no_answer`，不调用 LLM、不展示无关帖子作为答案证据。
- 只有有合格 citations 时才调用 LLM answer，prompt 中只包含这些已授权、已过滤的片段。

腾讯 ES 智能搜索原子能力：

- 2026-07-04 已开通 ES 智能搜索开发原子服务后付费。
- `GetTextEmbedding`、`RunRerank`、`ChatCompletions` 已用真实 API 连通验证；`verify:tencent-rag -- --models-only` 可只验证这三项。
- `ChatCompletions` 原子 API 不接受 `MaxTokens` 参数；输出长度靠 prompt 约束，不能把 OpenAI/LKEAP 参数照搬过去。
- 正式主路径仍然必须有 ES 混合搜索索引；原子 API 只负责模型调用，不承担持久化检索索引。

LKEAP 原子能力旧路径：

- 2026-06-25 已开通知识引擎原子能力后付费，并创建子用户 `happyhome_rag`。
- 子用户已绑定预设策略 `QcloudLKEAPFullAccess`，本地密钥文件位于仓库外 `~/.happyhome/tencent-lkeap.env`。
- `GetEmbedding`、`RunRerank`、`ChatCompletions` 已用真实 API 连通验证。
- LKEAP 本身不是持久化向量数据库；`lkeap-cloudbase` provider 用 CloudBase 的 `post_rag_chunks` 保存 chunk 与 embedding，只能作为显式调试/旧路径，不能作为正式主检索。
- 云函数环境中可能存在 CloudBase 注入的 `TENCENTCLOUD_SECRETID`；LKEAP provider 必须优先读取显式配置的 `TENCENT_LKEAP_SECRET_ID/KEY`，否则 worker 会拿错密钥并返回 `AuthFailure.SecretIdNotFound`。
- 生产环境不应配置 `TENCENT_RAG_PROVIDER=lkeap`。旧值会被视为无效旧配置，正式 provider 仍走 ES。

视频 RAG：

- `post-rag-worker` 会把每个视频的标题、描述、hint、文件名、封面、时长写成免费 metadata chunk，因此“某个视频名”不需要先跑高成本视频理解。
- 只有低文本信号、未命中缓存、COS 可访问的视频，才会在 `POST_VIDEO_RAG_ANALYSIS_ENABLED=true` 时写入 `post_video_rag_jobs`。
- `post-video-rag-worker` 优先使用腾讯云 ASR 做音频转写：配置 `POST_VIDEO_RAG_ASR_SECRET_ID/KEY` 后，先调用 `CreateRecTask` 创建异步识别任务，把 job 置为 `processing`；后续轮询 `DescribeTaskStatus` 成功后写入 `asrTranscript`，再排 `rag.video.analysis.ready` 的帖子 RAG upsert。
- 未配置 ASR 时，可选使用 `POST_VIDEO_RAG_TOKENHUB_API_KEY` 走 TokenHub 多模态视频理解；再未配置时可接 `POST_VIDEO_RAG_ANALYZER_URL` 外部分析器。三者都没有时明确失败，不隐式调用付费服务。
- 成本控制靠环境变量：每帖 job 数、单视频 ASR 秒数、关键帧数、估算 cost units 都有上限。显式配置可覆盖到 60 分钟音频，例如 `POST_VIDEO_RAG_MAX_ASR_SECONDS_PER_VIDEO=3600`、`POST_VIDEO_RAG_MAX_COST_UNITS_PER_POST=120`、`POST_VIDEO_RAG_MAX_FRAMES_PER_VIDEO=0`。

降级层：

- 旧 `post_search_*` 倒排/本地稀疏向量索引只作为 fallback。
- provider 未配置或腾讯服务失败时，`post.search` 返回 `mode=fallback`，不生成 AI 回答。

## 动态更新

业务写入不直接同步 ES。所有动态变化先写 job，再由 worker 异步处理。

已接入入口：

- 用户发帖/改帖：审核后由 `auditAndApply` 排 RAG job。
- 管理后台发帖/改帖：复用 `auditAndApply` 排 RAG job。
- 审核通过：排 `upsert` job。
- 审核不通过：初始内容排 `delete` job；pending 编辑被拒不删除旧内容索引。
- 帖子删除：排 `delete` job，并清理 fallback 索引。
- 板块名称、字段变化：按板块给 active posts 排 `upsert` job；纯新增空字段不扫描历史帖。
- 社区硬删除：给社区下帖子排 `delete` job，并清理 fallback 索引。
- 周期性/手动 reconcile：按社区扫描 `posts` 与 `post_rag_index_state`，只给缺失、过期、应删除的帖子排 job，避免所有历史帖反复付费重建。

worker 处理 `upsert` 时会先删除该 post 在 ES 中的旧 chunks，再写当前 chunks，避免旧正文、旧视频名继续被搜到。

历史帖子不会自动拥有 RAG job。上线或大改字段后可以先跑只读健康检查，再优先用 reconcile 补缺失/过期索引；只有索引结构大改或需要强制重建时，才运行全量回填脚本把现有帖子全部重新排入 `post_rag_jobs`。

## Search API

`post.search` 返回正式 RAG 结构：

```ts
{
  answer: string
  citations: Array<{
    postId: string
    chunkId: string
    title: string
    fieldLabel: string
    fieldType: string
    preview: string
    score: number
  }>
  items: Array<{ postId: string; title: string; matchedFields: Array<any> }>
  mode: 'rag' | 'fallback' | 'no_answer'
}
```

权限边界：

- 云函数先用 `ensureCommunityReadable` 校验社区读取权限。
- 只有通过权限校验后的 `communityId/sectionId` 会传给 provider。
- LLM answer 只能使用 provider 返回的已过滤 citations。
- 没有 citations 时返回 `mode=no_answer`，不能编造确定性答案。

## Query Understanding

`buildRagQuery` 会对“有没有讲节俭家风的帖子？”这类问题做 query expansion：

- `节俭`
- `勤俭`
- `节约`
- `家风`
- `家训`
- `朱子治家格言`
- `一粥一饭`
- `半丝半缕`
- `物力维艰`

这些词只用于扩大召回，最终排序以腾讯 rerank 结果为准，不靠手写关键词决定答案。

## 环境变量

这些值只能放在服务器安全位置或云函数环境变量，不能进 git：

```text
TENCENT_RAG_PROVIDER=es
TENCENT_RAG_ES_ENDPOINT=
TENCENT_RAG_ES_USERNAME=
TENCENT_RAG_ES_PASSWORD=
TENCENT_RAG_INDEX_NAME=happyhome_post_rag_chunks
TENCENT_RAG_VECTOR_FIELD=embedding
# 默认模型服务：腾讯 ES 智能搜索原子 API
TENCENT_RAG_ATOMIC_SECRET_ID=
TENCENT_RAG_ATOMIC_SECRET_KEY=
TENCENT_RAG_ATOMIC_REGION=ap-beijing
TENCENT_RAG_EMBEDDING_MODEL=bge-base-zh-v1.5
TENCENT_RAG_RERANK_MODEL=bge-reranker-large
TENCENT_RAG_LLM_MODEL=deepseek-v3
# 可选兼容：已经在 ES 内创建好的 inference endpoint
TENCENT_RAG_EMBEDDING_INFERENCE_ID=
TENCENT_RAG_RERANK_INFERENCE_ID=
TENCENT_RAG_LLM_INFERENCE_ID=
```

视频音频优先分析可选配置：

```text
POST_VIDEO_RAG_ANALYSIS_ENABLED=true
POST_VIDEO_RAG_ASR_SECRET_ID=
POST_VIDEO_RAG_ASR_SECRET_KEY=
POST_VIDEO_RAG_ASR_REGION=ap-guangzhou
POST_VIDEO_RAG_ASR_ENGINE_MODEL_TYPE=16k_zh
POST_VIDEO_RAG_MAX_JOBS_PER_POST=1
POST_VIDEO_RAG_MAX_FRAMES_PER_VIDEO=0
POST_VIDEO_RAG_MAX_ASR_SECONDS_PER_VIDEO=3600
POST_VIDEO_RAG_MAX_COST_UNITS_PER_POST=120
```

多模态视频理解可选配置：

```text
POST_VIDEO_RAG_TOKENHUB_API_KEY=
POST_VIDEO_RAG_TOKENHUB_MODEL=youtu-vita
POST_VIDEO_RAG_TOKENHUB_BASE_URL=https://tokenhub.tencentmaas.com/v1
```

显式旧路径可选配置：

```text
TENCENT_RAG_PROVIDER=lkeap-cloudbase
TENCENT_LKEAP_SECRET_ID=
TENCENT_LKEAP_SECRET_KEY=
TENCENT_LKEAP_REGION=ap-guangzhou
TENCENT_LKEAP_EMBEDDING_MODEL=lke-text-embedding-v2
TENCENT_LKEAP_RERANK_MODEL=lke-reranker-base
TENCENT_LKEAP_CHAT_MODEL=deepseek-v3-0324
```

腾讯云 CAM `secret_id/secret_key` 不写进仓库，也不能进前端包。正式 ES provider 的运行时只需要 ES endpoint、ES 用户名/密码和 inference id；如果需要创建或更新 inference endpoint，按腾讯 ES Inference API 文档在 Kibana/ES API 中配置到 endpoint 的 `service_settings`。

本地验证可放在仓库外：

```text
~/.happyhome/tencent-rag.env
~/.happyhome/tencent-lkeap.env
```

## 运维命令

补齐 CloudBase 集合和索引：

```powershell
npm.cmd run ensure:indexes
```

创建腾讯 ES chunk index mapping：

```powershell
npm.cmd run ensure:tencent-rag-index
```

将直接访问 ES 索引的云函数接入 ES 所在 VPC/子网；CloudBase 继续只负责业务数据和 job/state：

```powershell
npm.cmd run configure:rag-network -- --vpc-id <vpcId> --subnet-id <subnetId>
```

如果 ES 仅开放私网访问，本地机器通常不能直连 ES endpoint；此时应在云函数环境变量和 VPC 配置完成后，通过已授权的 `post-rag-worker` 在云端初始化索引：

```ts
// 调用云函数 post-rag-worker
{ "action": "ensureIndex", "workerToken": "<POST_RAG_WORKER_TOKEN>" }
```

验证腾讯 ES 智能搜索模型服务连通性。完整验证要求 ES index endpoint 已配置；如果只想先验证腾讯原子 API 三件套：

```powershell
npm.cmd run verify:tencent-rag
npm.cmd run verify:tencent-rag -- --models-only
```

验证腾讯 LKEAP 原子能力连通性：

```powershell
npm.cmd run verify:tencent-lkeap
```

回填历史帖子 RAG jobs，并默认驱动 worker 处理队列：

```powershell
npm.cmd run rebuild:post-rag-index -- --all-active
npm.cmd run rebuild:post-rag-index -- --community-id <communityId>
```

只读检查各社区 RAG 覆盖率和 job 积压，不排队、不调用 worker：

```powershell
npm.cmd run rebuild:post-rag-index -- --all-active --health
npm.cmd run rebuild:post-rag-index -- --community-id <communityId> --health
```

按 `post_rag_index_state` 补偿缺失、过期和应删除的索引，并默认驱动 worker 处理队列：

```powershell
npm.cmd run rebuild:post-rag-index -- --all-active --reconcile
npm.cmd run rebuild:post-rag-index -- --community-id <communityId> --reconcile
```

只入队不处理：

```powershell
npm.cmd run rebuild:post-rag-index -- --community-id <communityId> --no-process
```

真实临时 fixture 验证核心 RAG 查询，脚本会创建临时社区/板块/帖子、定向执行 `post-rag-worker`、通过 `http-gateway` 查询、最后 hardDelete 清理：

```powershell
npm.cmd run verify:post-rag-smoke
```

手动触发一批 RAG job：

```ts
// 调用云函数 post-rag-worker
{ "limit": 5 }
```

定向处理某篇帖子的 pending jobs：

```ts
{ "limit": 20, "postId": "<postId>" }
```

手动触发视频分析 job：

```ts
// 调用云函数 post-video-rag-worker
{ "limit": 3 }
```

旧 fallback 索引回填仍保留：

```powershell
npm.cmd run rebuild:post-search-index -- --all-active
```

## 验收查询

必须支持：

- `有没有讲节俭家风的帖子？`
- `勤俭持家`
- `一粥一饭当思来处不易`
- 某个视频名

预期：

- 有证据时返回 `mode=rag`、`answer`、`citations`、可跳转 `items`。
- 没有足够证据时返回 `mode=no_answer`，小程序搜索页不能再用本地 `bootstrap` 快照混入非 RAG 结果。
- 腾讯服务不可用时返回 `mode=fallback`，不显示 AI answer。

2026-06-25 云端真实 smoke 结果：

- `npm.cmd run verify:post-rag-smoke` 通过。
- 验收问题 `有没有讲节俭家风的帖子？` 返回 `mode=rag`，answer 包含《朱子治家格言》和“一粥一饭，当思来处不易；半丝半缕，恒念物力维艰”，`citations=2`，`items=1`。
- 原句查询 `一粥一饭当思来处不易` 命中同一临时帖子。
- 临时社区已 hardDelete，删除 job 已由 worker 清理。

2026-06-30 本地新增验收：

- `verify:post-rag-smoke` 已加入 `勤俭持家` 查询，必须命中同一临时帖子。
- `test:mp:post-rag-search-static` 会验证小程序首页搜索入口、搜索页输入框、`postApi.search`、AI 回答、引用卡片和帖子跳转结构。
- 视频分析 worker 支持 ASR 异步任务的 `pending -> processing -> completed` 状态流；ASR 未完成前不会提前写资产或重建帖子索引。

2026-07-04 ES hybrid 主路径迁移本地验收：

- `createTencentRagProviderFromEnv` 已改为默认/旧 `lkeap` 值都走 ES provider；只有显式 `lkeap-cloudbase` 才进入旧 CloudBase chunk 扫描路径。
- ES provider 单测会校验 `_search` 请求使用 `retriever.rank_fusion`，而不是顶层 `query + knn`。
- ES provider 单测会校验 rerank 后过滤弱证据；低分噪声不能触发 LLM，也不能作为 RAG items 返回。
- 小程序静态测试会校验搜索页不再把 `mode=no_answer` 降级成本地 bootstrap 搜索结果，避免无证据帖子被误看成 RAG 命中。
- 新增社区级 reconcile 和 health admin action：`post.reconcileRagIndexCommunityBatchAdmin` 只给缺失/过期/应删除帖子排 job，`post.ragIndexHealthAdmin` 返回 source/state/job 覆盖率计数。
- `update:rag-env` 已改为写入 `TENCENT_RAG_PROVIDER=es` 和 ES endpoint/credential/inference ids。
- 本次迁移尚未声称云端 ES index 已完成全量回填；上线后仍需运行 `update:rag-env`、`ensure:tencent-rag-index`、`rebuild:post-rag-index -- --all-active --health`、`rebuild:post-rag-index -- --all-active --reconcile`，再跑真实 smoke。

当前未完成的真实验收：

- “某个视频名”字段级真实 smoke 暂未纳入默认脚本。原因不是 RAG chunk 提取缺失，`video_group` 的 `title/hint` 已进入 chunk；实际阻塞是视频字段会触发腾讯内容审核 `review`，再走 `audit.approveAdmin` 时旧 fallback 全文索引刷新在 15s 云函数超时内可能写不完。后续要么把旧全文索引刷新异步化，要么提高 admin 函数超时，再把视频字段加入真实 smoke。
