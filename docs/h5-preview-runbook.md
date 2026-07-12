# HappyHome H5 预览运行手册

这份文档给新的 Codex/Claude session 使用：目标是把小程序 H5 预览真实跑起来，并用真实页面状态验证 UI 改动。当前权威入口是 `npm.cmd run h5:web` 和 `npm.cmd run test:h5:web`；后文固定 `5183` 端口和 DEV openid 的内容仅用于诊断旧服务，不是通用 Web 登录流程。

## 当前通用 Web 流程

每台机器创建 `~/.happyhome/h5-web.env`，只填写本机值，不提交文件：

```dotenv
HH_CLOUDBASE_ENV_ID=<public-environment-id>
HH_CLOUDBASE_ACCESS_KEY=<publishable-web-access-key>
HH_H5_WEB_USERNAME=<dedicated-low-privilege-user>
HH_H5_WEB_PASSWORD=<machine-local-password>
HH_WECHAT_TEST_OPENID=<isolated-wechat-fixture-member>
```

启动器只把前两个公开值映射为浏览器构建变量；用户名、密码和 WeChat identity 不进入 Vite 子进程环境或日志。它在 `127.0.0.1` 自动选择空闲端口，打印脱敏后的 URL、cwd、branch、HEAD，并且退出时只终止自己创建的进程树，绝不按端口杀进程。

```powershell
npm.cmd run h5:web
npm.cmd run h5:test-tenant -- doctor
npm.cmd run test:h5:web -- --mode=read
```

`doctor` 和默认 read smoke 都是只读操作，不获取 validation lease，因此多个 worktree 可并发读取共享基线。read smoke 覆盖 homepage、30/1/0 长短空板块、section、detail、profile，并把不含密码、openid、正文和 storage URL 的 counts/geometry 写入 `.codex-local/h5-web-smoke/<run-id>/summary.json`。

初始化或修复共享基线必须显式 prepare/apply：

```powershell
npm.cmd run h5:test-tenant -- prepare
$env:HAPPYHOME_FIXTURE_PREFIX='hh-web-h5-v1'
npm.cmd run h5:test-tenant -- apply --manifest=.codex-local/h5-test-tenant/prepare.json
```

apply、`--mode=write` 以及 WeChat DevTools 自动化会获取同一台机器的 validation lease。固定 short section 含一个 deterministic、optional 的图片控件，31 条 baseline posts 保持该字段为空。write smoke 使用唯一 run ID，通过真实 H5 file chooser 上传脚本生成的 1×1 PNG 并只创建自己的临时记录，进入 exact detail 后验证该内容图片已解析为 HTTPS storage URL；随后用作者删除控件清理，再重新读取该 detail 验证记录已不存在。创建后的任意失败也会按唯一内容重新定位 exact post 并清理；无法定位或清理时非零退出。

故障诊断：缺少配置时按报错补齐 machine file；doctor drift 时先重新 prepare 比对，禁止自动修复；端口启动失败时检查报错所列随机端口和当前 child PID，不要终止其他 worktree 服务；lease active/stale 时先运行 `npm.cmd run validation:lease:status`，未经原 owner 退出确认不得恢复。

核心原则：如果 H5 没显示出预期 UI，不要停在“代码和单测通过”。这通常是一个调试信号，需要继续追到 API 数据、页面运行态、或者 dev server 进程层。

## 1. 先确认服务跑在哪个工作区

用户常看的 H5 地址通常是：

```text
http://127.0.0.1:5183/#/pages/index/index
```

先确认 `5183` 端口到底由哪个目录启动。不要假设当前 Codex worktree 就是浏览器正在看的目录。

```powershell
$conns = Get-NetTCPConnection -LocalPort 5183 -State Listen -ErrorAction SilentlyContinue
$conns | ForEach-Object {
  $owningProcess = $_.OwningProcess
  Get-CimInstance Win32_Process -Filter "ProcessId=$owningProcess" |
    Select-Object ProcessId,CommandLine |
    Format-List
}
```

已验证过的常见情况是：端口来自另一个 checkout，而不是当前 worktree。若改错工作区，H5 不会变化。

## 2. 正常启动或重启 H5

前台启动：

```powershell
cd <repository-root>
npm.cmd --workspace miniprogram run dev:h5 -- --host 127.0.0.1 --port 5183
```

