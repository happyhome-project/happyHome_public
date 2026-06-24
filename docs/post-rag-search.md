# 帖子 RAG 搜索服务

本文档记录小程序帖子搜索的当前实现边界。这里的 RAG 先落在可控的检索层：把帖子拆成可引用的证据分块，用全文倒排和本地稀疏向量召回候选，再把命中的帖子与分块返回给前端搜索框。

## 数据分层

源数据：

- `posts`：帖子正文、视频标题、音频标题、图文笔记、地点等 widget 内容。
- `sections`：板块名称、widget 配置和字段标签。

派生索引：

- `post_search_documents`：每篇帖子的搜索文档，保存标题、字段摘要、全文规范化文本、源更新时间。
- `post_search_chunks`：RAG 证据分块，精确到字段和 chunk，搜索结果的 `matchedFields` 来自这里。
- `post_search_terms`：chunk 级全文倒排词，用于快速候选召回。
- `post_search_vector_terms`：本地稀疏向量词，作为无外部模型依赖的语义召回补充。
- `post_search_index_state`：每篇帖子的索引状态，记录 indexed/removed、chunk 数、term 数、vector term 数和源更新时间。

## 动态更新机制

索引更新是派生缓存，不是源数据。更新策略是先清理旧派生行，再按当前帖子和板块配置重建。

已接入的更新入口：

- 用户发帖/改帖通过审核后：重建该帖索引。
- 内容审核状态变化：审核通过时刷新，删除/不可见时清理。
- 帖子删除或状态变为 deleted：清理 document/chunk/term/vector term，并写 removed 状态。
- 板块字段或名称变化：按板块回填，刷新字段标签和板块名称。
- 板块删除：清理该板块下所有搜索派生行。
- 管理后台重建搜索索引：按社区或板块重新扫描源帖子并重建派生索引。

## 查询路径

`searchPostIndex` 不再扫描整个社区的 `post_search_documents`。

当前查询路径：

1. 规范化用户 query，生成 n-gram 全文词和本地稀疏向量词。
2. 查 `post_search_terms` 和 `post_search_vector_terms` 得到候选 chunk。
3. 按 chunk id 读取 `post_search_chunks`，过滤社区/板块。
4. 按 post id 读取 `post_search_documents`，组合命中字段和帖子元数据。
5. 返回帖子列表、命中字段、预览和排序分数。

这意味着搜索“朱子治家格言中的一句话”会命中正文 chunk；搜索某个视频名会命中视频字段 chunk。

## 腾讯云边界

腾讯云知识引擎原子能力已经开通，但当前实现默认不调用外部模型，也不消耗腾讯云资源包。

当前原则：

- 不在仓库内保存 SecretId/SecretKey。
- 不默认开启后付费能力。
- 本地 RAG 检索先保持可验证、可回滚、无外部依赖。
- 后续如需升级，可在现有 chunk 层接入腾讯 `GetEmbedding` 和 `RunRerank`，作为可选的 embedding/rerank adapter；源数据和本地倒排索引仍保留。

## 运维命令

创建/补齐数据库集合与索引：

```powershell
npm.cmd run ensure:indexes
```

回填帖子搜索索引：

```powershell
npm.cmd run rebuild:post-search-index -- --all-active
npm.cmd run rebuild:post-search-index -- --community-id <communityId>
```

本地验证：

```powershell
npm.cmd --prefix cloud test
npm.cmd --prefix cloud run build
npm.cmd run test:post-search-rebuild
```
