# B 组工程对齐与实施方案

**日期**：2026-10-18
**作者**：B（thisisCarys + 开发 AI）
**状态**：待负责人与 A 评审；确认前不代表 B 开始修改共享核心代码
**基线**：`feat/project-first-core-20261018` @ `91b0b83dd32cd294e1202ee6a7ce65374bf07765`
**输入材料**：A《Project-first 扩展契约提案》（`docs/architecture/project-first-extension-contract-proposal-2026-10-18.md`）、PR #2 独立审查评论（comment-6250535989）、B 第二份交付包 `ripple-B-package2-2026-10-14.tar.gz`（SHA-256 `fceb17feb7ee4af3d537e233df74c0a4a874828dc1472a589776cae7f9463956`）

---

## 1. 审计基线与证据来源

本次对齐基于以下真实源码，非 README 推断：

- `main` @ `f19ec7d`（仅文档提交，见 §2.1）
- PR #2 @ `91b0b83`，58 个提交，状态 **OPEN / Draft**
- 逐文件阅读：`src/core/model.ts`、`session.ts`、`candidate.ts`、`scope.ts`、`page-overrides.ts`、`project.ts`、`verification-contract.ts`、`verification-runner.ts`、`page-overrides.test.ts`、`session.test.ts` 等
- B 第二包全部源码（`tools/lib/graph.ts`、`adapter.ts`、`pipeline.ts`、`preview.ts`、`assert.ts`、`server/index.ts`，共约 2100 行）与其 evidence 产出物

**CI 事实**：仓库存在 `.github/workflows/ci.yml` 与 `bolt-acceptance.yml`，但 `gh pr checks 2` 返回 *no checks reported on the 'feat/project-first-core-20261018' branch*。即 **PR #2 当前没有任何已报告的 CI 检查运行记录**——审查评论中"此前 CI 对已覆盖路径通过"的说法，与 GitHub 当前可见状态不符，需 A 确认是触发条件未命中还是检查结果已过期。B 后续验证结论一律以本机实跑为准，不以"CI 曾绿"作为依据。

---

## 2. 当前真实进度

### 2.1 main 分支

`main`（`f19ec7d`）近三次提交全部为 `docs(...)`，**不含可运行核心代码**。可运行的一切都在 PR #2。

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

**不接受**"把复杂负载编码成 JSON 字符串塞进 after"的妥协方向，也**不接受**新建平行 Operation 状态机。建议的最小契约改动：

```ts
export interface EditOperation {
  id: Id
  kind: EditKind
  targetRef: Id
  before: string            // 保持：源码基线值（供漂移校验与回滚语义）
  after: string             // 保持：候选值（源码级投影；字面量路径不变）
  overrideAction?: 'remove'
  payload?: MediaOperationPayload | TokenOperationPayload   // 新增：类型判别负载
}
export interface MediaOperationPayload {
  discriminant: 'media'
  assetRef: string          // 候选树内相对路径，如 assets/hero.autumn.webp
  assetHash: string         // SHA-256，与 CandidatePatch 同一哈希纪律
  focalPoint?: { x: number; y: number }                    // 0..1 归一化
  variants?: Array<{ viewport: 'mobile' | 'tablet' | 'desktop'; assetRef: string; assetHash: string }>
  containerHint?: { selector: string; aspect: number }     // 目标容器，供验证断言
}
export interface TokenOperationPayload {
  discriminant: 'token'
  declarationRef: Id        // CSS 变量定义节点（现有 token 节点即可承担）
  value: string             // 新值
  localScope?: { pageRef: Id; mechanism: 'css-override' | 'style-prop' }  // 局部覆盖机制，由项目自然机制承担
}
```

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

**建议调整**：把 `PageOverrideRegistry` 抽象为资源中立的 `OverrideRegistry`（schema v3，迁移工具从 v2 升级）：

