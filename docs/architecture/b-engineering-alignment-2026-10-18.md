# B 组工程对齐与实施方案

**日期**：2026-10-18（同日修订一轮，见下方修订记录）
**作者**：B（thisisCarys + 开发 AI）
**状态**：A/B 已对齐五项公共接口决策；负责人于 2026-10-19 批准冻结最小 EditOperation/Session v1。B 可据此开始 MEDIA `asset-swap` 执行器；未实现能力仍按 §4.5、§4.6 和 §9 标注，不因接口冻结视为验收。
**基线**：`feat/project-first-core-20261018` @ `91b0b83dd32cd294e1202ee6a7ce65374bf07765`
**输入材料**：A《Project-first 扩展契约提案》（`docs/architecture/project-first-extension-contract-proposal-2026-10-18.md`）、PR #2 独立审查评论（comment-6250535989）、B 第二份交付包 `ripple-B-package2-2026-10-14.tar.gz`（SHA-256 `fceb17feb7ee4af3d537e233df74c0a4a874828dc1472a589776cae7f9463956`）

**契约冻结记录（2026-10-19）**：

- 冻结标识：`ripple-edit-operation-session/v1`，代码基线 PR #2 `f2aeadf4b21d8936df593f14261728a8a05e65d8`。
- 冻结范围：现有 `EditOperation` 判别联合、payloadless 简单操作兼容、结构化 `asset-swap` / `local-projection` schema、`SessionInvariantError` 错误代码/字段路径及“未实现执行器 fail-closed”行为。
- 不在本次验收内：MEDIA 字节暂存、字节哈希与 CandidatePatch/Evidence 的端到端完整性、焦点裁切/variants 的运行效果及 MEDIA 专属 Evidence。它们须随对应执行器实装后单独验收。接口冻结不表示这些能力已可用。
- A/B 已确认五项设计决策；A 依据下方现有自动化测试范围冻结最小契约。B 可基于该版本开始 MEDIA `asset-swap`，无需再次讨论整体架构。

**修订记录（2026-10-18 晚，按负责人评审意见）**：

1. §1 撤回"PR #2 无 CI 运行记录"结论——Actions 对 `91b0b83` 有成功运行，`gh pr checks` 为空系命令报告限制。
2. §2.1 更正 main 描述：含原 Fixture 原型可运行代码，Project-first 核心在 PR #2。
3. §4.1 payload 草案改为真正的 TypeScript 判别联合（`kind` 与 `payload` 类型绑定），标注待与 A 的 AI 讨论后冻结。
4. §4.2 接受资源中立覆盖生命周期，但**暂不迁移 TEXT 已稳定的 registry v2**；先用 MEDIA/TOKEN 真实任务验证目标 ID 稳定性与结构化覆盖值，再决定是否抽象 v3。

---

## 1. 审计基线与证据来源

本次对齐基于以下真实源码，非 README 推断：

- `main` @ `f19ec7d`（仅文档提交，见 §2.1）
- PR #2 @ `91b0b83`，58 个提交，状态 **OPEN / Draft**
- 逐文件阅读：`src/core/model.ts`、`session.ts`、`candidate.ts`、`scope.ts`、`page-overrides.ts`、`project.ts`、`verification-contract.ts`、`verification-runner.ts`、`page-overrides.test.ts`、`session.test.ts` 等
- B 第二包全部源码（`tools/lib/graph.ts`、`adapter.ts`、`pipeline.ts`、`preview.ts`、`assert.ts`、`server/index.ts`，共约 2100 行）与其 evidence 产出物

**CI 事实（2026-10-18 修订，撤回先前结论）**：仓库存在 `.github/workflows/ci.yml` 与 `bolt-acceptance.yml`。此前本节称"PR #2 没有任何已报告的 CI 检查运行记录"，该结论**撤回**：GitHub Actions 已对 PR #2 的提交 `91b0b83` 有成功运行记录，PR #3、PR #4 的分支同样均有运行记录；`gh pr checks` 返回空系该命令的报告限制（checks 挂接方式导致其不列出条目），不能作为"无 CI 运行"的证据。审查评论中"此前 CI 对已覆盖路径通过"的说法与 Actions 运行记录一致。B 后续验证结论仍以本机实跑为准。

---

## 2. 当前真实进度

### 2.1 main 分支

`main`（`f19ec7d`）包含**原来的 Fixture 原型，代码完整可运行**（`src/` 分析器、候选执行、验证回执、工作台 UI 均在，近三次提交为 `docs(...)` 文档）。新版 Project-first 核心（领域契约重构、真实项目闭环）在 PR #2；近期功能开发（MEDIA 溯源、四视口验证）在各自 feature 分支上以 PR #2 为基线。

### 2.2 PR #2 已真实实现（有代码 + 测试支撑）

