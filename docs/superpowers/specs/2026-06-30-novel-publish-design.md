# 小说发布功能(novel publish)设计

> 参考:[oh-story-claudecode 创作闭环参考](../../references/oh-story-claudecode-reference.md)(目标平台 番茄/起点/晋江,但只产出文件,不自动投稿)。
> 现实约束:番茄/起点/晋江 **无开放写入 API**,日常发布是作者在平台网页编辑器里**逐章粘贴**;番茄作家助手支持**批量导入**(每章一个 txt / ZIP,见 Chrome 扩展「番茄小说注入神器」、GitHub `fanqie_auto_publish`)。故 narratox 的「发布」= 生成「平台格式化、可直接粘贴」的成稿,不自动投稿。
> 日期:2026-06-30

---

## 1. 背景与目标

作者写完章节后,要把正文搬到番茄/起点等平台发表。目前 narratox 没有任何「取出正文」的出口——作者只能在工作区一章章看,手动复制还带着 markdown 符号(`#`/`**`/`>`)。

本功能给作者两个取正文的入口,产出**同一份**去 markdown、按网文排版、可直接粘贴的成稿:

1. **卡片三点菜单 · 发布**(图书馆级,批量:选范围 → 复制/下载)
2. **章节预览 · 复制本章**(工作区,单章高频快捷)

两者共用一个服务端格式化引擎 + 一个端点,保证产出一致。

**不做(明确排除)**:自动投稿到平台(无 API、需 CDP、易封号);导出(与发布重叠,作者明确砍掉);ZIP/分章文件(v1 不做,端点留 `format=zip` 扩展口);平台差异化预设(通用格式覆盖);含卷头(需 join 卷数据,defer)。

---

## 2. 范围(三项 FE 改动 + 一项 BE)

| 入口 | 动作 | 产物 |
|---|---|---|
| 卡片 ⋮ 菜单 · **删除** | `Dialog` 二次确认 → 删除 | — |
| 卡片 ⋮ 菜单 · **发布** | 开 `PublishDialog`:选范围 + 格式选项 → 复制 / 下载 | 格式化文本(复制到剪贴板 / 下载 `.txt`) |
| 章节预览 · **复制本章** | 一键复制当前章成稿 | 当前章格式化文本到剪贴板 |

---

## 3. 架构:服务端格式化引擎 + 单端点 + 两入口

```
┌─ NovelCard ⋮ 菜单 ────► PublishDialog ─┐
│                                         ├──► GET /novels/:id/publish ──► PublishService
└─ ChaptersView 复制本章 ─────────────────┘    (from/to/title/synopsis/    (stripMarkdown +
       (两个 FE 入口,同一端点)                  indent query)               formatForPublish)
```

**格式化只在服务端做**。理由:① 卡片在图书馆页只有 `NovelListItem`(无 chapters),必须取数据;② markdown 剥离用服务端正经实现而非前端 regex,稳健;③ 两入口产出严格一致。预览页虽有完整 `Novel.chapters`,也为一致性复用端点(单章 payload 极小,可接受一次往返)。

---

## 4. 后端:PublishService + 端点

### 4.1 `server/src/novel/publish.service.ts`(纯函数,易单测)

```ts
// 剥 markdown:保留正文与段落,去标记
export function stripMarkdown(md: string): string

export interface PublishOptions {
  from: number
  to: number
  includeTitle: boolean   // 含章题行「第N章 标题」
  includeSynopsis: boolean// 开头加 novel.synopsis
  indent: boolean         // 每段首行全角空格×2
}

// novel + 已切片章节 → 平台成稿文本
export function formatForPublish(
  novel: { title: string; synopsis: string | null },
  chapters: Array<{ order: number; title: string; content: string }>,
  opts: PublishOptions
): string
```

**`stripMarkdown` 处理**:headings `#`/`##`→去标记留文;粗斜 `**`/`*`/`_`→去;行内码 `` ` ``→去;链接 `[t](u)`→`t`;图片 `![]()`→删;引用 `>`→去;无序/有序列表标记 `-`/`*`/`1.`→去;水平线 `---`→删。保留段落换行。

**`formatForPublish` 产出结构**:
```
[简介(novel.synopsis)\n\n]   ← includeSynopsis
第N章 标题\n\n                 ← includeTitle(每章)
　　{首段缩进}正文…            ← indent(段首全角空格×2)
                              ← 章间空行
