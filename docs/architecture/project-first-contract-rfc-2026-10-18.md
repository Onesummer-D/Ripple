# RFC：Ripple Project-first 领域架构与迁移路线

**日期：2026-10-18** · **状态：Project-first 核心与本机工作台已接通；当前 PR head 的真实 Bolt 手动工作流尚未运行；正式预演 UI、MEDIA/TOKEN 覆盖与进程沙箱仍未完成**  
来源：[产品与架构复审 v2](../strategy/Ripple_产品定位与架构复审_v2_2026-10-18.md) · [独立架构审计](./architecture-independent-audit-2026-10-18.md)。

## 已做出的技术决策

**采用审计方案 B：推翻以固定 CaseFixture 为产品业务中心的架构，保留可复用的 A 页面能力、B 真实浏览器/源码分析工具、C 素材与 Bolt 高质量网站 UI；围绕真实 Project / EditSession / Patch / Evidence 重设领域和编排。**

这里的 B 是架构方案而非 B 队员。若后续迁移实验证明被保留模块妨碍设计或重写成本更低，允许选择全量重建。对旧实现既不盲目保留，也不因“更先进”而盲目丢弃。

## 已落地的 Project-first 执行切片（2026-10-18）

- `src/core/model.ts` 与 `src/core/session.ts`：ProjectRevision、SourceGraph、ScopeDecision、统一 EditOperation、CandidatePatch、VerificationRun/Evidence、AppliedRevision、EditSession；没有以青野/栖光等固定案例作为领域主键。验证状态只能由与候选 hash、源码基线、运行环境、页面/视口/状态/证据文件匹配的检查构成。
- `src/core/project.ts`：读取干净 Git 工程，按跟踪文件字节生成源摘要；用 TypeScript AST 解析 React/Vite JSX、模块导入、React 页面状态、组件消费者、JSX 文本、Tailwind 颜色 token、CSS 自定义属性与图片引用。来源关系带源码偏移和证据确定性；不能证明的关系保留为 unresolved/unknown。
- `src/core/scope.ts`：沿实际 `reads`、`uses-token`、`asset-consumer`、`imports`、`renders` 等 source-proven 关系反向计算页面消费者；操作目标在 `includedRefs` 中不再被视为充分授权。页面未全部显式包含或出现 excluded/protected 消费者时，候选直接拒绝。
- `src/core/source-annotation.ts`：只在服务的 JSX host 元素注入定义级源码锚点和独立的逐次渲染实例 ID，不写目标工程。`resolveJsxSourceElement` 通过图谱中的直接文本消费边定位文本，不再把祖先 JSX 容器误作内部文本的具体来源。
- `src/core/candidate.ts`：将干净基线创建为 Git worktree；校验 Scope included/excluded/protected 与真实页面传播；在同一文件按倒序源码偏移组合多项 TEXT/MEDIA/TOKEN 修改；生成真实 Git 补丁、补丁 SHA-256 和候选树摘要；原工程漂移、检出字节不一致、越界/符号链接路径、Scope 冲突、旧候选哈希都会拒绝。
- `src/core/apply.ts`：只接受当前已验证且获批的 `CandidateRecord`；再检查原工程摘要/HEAD、候选目录和补丁工件哈希后，`git apply --check` 并应用工件中的同一补丁；落地摘要须等于已验证候选树。回滚要求工程仍精确处于该候选树，反向应用同一补丁后必须恢复基线摘要。
- `src/core/verification.ts`：只有运行记录与 candidate/source/runtime/check/viewport/state 一致、截图确为 PNG 且实际文件哈希重算匹配时，才签发当前进程内的执行收据；Evidence 对象本身或调用者填写的截图路径/哈希不能通过 `registerVerification`。浏览器检查记录未通过也不能登记为通过。
- `src/app/ProjectWorkbench.tsx` 与 `src/core/local-project-api.ts`：默认工作台可打开用户指定的本机 Git 工程、展示真实页面/共享组件/源码目标及确定性、记录原始意图、多项 TEXT/MEDIA/TOKEN 操作、逐页 include/exclude/protect，生成和展示隔离 worktree 的 patch/diff/hash，并丢弃候选。API 只绑定 loopback，不运行目标工程脚本。浏览器/批准/应用状态明确为 `NOT RUN`。
- `scripts/bolt-integration-acceptance.mjs`（`npm run acceptance:bolt -- <Bolt-project> <work-root>`）：原 Bolt checkout 外创建 baseline/local/shared candidate worktree；验证真实首页局部两项编辑不会传播到其它页面；验证 Footer 共享编辑在四个页面传播而页面主体不变；执行真实导航与三视口响应式断言、DOM→精确 JSX 来源映射、重复实例 ID 和浏览器错误检查。`pixelmatch/pngjs` 只留作差异工件，不作为通过标准。最后在一次性 worktree 应用并回滚已获批的同一补丁。依赖、浏览器、screenshots 和执行 JSON 均在 Bolt 原目录之外。
- `.github/workflows/ci.yml`：自动运行类型检查、单元/API 测试、构建和 Playwright，保留截图、trace、机器可读报告；`bolt-acceptance.yml` 手动检出私有 Bolt 工程，在工作台 UI 与核心执行器两条路径运行真实项目验收并保存工件。