| 能力 | 证据 |
|---|---|
| Project-first 领域契约（ProjectRevision / SourceGraph / EditSession / ScopeDecision / CandidatePatch / VerificationRun / VerificationEvidence） | `src/core/model.ts`（全文） |
| 会话状态机及全部转换不变量（draft→…→applied/rolled-back；越界转换拒绝；已应用会话不可变） | `src/core/session.ts`；`session.test.ts` |
| 真实 Git Worktree 隔离候选：字节级检出核对、补丁哈希、树摘要、漂移检测、失败回滚清理 | `src/core/candidate.ts:373-433` |
| 候选完整性/时效断言（worktree 标记、patchHash 复算、禁止未记录变更） | `candidate.ts:435-466` |
| TEXT 共享来源修改（source-proven 影响闭包校验，非确定边 fail-closed） | `candidate.ts:334-367`；`scope.ts:38-101` |
| TEXT 页面局部覆盖：`override:<uuid>` 注册表 v2、`RippleText` JSX 锚点、幂等 AST 变换（Provider/import 注入与清理可重复执行） | `page-overrides.ts` 全文；`candidate.ts:227-332` |
| 分析器产出 `data`（JSX 字面量）、`token`（CSS 变量定义与消费）、`media`（资产引用字面量）节点及 `source-proven`/`semantic-candidate` 边 | `project.ts:224/245/268/327/346-376` |
| 浏览器验证契约规范化（路径穿越防护、bounded text、仅 button/link 可交互） | `verification-contract.ts` 全文 |
| 验证回执信任边界（执行器身份、哈希链、stale 失效）与必需断言集（7 项） | `verification-receipt.ts`；`model.ts:6` |
| Docker 化候选验证执行器与候选预览运行器 | `verification-runner.ts`、`candidate-preview*.mjs` |
| 工作台 UI（ProjectWorkbench、EvidencePanel、VerificationContractEditor 等）及配套测试 | `src/app/*` |

### 2.3 部分实现（接口在场、闭环未通）

| 能力 | 现状与缺口 |
|---|---|
| MEDIA 操作 | `EditKind` 含 `'MEDIA'`，`candidate.ts:70` 允许 `media` 节点走共享路径——但仅能做**源字面量**（import 路径/URL 字符串）替换。二进制资产（真实图片文件替换、新资产落盘、资产 hash）无任何通道：`EditOperation.before/after: string` 无法承载字节，`CandidatePatch` 无附属工件字段。这正是 P1-DESIGN-01 的核心缺口。 |
| TOKEN 操作 | `token` 节点可产，共享字面量替换可行；但 **CSS cascade/局部覆盖/computed style 消费验证**未实现，`css-cascade` 边类型在 `scope.ts:3-10` 被当消费边，但分析器未产出（grep 全仓库无 `addEdge(..., 'css-cascade'`）。 |
| 多视口浏览器验证 | runner 存在，但 `ScopePropagationObservation.operations` 逐操作断言目前以 **markerText 包含匹配**为通过条件（`session.ts:143-150`），是文本语义；MEDIA 的几何/裁切断言、TOKEN 的颜色对比度断言**无对应观测结构**。 |
| 页面覆盖（跨资源） | 明确拒绝：`candidate.ts:77-78`——"当前页面覆盖只支持具有确定页面消费者的 JSX 文本；MEDIA/TOKEN 和非目标页面尚不支持覆盖"。 |

### 2.4 未实现 / 无法确认

- MEDIA 资产流水线：上传、格式校验、焦点/裁切配置、响应式变体（B 第二包仅有最基础的资产替换演示）。
- TOKEN 传播分析（cascade、局部覆盖、连续修改冲突）。
- 真实第三方工程适配（当前仅本机已分析 React/Vite 工程；TanStack Start 未接触）。
- CI 在 PR #2 上无运行记录（§1）。
- Bolt 验收工作流（`bolt-acceptance.yml`）的运行环境依赖未在 B 本机复现。

---

## 3. B 第二包模块复用方案（逐模块）

| 模块 | 处置 | 理由 |
|---|---|---|
| `tools/lib/graph.ts`（ts-morph 四层图抽取） | **迁移算法，重新实现集成** | 核心思路（Route→Instance→Slot→Source、绑定链追踪）正确且已在 12 组 fixture 上 P/R/F1=1.0；但输出是私有 `RippleGraph@1`，与 `SourceGraph` 契约不同构；`SLOT_NAMES` 等站点配置需改为项目内可发现机制。新实现直接产出 `SourceGraph` 节点/边（含 certainty 分级），不保留 RippleGraph 类型。 |
| `tools/lib/preview.ts`（Playwright 三视口渲染 + DOM 几何 + 媒体自然尺寸/object-fit/可见裁切比） | **原样保留算法，改造接口** | 这是 P0 MEDIA 验证的核心资产：自然尺寸、objectFit、可见裁切比例采集已真实运行（`evidence/view-*-candidate.json`）。改造为 `VerificationExecutor` 的观测提供者，输出映射为 `VerificationEvidence` + 扩展的几何观测结构。 |
| `tools/lib/assert.ts`（Overflow / ViewportEscape / ProtectedOverlap / ContainerEscape 四类布局断言） | **原样复用，补失败/边界测试** | 真实检测出 375px 标题与按钮重叠（E-VIEW-001）；逻辑与资源类型无关，可直接服务 MEDIA/TOKEN 布局验证。 |
| `tools/lib/pipeline.ts`（worktree 沙箱/构建/预览/截图 diff/证据落盘） | **部分废弃，部分迁移** | worktree 隔离、补丁产出已由 `candidate.ts` 以更严格形式实现（哈希链、漂移检测），**不保留两套**；保留其中的"构建→起预览服务→Playwright 采集→证据落盘"执行编排，迁入验证执行器。截图像素 diff 只作辅助，不作通过依据（与任务书一致）。 |
| `tools/lib/adapter.ts`（B 内部 ↔ A 旧契约 RealCasePackage） | **废弃替代** | 含大量硬编码映射（`SOURCE_ID_MAP`、`QG_INSTANCE`、`fromACandidate` 的 if/else 链、caseId 枚举），属于任务书明令禁止的"特定案例名称判断"。其 evidence 字段设计（measurement.slots 的 rect/media/style）有价值，思想融入契约扩展，代码不迁移。 |
| `tools/lib/graphCache.ts` | **废弃** | 由 core 的 revision digest 机制替代。 |
| `server/index.ts`（HTTP API） | **废弃替代** | 旧架构的独立服务形态；新架构下 B 能力是库函数 + 执行器，由 A 的工作台经 core API 调用，不另起平行服务。 |
| `contracts/`（五个接口样例） | **废弃** | 对应已被 A 新契约取代的 `src/domain/contracts`。 |
| `tools/extract.ts`、`run-case.ts`、`fixtures*.ts` | **改造为验收 CLI** | 继续作为真实回归入口，但底层改调 core 分析/候选/验证，直接产出 `SourceGraph`/`VerificationRun`。 |
| `docs/integration.md`、`docs/third-party-audit.md` | **保留为输入材料** | 第三方候选仓库审计结论（§P2）仍然有效，需复查冻结版本。 |
| 青野/栖光测试站（`sites/qiguang`、`src/content`） | **保留为 P0 真实测试工程** | 共享海报 + 共享标题 + Token 三消费点的结构正好覆盖 MEDIA/TOKEN/负例三需求。 |