```ts
interface OverrideRule {
  id: string                     // override:<uuid>，跨资源不变
  targetRef: Id                  // SourceGraph 节点（data/media/token 均可）
  original: string               // 共享基线值
  pageRef: Id                    // 局部作用页面
  value: string                  // 页面生效值
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

- 首轮支持矩阵（B 基于第二包实测给出，非承诺）：

| 工程 | 可读/分析 | 可运行 | TEXT | MEDIA | TOKEN | 备注 |
|---|---|---|---|---|---|---|
| 青野/栖光（自有 React/Vite，锁定版本） | ✅ | ✅ | ✅ | ✅(P0 目标) | ✅(P1 目标) | B 包2 已实测 |
| 任意 React/Vite 第三方工程 | ✅/部分 | 待验 | 待验 | 待验 | 待验 | P2，逐仓库冻结版本后填 |
| Lovable TanStack Start | ❌ 无访问权限 | unknown | unknown | unknown | unknown | **B 当前无仓库权限，已向负责人申请**；获批前全部记 unknown |

- `supports` 保持 fail-closed：任一关键项为 `unknown` 时，UI 与执行器不得展示为"支持"。

### 4.4 对提案五个确认问题的回答

1. **职责兼容性**：兼容。B 现有实现可映射——`ProjectAdapter.analyze` ← B 分析器（改造后产出 SourceGraph）；`CandidateExecutor` ← `createCandidate`（B 侧补 MEDIA/TOKEN 执行路径）；`VerificationExecutor` ← B 的 preview/assert/pipeline 编排改造。B 不新增平行接口。
2. **runtimeFingerprint**：**单独随运行记录提供**。指纹保持字符串摘要不变（避免破坏 `session.ts:94` 的相等性校验）；Node 版本、包管理器、锁文件 digest、启动命令组成 `RuntimeEnvironment` 记录在 VerificationRun 的 execution 区块。理由：环境信息随 run 演进，指纹是修订级身份，混用会导致合法运行被误拒。
3. **RuntimeSourceMap 实例级观测**：B 可在 MEDIA 验证中提供按 candidate hash + runtimeFingerprint + page/viewport/state 绑定的观测记录（preview.ts 的几何采集天然带这些键）；但**iframe 自报 instance ID 不作为编辑授权**这一点完全同意，B 的观测只作为 `runtime-observed` 确定性的证据，写入影响闭包仍只认 `source-proven`。
4. **共享 fallback vs 页面实际值**：确认可保留区分。B 的验证断言将消费 `expectedTextForPage`/`expectedTextForScope`（`scope.ts` 唯一纯计算入口），不复制 Scope 分支规则；MEDIA/TOKEN 的对应期望值计算将加在同一入口（扩展为 `expectedValueForPage`），UI 展示"共享来源值 / 当前页面生效值"两栏。
5. **focal point / responsive variants**：B 第二包**不具备**成熟 focal/variants 能力（仅有单资产替换演示）。建议 P0 采用 Shopify 式焦点坐标 + 项目自然响应式机制（`srcset`/CSS），不自研变体生成；如后续引入图像处理依赖，先提交许可与依赖审查。

### 4.5 契约冻结前需 A/B 共同通过的契约测试（B 提议）

1. **序列化往返**：`EditOperation`（含 payload）+ `OverrideRule` 序列化/反序列化无损。
2. **Scope 拒绝**：MEDIA/TOKEN 操作指向 excluded/protected、非 source-proven 影响闭包、缺失 AST 位置——全部拒绝且不产生 worktree 副作用。
3. **多操作候选**：同文件多区间 + 资产文件 + 覆盖规则混合候选，patchHash/candidateTreeDigest 可复算。
4. **补丁/证据一致性**：篡改资产字节、patch、截图工件分别导致 `assertCandidateIntegrity` / 回执校验失败。
5. **覆盖维护幂等**：同一覆盖连续执行两次、全部规则移除后源码与 registry 与基线完全一致。

---

## 5. 与 A 的职责边界

| 归属 | 内容 |
|---|---|
| A（不动） | `src/core/model.ts`、`session.ts` 的状态机与不变量；`page-overrides.ts` 的 TEXT 路径与注册表底座；工作台 UI；验证契约编辑器 |
| B（主责） | 分析器 MEDIA/TOKEN 节点与边补强（`project.ts` 及新增模块）；MEDIA/TOKEN 候选执行路径（`candidate.ts` 扩展，**先向 A 说明再动**）；验证执行器几何/颜色观测与断言（`verification-runner.ts` 及 B 迁移模块）；青野/栖光/第三方工程适配；验收 CLI |
| 共享接口（需双方确认后冻结） | `EditOperation`（+payload）、`OverrideRule`/registry v3、`VerificationEvidence` 几何扩展、`AdapterCapabilities`、期望值纯计算入口 |
| 易冲突文件 | `src/core/model.ts`、`candidate.ts`、`page-overrides.ts`、`scope.ts`、`verification-runner.ts`——**B 在契约 PR 合并前不修改这些文件**，实验代码放 B 分支独立目录验证 |

---

## 6. 正式开发顺序

1. **（当前）对齐 PR 评审**：负责人 + A 确认本报告与契约改动。
2. **契约冻结 PR**：A/B 共同提交 §4.5 契约测试并冻结 `EditOperation.payload`、`OverrideRule` 两个最小扩展。
3. **P0 MEDIA 闭环**（B）：青野/栖光真实工程上完成 媒体来源分析（import/资源路径/CSS background 三类，区分确定/动态/不确定）→ Scope → 隔离候选（含资产文件）→ 1440/768/375 真实浏览器验证（加载、自然尺寸、裁切比例、object-position、容器溢出断言、protected 页面不变）→ Evidence 全链 → 交付 A 工作台所需数据接口。
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
- **关键断言**：资产加载成功；自然尺寸/裁切比例/容器矩形采集；ProtectedOverlap 等四类布局断言；其余页与基线像素无关性通过 DOM/几何等价证明；证据 candidateId/patchHash/viewport/state 绑定可复算。
- **环境**：Windows 本机（node + Playwright channel: msedge，复用 B 包2 已验证方案），结果如实标注非 Docker。
- **命令**：`npm ci && npm run typecheck && npm test -- --run && npm run build`，浏览器测试单独运行并记录。

---

## 10. 预计交付（首个开发 PR）

完成真实 MEDIA 分析→候选→三视口验证→Evidence 纵向闭环（§9 三任务全通过），涉及：分析器媒体边补强、MEDIA 执行路径 + `MediaOperationPayload`、几何观测扩展、验收 CLI 迁移。**不包含** TOKEN、第三方适配、工作台 UI——这些在后续 PR 按 §6 顺序推进。

---

*本报告所有"已实现"判断均以 PR #2 `91b0b83` 实际源码与测试文件为依据；"未实现/未知"项在获得相反证据前保持该判定。*