验收边界以 PR #2 对应 Actions run 的执行记录为准，不把通用合成 React/Vite 工程测试写成 Bolt 验收。当前 PR head 的自动 CI 为 3 项 Playwright 通过、1 项跳过；其中 Bolt 专项因没有 `RIPPLE_BOLT_PROJECT` 而跳过，手动 Bolt workflow 尚无本 head 的执行记录。`scripts/bolt-integration-acceptance.mjs` 和手动 workflow 已提交，但只有实际运行并下载对应工件后，才能报告真实 Bolt 局部/共享浏览器行为及同补丁应用/回滚通过。GitHub 仅允许从默认分支上已存在的 workflow 手动派发；本 PR 尚未进入默认分支，因此当前不能据此声称手动验收已经执行。

工作台 UI 当前仍将浏览器预演/验证/批准/应用显示为 `NOT RUN`，它还没有托管站点生命周期、执行信任边界和持久化 EditSession。浏览器页面刷新现在能从本机进程恢复活动候选、Scope 和操作；这不是跨进程持久化，Ripple 服务关闭时会清理完整候选，异常/哈希不匹配现场保留并拒绝作为有效候选。MEDIA 目前只支持源码字符串候选，不含焦点裁切/多尺寸规则；TOKEN 能识别来源但缺共享颜色系统与页面/组件 override 数据模型。Git worktree 只隔离源码版本，不是 OS 级进程沙箱；不得开放任意不可信仓库执行。原 Fixture `App`、CaseRuntime 等模块尚未删除，但已从默认入口和正式 E2E 中卸下，不能继续作为真实项目数据源。

## 核心不变量

1. 保存原始用户意图 `rawIntent`；“完善提示词”只能增强工作方式，不得擅自增加/修改业务目标。只读/写权限应该由执行编排控制。
2. `ProjectRevision.sourceDigest` 是实际内容指纹，不能只写分支名。图谱、候选与测试运行必须以它为基线；`runtimeFingerprint` 记录依赖、运行环境、模拟/真实 API 条件。
3. 修改范围显式包含 `includedRefs`、`excludedRefs`、`protectedRefs`，明确批准者、版本；被保护节点不能被补丁触及。运行时 **不能**继续通过 `sourceId` 命名或 `instanceId` 字段有无猜用户 Scope。
4. 同一个 `CandidatePatch` 可包含多条 TEXT/MEDIA/TOKEN/CODE 修改。B 原有 `draftFor` 的多项修改覆盖问题要作为迁移回归。
5. 真正可审批的候选必须产生隔离工程树摘要与补丁哈希；DOM 注入是**快速近似预演**，不能直接充当正式可应用补丁的验证。
6. `VerificationRun` 要绑定候选、补丁、基线、环境、页面、视口、交互状态与证据产物；风险/失败/未测不能自动视为通过。改变 Scope 生成新候选，保留旧运行记录但标记 `stale`。
7. 用户批准后，落入原工程的应当是**同一份已验证 Patch**。真实执行器必须检查当前原工程未漂移、校验最终 tree hash、原子执行、写版本或可恢复归档。此 TS 状态机只能拒绝不匹配声明，不能代替文件系统的独立哈希和原子事务。
8. 正式应用完成后，后续修改创建新 EditSession；源头共享/实例级覆盖规则应作为可管理、可回收的领域对象，不能无限向组件散布额外 `export const` 或 `if`。

## 产品系统边界，不强制微服务

```
用户入口：本地文件 / GitHub / ZIP / Agent 导出项目
  ↓ ProjectConnector（权限、隔离、环境）
ProjectRevision + ProjectRunner（编译和真实网页状态）
  ↓
SourceIndexer + RuntimeMapper（AST、媒体、CSS、DOM、来源证据）
  ↓
EditSession（Raw Intent、共享/语义关系、ScopeDecision）
  ↓
CandidateExecutor（接受显式 Scope，原子组合操作，输出 patch/tree hash）
  ↓
VerificationRunner（Playwright，多设备、动画与真实交互状态）
  ↓
Approval + RevisionStore（应用同一补丁、冲突检测、回溯）
  ↕
可视化工作台（现有 A UI，经 adapter 改造）
```

系统所有层用稳定 ProjectID、sourceDigest、CandidateID、patchHash、runID 关联。只有来源真实且与当前候选一致的证据才能标绿；未知必须展示。不能让 UI、B API 和 Fixture 分别维护一套自己的“改了哪里”。

## 新旧迁移矩阵