**结论：不存在两个竞争的 SourceGraph / Scope / Evidence 真相来源。B 的私有模型全部退役，分析结果直接产出 A 的 `SourceGraph`。**

---

## 4. 对扩展契约提案与审查意见的逐项回应

审查基线 `2b96235`；本回应基于更新后的 `91b0b83`（含其后 4 个提交，均为 Bolt 检出凭据安全加固，不改变契约面）。

### 4.1 P1-DESIGN-01（MEDIA/TOKEN 操作负载）——**调整（Adjust）**

**接受**审查诊断：`EditOperation.before/after: string` 确实只能表达受限文本/字面量替换（`candidate.ts:344-367` 按源偏移整体替换），无法表达二进制资产、焦点坐标、响应式变体、CSS 声明结构化修改。

**不接受**"把复杂负载编码成 JSON 字符串塞进 after"的妥协方向，也**不接受**新建平行 Operation 状态机。负责人已接受"增加结构化 MEDIA/TOKEN 负载"的方向；以下按"真正的 TypeScript 判别联合"书写，并**接受 A 在 PR #3 评论（19:01 / 19:37）提出的兼容边界**（`payload` 不得对 MEDIA/TOKEN 全体强制——现状的受限字面量路径必须继续可用）。五项设计决策已由 A/B 确认，最小接口于 PR #2 `f2aeadf4b21d8936df593f14261728a8a05e65d8` 冻结为 `ripple-edit-operation-session/v1`：

```ts
// 公共字段：所有变体共享（漂移校验、回滚、覆盖语义不变）
interface EditOperationBase {
  id: Id
  targetRef: Id
  before: string            // 源码基线值（供漂移校验与回滚语义）
  after: string             // 候选值（源码级投影；字面量路径不变）
  overrideAction?: 'remove'
}

// 简单操作（payloadless）：现状行为，接口与执行路径完全不动。
// TEXT/CODE 永远禁止 payload；MEDIA/TOKEN 仅限已支持的受限字面量替换路径
//（import 路径 / URL 字符串 / token 值字符串，candidate.ts 按源偏移整体替换）。
export type EditOperation =
  | (EditOperationBase & { kind: 'TEXT'; action?: never; payload?: never })
  | (EditOperationBase & { kind: 'CODE'; action?: never; payload?: never })
  | (EditOperationBase & { kind: 'MEDIA'; action?: never; payload?: never })
  | (EditOperationBase & { kind: 'TOKEN'; action?: never; payload?: never })
  // 结构化操作：显式 action 判别子 + 必需 payload；缺失/畸形/未知 subtype 一律
  // fail-closed 拒绝（session/candidate 校验），不得退回字符串替换。
  | (EditOperationBase & { kind: 'MEDIA'; action: 'asset-swap'; payload: MediaAssetSwapPayload })
  | (EditOperationBase & { kind: 'TOKEN'; action: 'local-projection'; payload: TokenLocalProjectionPayload })

export interface MediaAssetSwapPayload {
  assetRef: string          // 候选树内相对路径，如 assets/hero.autumn.webp
  assetHash: string         // SHA-256，与 CandidatePatch 同一哈希纪律
  focalPoint?: { x: number; y: number }                        // 0..1 归一化
  variants?: Array<{
    mechanism: 'srcset' | 'picture' | 'css' | 'container-rule'  // 真实消费机制，须项目侧存在
    condition: string                                           // 如 '(max-width: 640px)' 或断点名
    assetRef: string
    assetHash: string
  }>
  containerHint?: { selector: string; aspect: number }         // 目标容器，供验证断言
}
export interface TokenLocalProjectionPayload {
  declarationRef: Id        // CSS 变量定义节点（现有 token 节点即可承担）
  value: string             // 新值
  localScope: { pageRef: Id; mechanism: 'css-override' | 'style-prop' }  // 局部覆盖机制，由项目自然机制承担
}
```

**最小可执行例子**（简单操作今天就能跑；结构化操作在执行器落地前被显式拒绝）：

1. **简单 MEDIA（payloadless，现状路径）**：`import hero from './assets/hero.jpg'` → `after: "./assets/hero.autumn.jpg"`（纯字面量替换；若新资产需在候选树内，由资产暂存流程负责，不经 payload）。
2. **结构化 MEDIA asset-swap**（未实现前拒绝）：共享海报换 WebP 并带焦点——`action: 'asset-swap'`，`payload: { assetRef: 'assets/festival.poster.autumn.webp', assetHash: '<sha256>', focalPoint: { x: 0.5, y: 0.35 } }`；预期三页四视口均加载成功，cover 裁切实测。
3. **结构化 TOKEN local-projection**（未实现前拒绝）：青野 `brand.accent` 仅首页局部改色——`action: 'local-projection'`，`payload: { declarationRef: 'token:src/styles/tokens.css#…', value: '#c0392b', localScope: { pageRef: 'page:home', mechanism: 'css-override' } }`；预期活动页/专题页 computed color 保持基线。

