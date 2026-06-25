# 帖子正式 RAG 搜索服务

本文档记录 HappyHome 帖子搜索的正式 RAG 实现。当前方案不使用 ADP Agentic RAG，也不使用旧 RAG 套件；云函数负责权限、异步同步、证据约束和返回结构，检索/生成能力由腾讯云 LKEAP 或腾讯云 ES 智能搜索开发提供。

## 分层

源数据层：

- `posts`：帖子正文、视频名、音频名、图文笔记、地点等 widget 内容。
- `sections`：板块名称、字段配置和字段标签。
- CloudBase 仍是业务源数据，不把 ES 当业务主库。

异步同步层：

- `post_rag_jobs`：发帖、改帖、审核、删除、板块字段变化产生的 RAG 索引任务。
- `post_rag_index_state`：每篇帖子在正式 RAG 索引里的 indexed/removed/failed 状态。
- `post-rag-worker` 云函数：分批处理 pending job。

检索层：

- `TencentRagProvider` 是 provider 接口，当前支持两条实现路径：
  - `TENCENT_RAG_PROVIDER=lkeap`：LKEAP embedding + CloudBase `post_rag_chunks` 持久化向量/chunk mirror + LKEAP rerank + LKEAP LLM answer。
  - 默认 ES provider：腾讯 ES 智能搜索开发 embedding、hybrid search、rerank、LLM answer。
- index 文档粒度是 chunk，不是整篇帖子。
- chunk metadata 固定包含：`communityId`、`sectionId`、`postId`、`chunkId`、`fieldType`、`fieldLabel`、`sourceUpdatedAt`、`visibility`。
- 腾讯云 `secret_id/secret_key` 用于在 ES 中创建 inference endpoint；运行时搜索服务只读取 ES endpoint、ES 用户名/密码和已创建好的 inference id。

LKEAP 原子能力：

- 2026-06-25 已开通知识引擎原子能力后付费，并创建子用户 `happyhome_rag`。
- 子用户已绑定预设策略 `QcloudLKEAPFullAccess`，本地密钥文件位于仓库外 `~/.happyhome/tencent-lkeap.env`。
- `GetEmbedding`、`RunRerank`、`ChatCompletions` 已用真实 API 连通验证。
- LKEAP 本身不是持久化向量数据库；本分支的 `lkeap` provider 用 CloudBase 的 `post_rag_chunks` 保存 chunk 与 embedding，保证不是查询时临时导出数据再分析。
- 云函数环境中可能存在 CloudBase 注入的 `TENCENTCLOUD_SECRETID`；LKEAP provider 必须优先读取显式配置的 `TENCENT_LKEAP_SECRET_ID/KEY`，否则 worker 会拿错密钥并返回 `AuthFailure.SecretIdNotFound`。
- 如果帖子量和并发增长，仍应切换到 ES/等价向量检索服务，避免云函数内扫描过多 chunk。

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

worker 处理 `upsert` 时会先删除该 post 在 ES 中的旧 chunks，再写当前 chunks，避免旧正文、旧视频名继续被搜到。

历史帖子不会自动拥有 RAG job。上线或大改字段后需要运行 RAG 回填脚本，把现有帖子重新排入 `post_rag_jobs`，再由 worker 分批处理。

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
TENCENT_RAG_PROVIDER=lkeap
TENCENT_LKEAP_SECRET_ID=
TENCENT_LKEAP_SECRET_KEY=
TENCENT_LKEAP_REGION=ap-guangzhou
TENCENT_LKEAP_EMBEDDING_MODEL=lke-text-embedding-v2
TENCENT_LKEAP_RERANK_MODEL=lke-reranker-base
TENCENT_LKEAP_CHAT_MODEL=deepseek-v3-0324
```

ES provider 可选配置：

```text
TENCENT_RAG_ES_ENDPOINT=
TENCENT_RAG_ES_USERNAME=
TENCENT_RAG_ES_PASSWORD=
TENCENT_RAG_INDEX_NAME=happyhome_post_rag_chunks
TENCENT_RAG_VECTOR_FIELD=embedding
TENCENT_RAG_EMBEDDING_INFERENCE_ID=
TENCENT_RAG_RERANK_INFERENCE_ID=
TENCENT_RAG_LLM_INFERENCE_ID=
```

腾讯云 CAM `secret_id/secret_key` 不写进仓库，也不能进前端包。LKEAP provider 需要云函数环境变量持有密钥；ES provider 如果需要创建或更新 inference endpoint，按腾讯 ES Inference API 文档在 Kibana/ES API 中配置到 endpoint 的 `service_settings`。

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

验证腾讯 ES inference 三件套连通性：

```powershell
npm.cmd run verify:tencent-rag
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

旧 fallback 索引回填仍保留：

```powershell
npm.cmd run rebuild:post-search-index -- --all-active
```

## 验收查询

必须支持：

- `有没有讲节俭家风的帖子？`
- `一粥一饭当思来处不易`
- 某个视频名

预期：

- 有证据时返回 `mode=rag`、`answer`、`citations`、可跳转 `items`。
- 没有足够证据时返回 `mode=no_answer`。
- 腾讯服务不可用时返回 `mode=fallback`，不显示 AI answer。

2026-06-25 云端真实 smoke 结果：

- `npm.cmd run verify:post-rag-smoke` 通过。
- 验收问题 `有没有讲节俭家风的帖子？` 返回 `mode=rag`，answer 包含《朱子治家格言》和“一粥一饭，当思来处不易；半丝半缕，恒念物力维艰”，`citations=2`，`items=1`。
- 原句查询 `一粥一饭当思来处不易` 命中同一临时帖子。
- 临时社区已 hardDelete，删除 job 已由 worker 清理。

当前未完成的真实验收：

- “某个视频名”字段级真实 smoke 暂未纳入默认脚本。原因不是 RAG chunk 提取缺失，`video_group` 的 `title/hint` 已进入 chunk；实际阻塞是视频字段会触发腾讯内容审核 `review`，再走 `audit.approveAdmin` 时旧 fallback 全文索引刷新在 15s 云函数超时内可能写不完。后续要么把旧全文索引刷新异步化，要么提高 admin 函数超时，再把视频字段加入真实 smoke。