第N+1章 标题\n\n
…
```

### 4.2 端点

`GET /novels/:id/publish?from=&to=&title=1&synopsis=0&indent=1`
- `@Public` 否(走全局 JwtAuthGuard,user-scoped,`@CurrentUser`)
- query:`from`/`to`(章节 order)、`title`/`synopsis`/`indent`(0/1,默认 title=1 indent=1 synopsis=0)
- **范围语义(免 FE 知道总章数)**:`from≤0` → 1;`to≤0` 或 `to>maxOrder` → 末章。故 FE「全部」= `from=0&to=0`;「第 N–M 章」= `from=N&to=M`。BE 取 `ChapterService.list` 后按 order 过滤 + 排序,clamp 到实际范围。
- 复用 `NovelService.get(userId, id)` 取 novel、`ChapterService.list(userId, novelId)` 取章节。
- 返回 `res.setHeader('Content-Type', 'text/plain; charset=utf-8')` + body = `formatForPublish(...)`。
- 注册路由到 `agent-ui/src/api/routes.ts` + FE client `publishNovel(...)`。

---

## 5. 前端

### 5.1 卡片三点菜单(`NovelCard.tsx` + `NovelLibrary.tsx`)

- 删除现有 🗑 按钮,换 ⋮ 三点(触发 shadcn `DropdownMenu`)。需先 `npx shadcn@latest add dropdown-menu` 生成 `components/ui/dropdown-menu.tsx`。
- ⋮ 按钮 `onClick` 内 `e.preventDefault(); e.stopPropagation()`(不触发卡片 `<Link>` 跳转),hover 显隐(同原 🗑 的 `group-hover:opacity-100`)。
- 菜单项:
  - 「发布」→ `onPublish(novel.id)`(提升到 `NovelLibrary`,开 `PublishDialog`)
  - 「删除」→ 开本地 `Dialog` 二次确认:「确定删除《标题》?此操作不可撤销。」[取消][删除(brand/destructive)] → `onDelete(id)`
- `NovelLibrary.tsx`:保 `onDelete`,新增 `onPublish` + `<PublishDialog open novelId onClose>` state。

### 5.2 发布弹窗(`PublishDialog.tsx`,shadcn `Dialog`)

- **章节范围**:radio「全部」/「第 N–M 章」(后者两个 `<input type="number">`);默认全部。
- **格式选项**:`☑ 含章题行`(默认勾)· `☑ 首行缩进`(默认勾)· `☐ 含简介`。用原生 `<input type="checkbox">`(项目无 shadcn checkbox,沿用现有风格)。
- **底部**:`[复制到剪贴板]`(brand) + `[下载 .txt]`(outline)。
- 行为:点任一 → 调 `publishNovel(endpoint, token, novelId, {from,to,title,synopsis,indent})` → `res.text()`:
  - 复制:`await navigator.clipboard.writeText(text)` → toast(sonner)「已复制 N 章成稿」
  - 下载:`const url = URL.createObjectURL(new Blob([text], {type:'text/plain;charset=utf-8'}))` → `<a href=url download="书名.txt">` 程序点击 → `URL.revokeObjectURL`
  - loading 态(按钮 disabled + 「生成中…」);失败 toast「生成失败」。
- novelId → 需标题做文件名:弹窗内 `getNovel(endpoint, token, novelId)` 取 title(或 library 把 novel 对象传入,免一次请求)。**采:library 把 `novel` 对象传给 dialog**(图书馆列表已有 `NovelListItem`,含 title)。

### 5.3 章节预览「复制本章」(`ResourcePanel.tsx` · `ChaptersView`)

- 在 `ChaptersView` 章节切换头(`☰` 目录按钮旁)加 📋「复制本章」按钮。
- 点击 → `publishNovel(endpoint, token, novel.id, {from: currentChapterOrder, to: currentChapterOrder, title:1, synopsis:0, indent:1})` → `writeText` + toast「已复制第N章」。
- `ChaptersView` 已能从 `useStore` 拿 `endpoint`/`token`?——需补:加 `useStore((s)=>s.selectedEndpoint)` / `authToken`(参考 `WorldView` 等同文件组件的取法)。

---

## 6. API 客户端

`agent-ui/src/api/novels.ts` 新增:
```ts
export async function publishNovel(
  base: string, token: string, id: string,
  opts: { from: number; to: number; title: boolean; synopsis: boolean; indent: boolean }
): Promise<string> {
  const qs = new URLSearchParams({
    from: String(opts.from), to: String(opts.to),
    title: opts.title ? '1' : '0',
    synopsis: opts.synopsis ? '1' : '0',
    indent: opts.indent ? '1' : '0',
  })
  const res = await fetch(`${APIRoutes.NovelPublish(base, id)}?${qs}`, { headers: headers(token) })
  if (!res.ok) throw new Error('生成失败')
  return res.text()
}
```
`routes.ts` 新增 `NovelPublish: (base, id) => \`${base}/novels/${id}/publish\``。