**最小改动点与 fail-closed 行为**：

- `model.ts`：上述联合类型与 payload 接口（仅此一处类型变更）。
- `session.ts`：`addOperation` 校验——TEXT/CODE 带 `payload`/`action` → 拒绝；MEDIA/TOKEN 带未知 `action` 或已知 action 缺/畸形 `payload` → 拒绝（报错说明缺什么）；不静默降级。
- `candidate.ts`：执行器对 payloadless 走 `candidate.ts:344-367` 现状路径；结构化 subtype 在其执行器与证据测试落地前统一拒绝（占位分支，防"类型上声称、执行上静默"）。
- `verification-runner.ts`：asset-swap 的 targetBindings 后续需补资产加载断言（variants 按声明的 mechanism 逐条验证），未实现前对应断言保持 NOT_RUN/UNKNOWN。
- **资产字节纪律**：`assetRef + assetHash` 必须指向候选 worktree 内实际 staged 的内容；导入/写入路径与 hash 校验纳入既有 `patchHash`/`candidateTreeDigest`/`assertCandidateIntegrity` 纪律，不新增信任面；应用/回滚随唯一 CandidatePatch。
- **无平行生命周期**：结构化操作仍进同一 EditSession / Scope / CandidatePatch / VerificationRun / 审批 / 应用 / 回滚。

设计理由：

- **资产作为候选树文件**（放 worktree 内，随补丁产出），`assetRef + assetHash` 参与 `patchHash`/`candidateTreeDigest` 既有纪律，不新增信任面；`assertCandidateIntegrity` 无需新概念即可复核。
- `before/after` 保留源码级语义（如 import 路径字符串替换），`payload` 只承载源码表达不了的结构化意图，二者同生同校验。
- 单判别联合类型而非 `EditOperation` 泛型化，避免触碰 `session.ts` 既有不变量结构。

**复现用例（来自 B 第二包真实场景）**：
1. **MEDIA 共享替换**：栖光 `festival.shared.poster`（首页/节目页/购票卡共享海报，B 包2 已验证 3 实例消费）→ 新 WebP 资产 + 焦点 (0.5, 0.35)；预期：三页 1440/768/375 均加载成功，cover 裁切可见比例 ≥ 阈值或有如实 risk 报告。
2. **MEDIA 局部消费覆盖**：仅 `/program` 页海报改独立素材（assets 路径字面量在该页消费点不同），其余页 protected；预期：其余页截图与基线完全一致（B 包2 Scope 执行已做到 diff=0，需在 new core 复证）。
3. **TOKEN 传播负例**：青野 `brand.accent` 陶土 Token 被首页 CTA、活动页 CTA、专题页徽章消费；只改声明应三处全变；若声明未单一定义（多候选）必须 `unknown` 拒绝，不得猜。

### 4.2 P1-DESIGN-02（局部覆盖规则）——**接受生命周期模型，拒绝 RippleText 泛化**

**接受**可共享部分：`page-overrides.ts` 的注册表生命周期设计（持久 `override:<uuid>` 目标 ID、fallback 关联、schema v2 校验、幂等 AST 注入与清理、最后一项规则移除时完整还原）质量高，**规则 ID / 目标身份 / 优先级 / 失效 / 清理 / 历史**这一生命周期骨架应作为跨资源覆盖的公共底座。

**拒绝**把图片/样式强塞进 `RippleText` 式运行时组件注入。理由（代码依据）：`RippleText` 方案依赖两个 TEXT 专属前提——JSX 文本节点的 fallback 可被运行时组件无损替换（`candidate.ts:267-281`），以及页面状态由 `state === 'label'` 字面量映射（`candidate.ts:160-169`，`routeStateMapping` 要求页面状态唯一确定）。媒体与样式不满足此前提：图片消费点是 `<img src>`/CSS background/组件 props 三种异质形态，强行组件化会把业务 JSX 改得面目全非，违背"优先使用原项目自然机制"（任务书 §五.2）。

**建议调整（2026-10-18 修订：暂不迁移 registry v2）**：资源中立的局部覆盖生命周期方向被接受，但**现阶段不大规模迁移 TEXT 已稳定的 registry v2**。先用 MEDIA/TOKEN 真实任务证明需要怎样的结构，重点验证两个未决问题：

1. **目标 ID 跨源码修改的稳定性**：`override:<uuid>` 目标 ID 以 SourceGraph 节点为锚；MEDIA/TOKEN 编辑（资产替换、CSS 变量改值）会改变节点值甚至节点集合，需实测 registry 规则在源码演进后仍指向同一逻辑目标（现有 v2 对 TEXT 的 `fallback` 关联机制能否原样复用）。
2. **结构化覆盖值**：TEXT 的覆盖值是字符串；MEDIA 的覆盖值含 `assetRef/focalPoint/variants`，TOKEN 含 `value/localScope`，registry 的 schema 校验与幂等变换需要容纳结构化值而不破坏 v2 的校验器。

验证完成后再决定是否抽象 `OverrideRegistry`（schema v3，迁移工具从 v2 升级）。届时建议的规则形态（供讨论，非冻结）：