后台重启当前 `5183`：

```powershell
$conns = Get-NetTCPConnection -LocalPort 5183 -State Listen -ErrorAction SilentlyContinue
foreach ($conn in $conns) {
  Stop-Process -Id $conn.OwningProcess -Force
}

Start-Process `
  -FilePath "npm.cmd" `
  -ArgumentList @("--workspace","miniprogram","run","dev:h5","--","--host","127.0.0.1","--port","5183") `
  -WorkingDirectory "<repository-root>" `
  -WindowStyle Hidden
```

重启后再打开：

```text
http://127.0.0.1:5183/#/pages/index/index
```

## 3. 登录态和社区态

H5 调云函数走 `http-gateway`。如果页面是未登录态，先走小程序内的 DEV 登录：

1. 打开 `#/pages/profile/index`
2. 点击 `DEV 登录`
3. 输入一个已有目标社区成员身份的 openid 和昵称
4. 回到 `#/pages/index/index`

通用测试 openid 可能没有目标社区数据。若要验证目标社区，使用隔离测试身份，或者通过后台/API 创建临时 fixture 并清理。

## 4. 验证真实 API 数据

H5 没显示时，先确认后端是否真的有数据。可以用仓库里的测试 API helper。

```powershell
@'
import { callAdmin, callAs } from './scripts/lib/test-api.mjs'

const communityId = '<temporary-community-id>'
const memberOpenid = '<target-community-member-openid>'

const sections = await callAs(memberOpenid, 'section', 'list', { communityId })
console.log(JSON.stringify(sections.sections.map((s) => ({
  id: s._id,
  name: s.name,
  type: s.type,
  status: s.status,
  widgets: (s.widgets || []).map((w) => ({
    widgetId: w.widgetId,
    label: w.label,
    type: w.type,
    order: w.order,
    showInList: w.showInList,
  })),
})), null, 2))

for (const section of sections.sections.filter((s) => s.type === 'evergreen')) {
  const posts = await callAs(memberOpenid, 'post', 'list', { sectionId: section._id, skip: 0 })
  console.log(section.name, posts.posts.length, posts.posts.slice(0, 3).map((p) => ({
    id: p._id,
    authorNickname: p.authorNickname,
    content: p.content,
  })))
}

const adminCommunities = await callAdmin('community.list')
console.log('admin community count:', adminCommunities.communities.length)
'@ | node --input-type=module
```

注意：`callAdmin` 能看到后台数据，不代表 H5 当前用户有权限。H5 路径要用 `callAs(memberOpenid, ...)` 复查。

## 5. 结构化内容验证经验

使用隔离 fixture 时，先记录临时社区、板块和清理标识：

```text
communityId = <temporary-community-id>
section = <temporary-section-name>
```

真实控件标签要从 API 读取，不要按需求措辞猜。一次真实数据里：

```text
家书作者
家书名
家书正文
```

所以列表展示逻辑应取：

```text
第一行：家书名
第二行：家书作者
```

若历史帖子缺少 `家书名`，不要在 UI 里猜标题，除非用户明确要求兜底。若用户说后续会在控件层强制必填，就让旧数据保持真实状态，必要时单独做数据清理。

## 6. H5 不更新时的排查顺序

不要只刷新浏览器就结束。按这个顺序查：

1. `git status --short --branch`：确认改的是哪个工作区。
2. `Get-NetTCPConnection -LocalPort 5183`：确认浏览器看的服务来自哪个目录。
3. API 直查：确认目标 community/section/widgets/posts 存在。
4. H5 登录身份：确认当前 DEV openid 是目标社区成员。
5. 重启实际 dev server：热更新不可信时直接重启 `5183`。
6. 回到 H5 真页面截图或 DOM：确认用户实际能看到变化。

只有到这些层都查过，才可以说“目前被某个外部条件阻塞”。不要把“没渲染出来”当作结束语。

## 7. 最低验证命令

UI 逻辑改动后至少跑：

```powershell
npm.cmd --workspace miniprogram run type-check
npm.cmd --workspace miniprogram run test:unit -- widget.test.ts
```

如果改了页面生命周期、tabBar、路由、打包相关逻辑，再补：

```powershell
npm.cmd --workspace miniprogram run build:mp-weixin
```

最后必须在 H5 实际页面给出可见证据，尤其是用户正在看的 `5183` 页面。