---

## 7. 测试

- **BE 单测** `publish.service.spec.ts`(纯函数,主体):
  - `stripMarkdown`:headings/粗斜/链接/图片/引用/列表/水平线 各一例 + 纯文本不损。
  - `formatForPublish`:含/不含章题、含/不含简介、缩进开关、`from..to` 切片、章间空行、多章顺序。
- **Controller**:沿用既有 query 解析 + user-scope 模式(`@CurrentUser` + `NovelService.get`)。
- **FE**:项目无 runner(gate = `pnpm validate`:lint+format+typecheck)。手动验证四条路径:卡片⋮菜单展开、删除二次确认、发布弹窗复制+下载、预览复制本章。

---

## 8. 改动面

| 类型 | 文件 |
|---|---|
| 新增 | `server/src/novel/publish.service.ts`(+spec) |
| 改 BE | `server/src/novel/novel.controller.ts`(新 `@Get(':id/publish')`)、`server/src/novel/novel.module.ts`(若 PublishService 需注册) |
| 新增 FE | `agent-ui/src/components/library/PublishDialog.tsx`、`agent-ui/src/components/ui/dropdown-menu.tsx`(shadcn add) |
| 改 FE | `agent-ui/src/components/library/NovelCard.tsx`(🗑→⋮)、`NovelLibrary.tsx`(dialog state + onPublish)、`agent-ui/src/components/workspace/ResourcePanel.tsx`(ChaptersView 复制按钮)、`agent-ui/src/api/novels.ts`(`publishNovel`)、`agent-ui/src/api/routes.ts`(`NovelPublish`) |

**无 DB 迁移、无新 agent、无 agent 改动、无 server agentos 改动。**

---

## 9. 边界与 defer

- **不自动投稿**(平台无 API)。
- **不导出**(与发布重叠,砍)。
- **ZIP / 分章文件**:端点设计成未来可加 `format=zip`(每章一个 txt 打包),v1 只 `text/plain`。番茄注入神器要 ZIP 时再加,同一端点扩展。
- **含卷头**:需 `OutlineService` join 卷标题/目标,defer。
- **平台预设**:通用格式覆盖番茄/起点/晋江 的纯文本粘贴需求,不做差异化。
- **大书性能**:`GET /novels/:id/publish` 返回整段文本(200 章可能数 MB)。v1 可接受(一次性下载/复制);若成为问题,后续加 `format=zip` 流式或分卷。

---

## 10. 验收

- `stripMarkdown`/`formatForPublish` 单测全绿;既有 server 套件不回归。
- `pnpm validate`(agent-ui lint+format+typecheck)绿。
- 手动:卡片 ⋮ 菜单(发布/删除两项)、删除二次确认 Dialog、发布弹窗(范围 全部/N–M、三个选项、复制成功 toast、下载 .txt 文件名=书名)、章节预览复制本章 toast。
- 产出文本无 markdown 残留、章题行/缩进/简介按选项生效。