```ts
interface OverrideRule {
  id: string                     // override:<uuid>，跨资源不变
  targetRef: Id                  // SourceGraph 节点（data/media/token 均可）
  original: string               // 共享基线值
  pageRef: Id                    // 局部作用页面
  value: string                  // 页面生效值（MEDIA/TOKEN 可为 JSON 化结构化值）
  projection: 'ripple-text' | 'asset-config' | 'css-custom-property' | 'style-prop'
  updatedAt: string
}
```

- TEXT 继续走 `RippleText` projection（现有代码不动）。
- MEDIA 局部覆盖走 `asset-config`：在项目既有媒体配置/props 数据结构上写页面级取值（栖光海报槽位已是 `FestivalPoster src` prop 结构，天然适配），不新增运行时组件。
- TOKEN 局部覆盖走 `css-custom-property`/`style-prop`：在项目既有 CSS 变量体系内为单页作用域生成局部声明，cascade 规则由浏览器计算，Ripple 只验证 computed style。
- **冲突与维护**：同一 target 的页面规则集合可枚举、可 diff、可整体回滚；连续修改产生的规则由执行器校验"共享来源与当前 registry 一致"（现有 `candidate.ts:248` 机制直接泛化）。

**复现用例**：青野 `brand.accent` 仅首页改局部强调色 → 活动页/专题页徽章 computed color 保持基线值（浏览器实测），首页为新值；规则清理后 CSS 恢复单一声明。

### 4.3 P1-DESIGN-03（适配 capability）——**接受，采用能力矩阵**

**接受**审查意见：`supports(): boolean` 不足以表达支持程度。建议：

```ts
interface AdapterCapabilities {
  projectReadable: boolean | 'unknown'
  analyzable: { graph: boolean; media: boolean; token: boolean } | 'unknown'
  runnable: boolean | 'unknown'   // 能否安装依赖并启动
  editable: Array<EditKind>       // 可可靠生成候选的资源类型
  verifiable: { viewports: Array<{ width: number; height: number }>; interactions: boolean; geometry: boolean } | 'unknown'
  reasons: string[]               // 每项不支持/未知的原因，fail-closed
}
```

- 首轮支持矩阵（2026-10-18 晚已用 `analyzeProject` 对两个真实仓库实测更新，探针脚本与复现命令见本节末尾）：

| 工程 | 可读/分析 | 可运行 | TEXT | MEDIA | TOKEN | 备注 |
|---|---|---|---|---|---|---|
| 青野/栖光（自有 React/Vite，锁定版本） | ✅ | ✅ | ✅ | ✅(P0 目标) | ✅(P1 目标) | B 包2 已实测 |
| 青野 Bolt 基线 `ripple-qingye-bolt@f7e4998` | ✅ 571 节点 / 496 边 / unresolved=0 | 待验 | 结构可达 | ⚠️ 见下方实测-1 | 结构可达 | 路由经 App.tsx 状态字面量识别，4 页全中 |
| Lovable TanStack Start `mountain-spirit-showcase@f838ae3` | ⚠️ 部分：701 节点但 **route=0**、unresolved=16 | 待验 | 受阻 | ❌ 无 media 节点 | 结构可达 | 见下方实测-2 |
| 任意 React/Vite 第三方工程 | ✅/部分 | 待验 | 待验 | 待验 | 待验 | P2，逐仓库冻结版本后填 |

**实测-1（青野 MEDIA 的真实风险）**：13 个 media 节点全部是外部 Pexels URL；`asset-consumer` 边仅 1 条 `source-proven`、26 条 `semantic-candidate`。按 `scope.ts:72-76` 的 fail-closed 规则，对这些外部图做 MEDIA 修改会因非确定消费边被**拒绝生成候选**。即：当前 core 下青野的图改不动——这是 P0 必须解决的真实 blocker（需要把 JSX `src={...}` 绑定链的 certainty 升级机制做出来，或明确降级为不支持并如实上报）。

**实测-2（TanStack Start 的两个具体适配缺口）**：
1. 路由识别为零：分析器路由检测依赖 App.tsx 内 `state === 'label'` 字面量映射（`project.ts:415`），TanStack Start 的文件路由（`src/routes/*.tsx` + `router.tsx`）不满足该范式，产出 0 个 route 节点——共享/覆盖编辑的影响闭包无从谈起。
2. 路径别名未解析：`@/assets/*.jpg` 形式的 16 个 import 全部进入 `graph.unresolved`，且 `?url` 后缀（`../styles.css?url`）同样未处理。无 route 节点时这些 unresolved 不毒化影响闭包，但一旦路由识别补上，它们将按 `scope.ts:82-92` 变为拒绝条件。

**复现方式**：`npx vitest run src/core/b-capability-probe.test.ts`（探针含 qingye/mountain 两组断言与 JSON 输出；脚本由 B 在开发分支提供，本文不夹带代码）。

- `supports` 保持 fail-closed：任一关键项为 `unknown` 时，UI 与执行器不得展示为"支持"。

### 4.4 对提案五个确认问题的回答

