# 帖子正式 RAG 搜索服务

本文档记录 HappyHome 帖子搜索的正式 RAG 实现。当前方案不使用 ADP Agentic RAG，也不使用常驻腾讯 ES 集群；CloudBase 保存 chunk 与向量，腾讯原子 Embedding、Rerank、LLM 只在索引或查询时调用，云函数负责权限、异步同步、证据约束和返回结构。

## 分层

源数据层：

- `posts`：帖子正文、视频名、音频名、图文笔记、地点等 widget 内容。
- `sections`：板块名称、字段配置和字段标签。
- CloudBase 仍是业务源数据，不把 ES 当业务主库。

异步同步层：

- `post_rag_jobs`：发帖、改帖、审核、删除、板块字段变化产生的 RAG 索引任务。
- `post_rag_index_state`：每篇帖子在正式 RAG 索引里的 indexed/removed/failed 状态。
- `post_rag_worker_state`：`post-rag-worker` 最近一次运行状态、成功/失败计数和错误摘要。
- `post-rag-worker` 云函数：分批处理 pending job。
- `post_video_rag_jobs`：低文本信号视频的可选分析任务，按成本策略排队。
- `post_video_rag_assets`：视频 ASR/OCR/关键帧摘要缓存，按 `cacheKey` 复用，避免重复付费分析。
- `post-video-rag-worker` 云函数：分批处理视频分析 job，完成后重新排帖子 RAG upsert。

检索层：

- `TencentRagProvider` 是 provider 接口，正式主路径是 `tencent-cloudbase-atomic`：
  - `TENCENT_RAG_PROVIDER=cloudbase`：CloudBase `post_rag_chunks` 保存 chunk/embedding；云函数做权限过滤后的词面+余弦候选召回，腾讯原子 API 做 embedding、rerank、LLM answer。
- index 文档粒度是 chunk，不是整篇帖子。
- chunk metadata 固定包含：`communityId`、`sectionId`、`postId`、`chunkId`、`fieldType`、`fieldLabel`、`sourceUpdatedAt`、`visibility`。
- 运行时不需要 ES endpoint、用户名或密码；只需要腾讯原子 API 凭据与模型名。

已退役的 ES 主路径：

- ES 不再是 HappyHome 正式 RAG 的运行时依赖，也不应恢复或新建按小时收费的集群。
- 历史 ES endpoint、用户名、密码和 inference id 已从 RAG 云函数环境清除；旧 ES 文档和脚本只可用于历史排障，不能作为上线步骤。

腾讯 ES 智能搜索原子能力：

- 2026-07-04 已开通 ES 智能搜索开发原子服务后付费。
- `GetTextEmbedding`、`RunRerank`、`ChatCompletions` 已用真实 API 连通验证；`verify:tencent-rag -- --models-only` 可只验证这三项。
- `ChatCompletions` 原子 API 不接受 `MaxTokens` 参数；输出长度靠 prompt 约束，不能把 OpenAI/LKEAP 参数照搬过去。
- 正式主路径由 CloudBase 持久化 chunk/embedding，原子 API 只负责 embedding、rerank 和答案生成；没有常驻检索集群费用。

LKEAP 旧路径：

- 2026-06-25 已开通知识引擎原子能力后付费，并创建子用户 `happyhome_rag`。
- 子用户已绑定预设策略 `QcloudLKEAPFullAccess`，本地密钥文件位于仓库外 `~/.happyhome/tencent-lkeap.env`。
- `GetEmbedding`、`RunRerank`、`ChatCompletions` 已用真实 API 连通验证。
- LKEAP 不属于当前正式检索链路；生产环境不应配置 LKEAP provider 或凭据来替代 `tencent-cloudbase-atomic`。

视频 RAG：

- `post-rag-worker` 会把每个视频的标题、描述、hint、文件名、封面、时长写成免费 metadata chunk，因此“某个视频名”不需要先跑高成本视频理解。
- 只有低文本信号、未命中缓存、COS 可访问的视频，才会在 `POST_VIDEO_RAG_ANALYSIS_ENABLED=true` 时写入 `post_video_rag_jobs`。
- `post-video-rag-worker` 优先使用腾讯云 ASR 做音频转写：配置 `POST_VIDEO_RAG_ASR_SECRET_ID/KEY` 后，先调用 `CreateRecTask` 创建异步识别任务，把 job 置为 `processing`；后续轮询 `DescribeTaskStatus` 成功后写入 `asrTranscript`，再排 `rag.video.analysis.ready` 的帖子 RAG upsert。
- 未配置 ASR 时，可选使用 `POST_VIDEO_RAG_TOKENHUB_API_KEY` 走 TokenHub 多模态视频理解；再未配置时可接 `POST_VIDEO_RAG_ANALYZER_URL` 外部分析器。三者都没有时明确失败，不隐式调用付费服务。
- 成本控制靠环境变量：每帖 job 数、单视频 ASR 秒数、关键帧数、估算 cost units 都有上限。显式配置可覆盖到 60 分钟音频，例如 `POST_VIDEO_RAG_MAX_ASR_SECONDS_PER_VIDEO=3600`、`POST_VIDEO_RAG_MAX_COST_UNITS_PER_POST=120`、`POST_VIDEO_RAG_MAX_FRAMES_PER_VIDEO=0`。

降级层：

- 旧 `post_search_*` 倒排/本地稀疏向量索引只保留为旧搜索/排障/迁移辅助，不作为 `post.search` 的 RAG 主检索。
- provider 未配置或腾讯服务失败时，`post.search` 返回 `mode=fallback`，不生成 AI 回答，也不返回普通搜索 `items/citations` 冒充 RAG 结果。

