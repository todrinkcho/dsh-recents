# @todrink/dsh-recents

在「新会话」按钮和「工作区」列表之间，放一条 **最近对话** 快捷区：跨全部工作区、按最后活动时间取 **3 条**会话。

它是 **镜像链接**，不是搬家：会话本体仍旧留在它所属的工作区树里，这条快捷区只提供"我刚在干什么"的入口。点击只做一件事——调宿主自己的 `uiWorkspace.openSession()` 跳过去；置顶、归档、改名、排序一概不碰。

## 显示规则

| 规则 | 行为 |
| --- | --- |
| 数量 | 固定 3 条（不做配置项） |
| 范围 | 所有工作区，按 `updatedAt` 倒序 |
| 排除 | 已归档会话、还是空白（`blank`）的新会话 |
| 不足 | 有几条显示几条；一条都没有 → 整块不渲染（不留空标题） |
| 重复 | 允许：同一条会话在下方工作区树里照常出现 |
| 每行 | 标题（超长省略，hover 显示全名）+ 右侧相对时间（刚刚 / N分钟 / N小时 / N天）+ 状态点 |
| 状态点 | 黄 = 有会话等你处理（`pendingInteraction`）、绿 = 已完成未读（`completionUnread`）、蓝 = 正在跑（转圈用脉冲动画），取 `uiSession.sessionStatus` 快照 |
| 当前会话 | 该行 `aria-current="page"`，文字转 primary 色 |
| 折叠态 | 侧栏收成 48px 图标栏时整块隐藏（`data-rs-compact`） |
| 滚动 | 钉在工作区列表上方，**不随**列表滚动 |
| 语言 | 跟随 `document.documentElement.lang`：中文 / 英文两套词条，不依赖 locale 服务 |

## 宿主契约（形如 0.2.2-rc.x 实测）

- `sessions.list` 快照：`{ phase, ids, byId }`，`byId[id]` 带 `title` / `displayTitle` / `blank` / `running` / `updatedAt` / `retainedBy.mainView`。
- `workspaces.list` 快照：`{ items, archivedSessionIds, pinnedSessionIds }`。
- `uiSession.sessionStatus` 快照：`ReadonlyMap<SessionId, { running, pendingInteraction, completionUnread }>`，`subscribe()` 可订阅。
- `uiWorkspace.openSession(sessionId)`：跨工作区跳转，宿主自己处理展开与高亮。
- 注入方式：`ctx.inject(['sessions', 'workspaces', 'uiSession', 'uiWorkspace'], …)`；四个访问点全部可选链，字段改名时退化成"少几行"，不会抛。

## 为什么是插入 DOM 而不是注册 slot

侧栏在「新会话」和「工作区」之间 **没有 slot**；而 `sidebar.workspaces` 是 `single` slot，整个浏览区归宿主或 `@local/sidebar-fold` 所有。所以本模块把一个容器插进侧栏列：

```
sidebar root (flex column)
├─ logoRow            (被 topbar-nav 压成 0 高)
├─ newSessionRow      ← 新会话
├─ [data-rs-list]     ← 本插件插在这里
└─ scrollRegion       ← 工作区（含标题、树、滚动）
    └─ scrollArea …
```

定位算法 **不靠 CSS-module 类名**：从 `[data-slot="sidebar.workspaces"]` 向上走，直到某个祖先同时包含 `[data-slot="sidebar.session.action"]`（新会话槽），此时当前节点就是工作区子树的最外层，把容器 `insertBefore` 到它前面即可。容器对 React 来说是外来的兄弟节点，React 按引用维护自己的子节点，不会动它；`MutationObserver` 在每次变更后复核位置，被挤掉或次序错了就重新插。

样式全部走宿主 token（`--dsw-alias-label-*`、`--dsw-alias-interactive-bg-hover`、`--dsw-radius-sm`、`--dsw-alias-state-*`、`--dsh-sidebar-inline-padding`、`--dsh-sidebar-row-padding`），所以暗色主题与换肤自动跟随。几何：行高 32、圆角 8（`--dsw-radius-sm`）、标题左缘 20px（= inline 8 + row padding 12，与「工作区」标题同列）、行盒 x=8 宽 264（与宿主会话行同宽）。

## 已知坑（踩过一次）

`client.js` 被模块加载器当成 **经典脚本**注入到同一作用域，所以**顶层不能有 `const`/`let`/`function` 重名**——第一版顶层写了 `const STYLE_ID`，和 `@local/topbar-nav` 的同名常量撞车，整模块报 `SyntaxError: Identifier 'STYLE_ID' has already been declared`，插件静默消失（`data-rs` 不出现、无块、无样式）。现在整个文件包在 IIFE 里。

同类注意：CSS 模板串注释里不要写反引号（会提前闭合字符串，老坑）。

## 验证（2026-11-25，headless Edge，真实 1180×820 页面）

`node tools/probe-recent.mjs <baseUrl> <token> <outPrefix>` 一次跑完：

- 挂载：`data-rs` / `data-rs-list` / 样式节点都在，父节点 = 侧栏 root，前一个兄弟 = `newSessionRow`，后一个兄弟 = `scrollRegion`，块盒 (8, 84, 264×138)。
- 几何：head 左缘 20、行盒 x=8 宽 264、行高 32、标题 primary `rgb(15,17,21)`、时间 tertiary `rgb(129,133,140)`、字号 14px（与宿主会话行一致）。
- 三行数据：`侧栏最近对话模块开发适配 / 9分钟`、`手机端安装项目文件夹插件 / 23分钟`、`【当前时间】… / 1小时`，与侧栏树内同一条会话一致（镜像语义成立）。
- 状态点：动态打 `data-rs-status` 后取值 pending `rgb(245,158,11)`、done `rgb(34,197,94)`、running `rgb(65,118,230)` + `rs-pulse` 动画 → token 真实存在。
- 点击：点第 3 行（属于另一个工作区的 qq-bridge 会话）→ 主视图切到该会话正文，该行 `aria-current="page"` 出现 → 跨工作区跳转成立。
- 折叠：点宿主 toggle → `data-rs-compact` 置位、块 `display:none`；再展开 → `display:block`、3 行回来。
- 全程 `consoleErrors: []`、`pageErrors: []`。

未验证：hover 底色与 tooltip（CSS 直白）、暗色主题、空态（全是空白/归档会话时整块消失）、运行中状态点与真实回合联动的观感。

## 与其它插件的关系

- `@local/topbar-nav`：互不依赖。本块在侧栏列里随流排布，图标行是 `position: fixed`；折叠态两者各查各的 `[data-sidebar-collapsed]`。
- `@local/sidebar-fold`：本块插在它外面，不碰它渲染的任何节点；「工作区树里同一会话照常出现」是刻意保留的重复。