1. **职责兼容性**：兼容。B 现有实现可映射——`ProjectAdapter.analyze` ← B 分析器（改造后产出 SourceGraph）；`CandidateExecutor` ← `createCandidate`（B 侧补 MEDIA/TOKEN 执行路径）；`VerificationExecutor` ← B 的 preview/assert/pipeline 编排改造。B 不新增平行接口。
2. **runtimeFingerprint**：**单独随运行记录提供**。指纹保持字符串摘要不变（避免破坏 `session.ts:94` 的相等性校验）；Node 版本、包管理器、锁文件 digest、启动命令组成 `RuntimeEnvironment` 记录在 VerificationRun 的 execution 区块。理由：环境信息随 run 演进，指纹是修订级身份，混用会导致合法运行被误拒。
3. **RuntimeSourceMap 实例级观测**：B 可在 MEDIA 验证中提供按 candidate hash + runtimeFingerprint + page/viewport/state 绑定的观测记录（preview.ts 的几何采集天然带这些键）；但**iframe 自报 instance ID 不作为编辑授权**这一点完全同意，B 的观测只作为 `runtime-observed` 确定性的证据，写入影响闭包仍只认 `source-proven`。
4. **共享 fallback vs 页面实际值**：确认可保留区分。B 的验证断言将消费 `expectedTextForPage`/`expectedTextForScope`（`scope.ts` 唯一纯计算入口），不复制 Scope 分支规则；MEDIA/TOKEN 的对应期望值计算将加在同一入口（扩展为 `expectedValueForPage`），UI 展示"共享来源值 / 当前页面生效值"两栏。
5. **focal point / responsive variants**：B 第二包**不具备**成熟 focal/variants 能力（仅有单资产替换演示）。建议 P0 采用 Shopify 式焦点坐标 + 项目自然响应式机制（`srcset`/CSS），不自研变体生成；如后续引入图像处理依赖，先提交许可与依赖审查。

### 4.5 冻结的最小契约测试范围（`ripple-edit-operation-session/v1`）

以下范围对应 PR #2 `f2aeadf` 已实现且通过完整 CI #161 的代码，是 `ripple-edit-operation-session/v1` 的冻结测试边界。A/B 已确认 §4.6 五项技术决策；A 确认下列回归足以冻结目前已实现的最小接口。B 可立即按该 schema 开始 MEDIA `asset-swap`，不必等待资产执行器完成；后续执行器新增的字节、裁切与 Evidence 测试属于实现验收，不扩大或重开 v1。实现位于 `src/core/model.ts`、`session.ts` 及现有 Scope、candidate、verification 测试，不新增平行测试框架。

1. **简单操作兼容与类型边界**：TEXT/MEDIA/TOKEN/CODE 的 payloadless 操作继续可用；所有 payloadless 变体均禁止意外 `action` 与 `payload`，TypeScript 与运行时 JSON 输入都覆盖。
2. **结构化操作判别与 Session 错误**：MEDIA `asset-swap` 与 TOKEN `local-projection` 的 action/payload 必须匹配；缺失、畸形、未知 action 或不匹配 kind 按结构化错误拒绝，并包含稳定的 `code` 与字段 `path`。JSON 往返后仍按同一 schema 校验。合法但未实现的结构化执行器返回 `unsupported-operation`，不得降级到字符串替换。
3. **Scope 与候选边界**：excluded/protected、未知/非 source-proven 来源 fail-closed；拒绝发生在候选副作用之前。候选操作必须与当前 Session 完全一致，并绑定 Scope 决策 ID/版本、源版本及补丁哈希。
4. **验证状态边界（仅现有执行器能力）**：运行记录中的四视口计划、实际检查与截图必须一致；未运行/缺证据不能成为 PASS。现有文本流程的证据还须绑定实际 CandidatePatch、Scope、源码和 runtime fingerprint。该测试不代表 MEDIA 资产字节或裁切 Evidence 已验收。
5. **现有 TEXT 覆盖回归**：页面覆盖连续新增、更新、复用和移除保持既有幂等性；它是独立的 TEXT 维护回归，不扩展为本次新增 MEDIA/TOKEN registry v3 契约。

以上共享回归已在 PR #2 `f2aeadf` 的 Actions #161 通过：27/27 测试文件、130/130 单测、类型检查、构建通过；Playwright 9 passed / 1 skipped / 0 failed（唯一跳过为私有真实 Bolt 专项）。该结果是冻结基线，不替代 B 后续 MEDIA 执行器的纵向验收。

**明确不纳入当前冻结/验收**：新资产字节进入候选 worktree、资产字节 SHA-256 被复算并纳入 CandidatePatch、篡改字节后拒绝、focal point 实际裁切、variants 按 `srcset`/`picture`/`css`/`container-rule` 运行、MEDIA 专属视觉/几何 Evidence。payload schema 接受某个字段，不等于其执行、字节真实性或浏览器效果已验收；这些由 B 在 asset-swap 实现中补充真实资产、候选、四视口和可信 Evidence 回归。

### 4.6 A/B 决策及实施边界（2026-10-19 冻结）

| 项目 | 决定 / 状态 |
|---|---|
| subtype 名称 | 冻结为 MEDIA `asset-swap`、TOKEN `local-projection`。 |
| Session 校验错误 | 冻结为 `{ error, code, path? }`；code 为 `invariant-violation` / `invalid-operation` / `unsupported-operation`，path 使用如 `operations[0].payload.assetHash` 的字段路径。 |
| variants mechanism | 最小枚举冻结为 `srcset`、`picture`、`css`、`container-rule`；`condition` 必填。机制/条件与真实消费者无法证明匹配时保持 UNKNOWN。 |
| CSS Token Scope 证据 | 文件级 imports/uses-token 只表达模块依赖，不证明某页面消费具体 token；只有组件/路由级 cascade 消费边可证明具体影响，其他来源保持 unknown/semantic-candidate。沿用 PR #2 对应负例，不由此冻结 B 后续分析实现。 |
| runtimeFingerprint / RuntimeEnvironment | `runtimeFingerprint` 保留在 ProjectRevision 并复制至 VerificationRun 做匹配；详细 `RuntimeEnvironment` 由受信执行器记录在 `VerificationRun.execution`，不伪造未采集字段。 |
| 操作生命周期 | 结构化操作仍属于同一 EditSession / Scope / CandidatePatch / VerificationRun / Approval / Apply / Rollback；不新建第二套生命周期。 |
| 简单路径 | 现有 payloadless TEXT/MEDIA/TOKEN/CODE 字面量操作保持兼容；任何 payloadless 操作带上 `action` 或 `payload` 都拒绝。 |
| 结构化执行状态 | Session 能校验 schema；结构化 MEDIA/TOKEN 执行器尚未实现时明确返回 unsupported，不回退到字符串路径。 |
| TEXT OverrideRegistry | 保留现有 v2；本次不迁移 registry v3。 |

