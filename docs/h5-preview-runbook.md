# HappyHome H5 预览运行手册

这份文档给新的 Codex/Claude session 使用：目标是把小程序 H5 预览真实跑起来，并用真实页面状态验证 UI 改动。

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

已验证过的一次情况：`5183` 实际来自 `C:\Project\Claude\happyHome\miniprogram`，不是 Codex worktree。若改错工作区，H5 不会变化。

## 2. 正常启动或重启 H5

前台启动：

```powershell
cd C:\Project\Claude\happyHome
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
  -WorkingDirectory "C:\Project\Claude\happyHome" `
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

通用测试 openid 可能没有目标社区数据。若要验证某个真实社区，例如“明士班”，必须使用已经是该社区成员的身份，或者通过后台/API 创建临时 fixture 并清理。

## 4. 验证真实 API 数据

H5 没显示时，先确认后端是否真的有数据。可以用仓库里的测试 API helper。

```powershell
@'
import { callAdmin, callAs } from './scripts/lib/test-api.mjs'

const communityId = 'dd0cb69969eb0baa006767350db40e50'
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

## 5. 明士班家书验证经验

已验证的明士班社区：

```text
communityId = dd0cb69969eb0baa006767350db40e50
section = 家书十年传
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