## 动态更新

业务写入不直接同步检索 chunk。所有动态变化先写 job，再由 worker 异步处理。

已接入入口：

- 用户发帖/改帖：审核后由 `auditAndApply` 排 RAG job。
- 管理后台发帖/改帖：复用 `auditAndApply` 排 RAG job。
- 审核通过：排 `upsert` job。
- 审核不通过：初始内容排 `delete` job；pending 编辑被拒不删除旧内容索引。
- 帖子删除：排 `delete` job，并清理旧搜索索引。
- 板块名称、字段变化：按板块给 active posts 排 `upsert` job；纯新增空字段不扫描历史帖。
- 社区硬删除：给社区下帖子排 `delete` job，并清理旧搜索索引。
- 周期性/手动 reconcile：按社区扫描 `posts` 与 `post_rag_index_state`，只给缺失、过期、应删除的帖子排 job，避免所有历史帖反复付费重建。

worker 处理 `upsert` 时会先删除该 post 在 CloudBase 中的旧 chunks，再写当前 chunks，避免旧正文、旧视频名继续被搜到。

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
TENCENT_RAG_PROVIDER=cloudbase
TENCENT_RAG_CLOUDBASE_CHUNK_PAGE_SIZE=100
TENCENT_RAG_CLOUDBASE_MAX_CANDIDATE_CHUNKS=200
# 腾讯原子 API：按 embedding/rerank/LLM 调用量计费
TENCENT_RAG_ATOMIC_SECRET_ID=
TENCENT_RAG_ATOMIC_SECRET_KEY=
TENCENT_RAG_ATOMIC_REGION=ap-beijing
TENCENT_RAG_EMBEDDING_MODEL=bge-base-zh-v1.5
TENCENT_RAG_RERANK_MODEL=bge-reranker-large
TENCENT_RAG_LLM_MODEL=deepseek-v3
# 只部署到 post 云函数；仓库外 ~/.happyhome/post-rag-smoke.env 自动生成或显式配置
POST_RAG_SMOKE_IDENTITY_SECRET=
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

腾讯云 CAM `secret_id/secret_key`、腾讯原子 API 凭据和 `POST_RAG_SMOKE_IDENTITY_SECRET` 都不写进仓库，也不能进前端包。后者只用于发布后的临时 RAG fixture，不是普通用户身份或通用管理员 token。

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

验证腾讯原子模型服务连通性：

```powershell
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

真实临时 fixture 验证核心 RAG 查询，脚本会创建临时社区/板块/帖子、定向执行 `post-rag-worker`、直接调用 `post.search`，最后 hardDelete 清理：

```powershell
npm.cmd run verify:post-rag-smoke
```

`verify:post-rag-smoke` 不启用生产 `ALLOW_TEST_OPENID`。它会生成 HMAC 签名身份，签名同时绑定 `post.search`、临时 `communityId`、短期 `runId`、用户和 5 分钟过期时间；云函数还会核对 `post_rag_smoke_runs` 中同一 run 的状态与过期时间，再走普通成员权限检查。脚本在成功或失败路径均清理 run 记录和临时社区；任一清理失败都使 smoke 失败。

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

旧搜索索引回填仍保留，仅用于旧搜索排障/迁移辅助，不用于正式 `post.search` RAG 主路径：

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
- 腾讯服务不可用时返回 `mode=fallback`，不显示 AI answer，也不展示普通搜索结果冒充 RAG 命中。

2026-06-25 历史 smoke 结果：

- 当时的 `npm.cmd run verify:post-rag-smoke` 通过，但该结果不能替代当前 pay-per-call provider 的生产验证。
- 验收问题 `有没有讲节俭家风的帖子？` 返回 `mode=rag`，answer 包含《朱子治家格言》和“一粥一饭，当思来处不易；半丝半缕，恒念物力维艰”，`citations=2`，`items=1`。
- 原句查询 `一粥一饭当思来处不易` 命中同一临时帖子。
- 临时社区已 hardDelete，删除 job 已由 worker 清理。

2026-06-30 本地新增验收：

- `verify:post-rag-smoke` 已加入 `勤俭持家` 查询，必须命中同一临时帖子。
- `test:mp:post-rag-search-static` 会验证小程序首页搜索入口、搜索页输入框、`postApi.search`、AI 回答、引用卡片和帖子跳转结构。
- 视频分析 worker 支持 ASR 异步任务的 `pending -> processing -> completed` 状态流；ASR 未完成前不会提前写资产或重建帖子索引。

2026-07-11 当前正式路径与验证状态：

- 正式 provider 是 `TENCENT_RAG_PROVIDER=cloudbase`，CloudBase 保存 chunk/embedding，腾讯原子 API 按调用量执行 embedding、rerank、LLM answer；ES 不在运行路径中。
- 新 smoke 身份不依赖也不打开 `ALLOW_TEST_OPENID`：它需要 HMAC、匹配的 `post_rag_smoke_runs` 记录、同一社区和普通成员权限。
- 此文档随 PR #21 更新时，新的签名 smoke 尚未部署到生产，因此不能报告“当前生产 RAG 验收已通过”。合入后必须执行受控发布、`rebuild:post-rag-index -- --all-active --reconcile`，再运行 `verify:post-rag-smoke`。

当前未完成的真实验收：

- “某个视频名”字段级真实 smoke 暂未纳入默认脚本。`video_group` 的 `title/hint` 已进入 chunk，但视频字段会触发腾讯内容审核；后续需要把视频 fixture 的审核与索引回填闭环稳定下来，再将其加入正式 smoke。