**版本边界**：`ripple-edit-operation-session/v1` 冻结在 PR #2 `f2aeadf4b21d8936df593f14261728a8a05e65d8`。扩展该判别联合、错误模型或现有简单操作语义需提出兼容性变更；MEDIA 执行器可在不改变该最小 Session 生命周期的前提下实现已声明的 `asset-swap` payload。

**尚未验收的实现**：MEDIA 资产暂存/实际字节完整性/应用回滚资产语义、焦点和响应式裁切、媒体加载与几何 Evidence；TOKEN `local-projection` 执行器及 computed-style 证据；MEDIA/TOKEN 的跨资源 OverrideRegistry v3。它们不在 v1 当前实现验收范围内，应由相应执行器提交后另行验收。
---

## 5. 与 A 的职责边界

| 归属 | 内容 |
|---|---|
| A（不动） | `src/core/model.ts`、`session.ts` 的状态机与不变量；`page-overrides.ts` 的 TEXT 路径与注册表底座；工作台 UI；验证契约编辑器 |
| B（主责） | 分析器 MEDIA/TOKEN 节点与边补强（`project.ts` 及新增模块）；MEDIA/TOKEN 候选执行路径（`candidate.ts` 扩展，**先向 A 说明再动**）；验证执行器几何/颜色观测与断言（`verification-runner.ts` 及 B 迁移模块）；青野/栖光/第三方工程适配；验收 CLI |
| 共享接口（当前边界） | `EditOperation`/Session 最小接口已按 `ripple-edit-operation-session/v1` 冻结；`OverrideRule`/registry v3、`VerificationEvidence` 几何扩展、`AdapterCapabilities` 与期望值扩展仍需真实执行场景验证，不属于本次冻结 |
| 易冲突文件 | `src/core/model.ts`、`candidate.ts`、`page-overrides.ts`、`scope.ts`、`verification-runner.ts`——**B 在契约 PR 合并前不修改这些文件**，实验代码放 B 分支独立目录验证 |

---

## 6. 正式开发顺序

1. **（已完成）最小接口冻结**：A/B 已确认 §4.6 五项决定，负责人批准冻结 `ripple-edit-operation-session/v1`（PR #2 `f2aeadf4b21d8936df593f14261728a8a05e65d8`）；共享测试范围见 §4.5，完整 CI #161 为该基线提供证据。不另开“冻结 OverrideRule”的任务。
2. **（可开始）MEDIA `asset-swap` 执行器**（B）：按冻结 payload/schema 进入既有 EditSession/Scope/CandidatePatch 生命周期；真实字节暂存、完整性、应用/回滚、裁切与 Evidence 需在该执行器交付时单独实测验收，未完成前继续 fail-closed。
3. **后续纵向验收**：在青野/栖光真实工程完成来源分析（import/资源路径/CSS background，区分确定/动态/不确定）→ Scope → 隔离候选（含真实资产字节）→ **四视口**浏览器验证（1440×900、768×1024、375×812、390×844；加载、自然尺寸、裁切/焦点、容器断言及 protected 页面保持）→ Candidate-bound Evidence。实际未运行项保持 `NOT_RUN`/`UNKNOWN`。
4. **P1 TOKEN**：CSS 变量来源追踪 + cascade/computed style 消费验证 + 局部覆盖 + 对比度。
5. **P2 第三方适配**：复查 B 包2 的第三方审计冻结候选（shadcn/电商候选，`_audit/` 有快照），逐仓库填能力矩阵。

顺序依据：MEDIA 闭环能同时打通资产工件、几何观测、局部覆盖三个契约扩展，是 TOKEN 与适配的共同地基；先冻结契约再开发，避免 §2.3 的"接口在场闭环未通"重演。

---

## 7. 代码与架构质量风险

| 等级 | 风险 | 证据 | 建议 |
|---|---|---|---|
| 高 | `candidate.ts` 的页面覆盖路径与共享路径耦合在同一函数族，扩展 MEDIA/TOKEN 时容易堆特判 | `candidate.ts:76-90` 的 kind/strategy 判断矩阵已呈扇形 | 契约冻结 PR 中将其拆为 per-kind 执行器注册表，core 只做 Scope 校验与调度 |
| 高 | 验证断言以 markerText 包含匹配为通过条件，MEDIA/TOKEN 需要结构化观测 | `session.ts:143-150` | 断言判据按 kind 分派（文本包含 / 几何阈值 / computed style），保留同一 VerificationRun 外壳 |
| 中 | `routeStateMapping`/`appRouteExpression` 依赖 `state === 'label'` 唯一字面量，对 TanStack Start 等路由范式不成立 | `candidate.ts:153-169` | P2 前不宣称通用；能力矩阵如实标 unknown |
| 中 | `verification-runner.ts` 的 Docker 执行在 Windows 本机不可用（B 实测环境无 Docker/WSL2 就绪） | 任务书 §八允许区分环境 | B 首轮回退到受限本机执行 + 证据标注环境；不谎称 Docker 验证 |
| 低 | `.ripple/overrides-runtime.js` 内容与契约绑定校验会拒绝手工改动（`candidate.ts:313`） | 设计如此，记录即可 | 保持；文档注明 `.ripple/` 为 Ripple 管理目录 |