| 旧来源 | 保留什么 | 必须改变什么 |
|---|---|---|
| A `domain/contracts.ts` / `state.ts` | 纯函数、状态可测试思路 | CaseRuntime/draftValues 虚拟“已应用”退出产品真相源 |
| A `PagePreview` / `RelationshipMap` / `EvidencePanel` / MEDIA 库 | 可视化效果、响应状态与浏览器测量 | 从固定 Slots/CaseId 转为真实 ElementRef/Project/Session |
| A `fixtures.ts` / `truthMatrix.ts` | 回归负例和预期结果 | 迁入 tests/fixtures，不能代表任意外部项目 |
| B `graph.ts` | ts-morph 源码追踪原型 | 不再要求外部代码写 `<Route>`、`src/content/*`、`data-ripple-*` |
| B `pipeline.ts` | Git worktree、真实构建与候选策略 | 重写显式 Scope、多个编辑的原子补丁和版本持久化 |
| B `preview.ts` / `assert.ts` | 截图、几何风险、裁切与场景测试 | 版本指纹、API/动画状态、正常变化与未验证区分 |
| B case→A case 命名映射 | 旧系统过渡数据 | 不允许进入最终公开的通用 Project API |
| C 图像资源、栖光新旧海报 | 青野综合站点素材和通用 MEDIA 测试 | 栖光不再作为独立产品故事 |
| Bolt UI / Lovable 结构测试 | Bolt 商店 UI 作为青野优先视觉基线；Lovable 角标/购物/文件路由借鉴 | 不能为了迎合旧 Fixture 把优质业务站变为简陋页面 |

## 真实集成下一目标：Bolt 站点，而不是另一个假案例

在固定的 Bolt Git Commit 上：真正加载站点 → AST+运行时关系找共享导航/宣传文案/商品 → 用户明确保留历史和购物 → 支持当前页/共享/自定义 Scope → 生成真实候选（TEXT + MEDIA/TOKEN）→ Playwright 运行真实网页三视口及必要购物状态 → 证据带对应 Patch 和 Commit → 应用/撤销真实工程改动。

验收需覆盖**连续 5—10 次局部覆盖修改**、源文件改动与缓存失效、不同路由、状态回归、候选变更旧证据 stale、外部源码没标记时 honest unknown。对 Lovable TanStack Start 与冻结许可的开源工程再作异构压力测试。

## 实施优先次序（不是删减完整产品范围）

- 一条受信任的 ProjectRunner / Worktree / Patch hash API 及其测试；**先让工程中存在可追溯真实候选**。
- Bolt 工程 SourceIndexer：真实文件/路由/消费者/DOM 身份及证据，承接 A 的涟漪。
- A 工作台的新领域 API 接入与用户 Scope 控制，证据状态连通。
- 验证/应用/回溯和覆盖规则管理，与已有 UI 交叉验收。
- C 媒体、样式 Token、多状态交互、多工程适配和用户收益评估持续补足。

**分支可做契约和回归试验，但不得将单元测试通过宣称为真实站点已修改。当前主分支应用功能和 B 包均不应因这套契约的存在自动认定完成。**

## 成熟技术、许可证与复用边界

- 采用仓库已有 TypeScript Compiler API（项目自身已依赖 TypeScript），而没有另加 `ts-morph` 包装层；B 的 ts-morph 图谱原型用于对照其识别目标，但通用导入解析和更多构建系统尚需压力测试。
- Git worktree、Git patch/hash、Playwright 与 pixelmatch/pngjs 都沿用成熟能力。截图算法没有自研；B 包锁定的 pixelmatch 8.0.0 为 ISC，pngjs 7.0.0 为 MIT。Playwright 是现有项目开发依赖。候选 runner 重实现了显式 Scope、组合修改、源码摘要、EOL 一致性和清理安全，不直接复制 B 的 `draftFor`/字符串首匹配等缺陷实现。
- [Cursor Design Mode 文档](https://prod.cursor.com/docs/agent/design-mode)（闭源产品）和 [Onlook React 选择器](https://www.onlook.ai/for/react) / [Apache-2.0 仓库](https://github.com/onlook-dev/onlook)仅作交互与身份模型参考，本轮未复制代码。[stagewise 仓库](https://github.com/stagewise-io/stagewise)采用 AGPL-3.0，因此未引入其实现代码。
- [Shopify 图片焦点点位](https://help.shopify.com/en/manual/online-store/images/theme-images)、[Cloudinary 自定义焦点区域](https://cloudinary.com/documentation/custom_focus_areas)以及 [Storybook 视觉测试说明](https://storybook.js.org/docs/8/writing-tests/visual-testing)用于后续设计参考；本轮只复用了 B 已有本地像素差异能力，尚未实现可编辑图像焦点、共享覆盖规则或 SaaS 视觉基线服务。C 素材包已经检查来源声明，但没有把素材搬进 Ripple/Bolt 代码或误当作商品实拍。