---

## 8. Git 分支与集成方案

- **对齐文档**：`docs/b-engineering-alignment`（本 PR），基线 `91b0b83`。
- **B 开发分支**（契约冻结后创建）：`feat/b-media-verification-20261018`，基于届时双方确认的同一 commit。
- B 不推 main、不合并/重写 A 的分支；PR #2 继续变化时，先对齐公共接口再 rebase，不盲合核心状态机。
- 每完成一个纵向功能提一个可审查 PR，PR 描述含基线 SHA、改动清单、实跑命令与结果、Evidence 位置、已知限制。

---

## 9. 测试与验收方案（P0 MEDIA 首轮）

- **测试工程**：栖光（`festival.shared.poster` 3 消费点 + 归档页独立海报负例）+ 青野（`brand.accent` 3 消费点），锁定 commit 写入 PR。
- **用户任务**：①共享海报换新素材（含焦点）；②仅单页海报换独立素材；③protected 页面零变化。
- **视口矩阵（四视口统一方案）**：`1440×900`（桌面）、`768×1024`（平板竖屏）、`375×812`（手机）、`390×844`（手机大屏）。每项检查的结果进入 Candidate-bound Evidence（按 candidateId/patchHash/viewport/state 绑定）；**未执行的检查一律标注 `NOT_RUN` / 状态 `UNKNOWN`，不得省略或默认通过**。B 包2 遗留的三视口证据（1440/768/375）标记为历史数据，仅作参考，不充当本轮验收。
- **关键断言**：资产加载成功；自然尺寸/裁切比例/容器矩形采集；ProtectedOverlap 等四类布局断言；其余页与基线像素无关性通过 DOM/几何等价证明；证据 candidateId/patchHash/viewport/state 绑定可复算。
- **环境**：Windows 本机（node + Playwright channel: msedge，复用 B 包2 已验证方案），结果如实标注非 Docker。
- **命令**：`npm ci && npm run typecheck && npm test -- --run && npm run build`，浏览器测试单独运行并记录。

### 9.1 最小纵向验收场景（待 MEDIA 执行器实现后运行；不属于 v1 冻结测试）

以青野共享海报替换为例，覆盖"真实 MEDIA 操作 + 受保护页负例"全链路，接口输入输出如下（可原样改写为契约测试）：

**输入**
- SourceGraph 片段（真实节点）：`media:src/assets/festival.shared.poster.jpg`，3 个消费点（首页/节目页/购票卡，均 source-proven）；归档页消费的是另一独立媒体节点，不在本操作影响闭包。
- 冻结接口上的结构化操作：`{ kind: 'MEDIA', action: 'asset-swap', targetRef: <媒体节点>, before: './assets/festival.shared.poster.jpg', after: './assets/festival.poster.autumn.jpg', payload: { assetRef, assetHash, focalPoint, variants } }`。当前 Session 校验 payload，但 candidate executor 对未实现 action fail-closed；资产字节暂存和焦点/variants 执行尚未验收。
- Scope 声明：受保护页列表（如归档页）+ excluded 规则。

**预期验收链（当前尚未实现，不能视为已运行）**：执行器落地后再执行 `stageOperations` → SourceGraph/Scope 闭包校验（影响闭包 = 3 页，归档页不在闭包）→ 在隔离 Candidate worktree 暂存真实字节并复算字节 SHA-256、`patchHash`/`candidateTreeDigest` → `verification-runner` 按四个共享视口执行 → 受信 Evidence 落盘。当前 `asset-swap` 仅通过 Session schema 校验，候选执行器仍 fail-closed；不得从该流程图推断已有候选或浏览器验收。

**未来验收记录的最低预期（示意结构，不是当前 CandidatePatch/VerificationRun 的现存字段）**
- 候选必须引用实际 staged 资产，并由候选完整性校验复算字节摘要；任何 `assetManifest` 设计需在执行器实现中与现有 `CandidatePatch` 同一补丁哈希语义核对后再纳入契约。
- `VerificationRun` 按受影响页面 × 实际执行视口记录受信检查与证据，绑定 `candidateId`、`patchHash`、Scope 版本、页面状态、精确 viewport、运行环境和 artifact digest。断言包括 asset-loaded、natural-size、crop/focal behavior、container bounds、protected-unchanged；未执行为 `NOT_RUN`，无法证明为 `UNKNOWN`，不得映射成 PASS。
- 受保护页负例：Scope 校验直接拒绝该操作作用到归档页；若操作合法但归档页在运行范围内，其 evidence 必须显示 `protected-unchanged` PASS。

---

## 10. 预计交付（首个开发 PR）

完成真实 MEDIA 分析→候选→四视口验证→Evidence 纵向闭环（§9 三任务 + §9.1 冒烟任务全通过），涉及：分析器媒体边补强、MEDIA 执行路径 + `MediaAssetSwapPayload`、几何观测扩展、验收 CLI 迁移。**不包含** TOKEN、第三方适配、工作台 UI——这些在后续 PR 按 §6 顺序推进。

---

*本报告所有"已实现"判断均以 PR #2 `91b0b83` 实际源码与测试文件为依据；"未实现/未知"项在获得相反证据前保持该判定。*
