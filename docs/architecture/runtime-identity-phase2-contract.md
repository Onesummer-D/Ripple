# Runtime Identity 阶段二合同提案（C+D → A）

> C+D 出具，2026-10-24，v2 修订。基线：`feat/a-final-integration-20261023 @ 2f2e5a7`
> （AC-P2a/b 已随 `ce7bc60` 进入 A 集成候选）。本文件只提合同与证据，不改任何门控。
> 真实采集原型：`scripts/runtime-identity-phase2-proto.mjs`；
> 实测证据：`docs/probes/runtime-identity-phase2-proto-20261024.json`（exit 0，8 场景 9 组断言全过）。
>
> v2 响应 A/C+D 联合评审（PR #34）与 E 复审三项 P0/P1：①评估结构改为逐实例一对多；
> ②与 E PR #34（`docs/architecture/e-identity-phase2-prep-20261024.md`）对齐统一合同；
> ③新增跨版本实例对应证明章节；④原型补强 search/hash 三元组负例与跨版本双侧负例；
> ⑤收录五项接口裁决建议与实施分工。

## 1. 背景与问题

Runtime Identity 阶段一已交付：页面内自包含采集器 `collectRuntimeIdentitySnapshot`、宿主评估
`assessRuntimeIdentity`、严格证明判定 `instanceIdentityProven`（充要条件见
`sourcegraph-runtime-identity-contract.md` §1）。阶段二要回答的唯一问题是：

**RuntimeIdentityAssessment 如何进入真实 VerificationRun，并保持可追溯、可降级、不被消费方自行升级。**

A 集成候选中 E 的视觉证据已经打了一个样：`VerificationRun.visualEvidences?: VisualRunEvidence[]`
（`model.ts`），按 `checkId/route/viewport/state` 键控、结果永不为 pass、工件带 sha256。
阶段二身份合同沿用同一先例。

## 2. P0-1：逐实例一对多评估结构（修订）

**问题**：一份 snapshot 的 `records[]` 可含多个不同实例；v1 提案每运行点只挂单一
`assessment`，一个实例证明成功会连带升级同视口其他未证明实例。E PR #34 §1.4 独立发现
同一缺口（`visual-geometry.ts:640` 以 assessment 非空为条件且全作用域共用一个对象）。

**修订后的正式结构**（提案字段，A 冻结后实现；类型全部现网已有）：

```ts
// VerificationRun 增量：
//   runtimeIdentities?: RuntimeRunIdentity[]

export interface RuntimeRunIdentity {
  checkId: Id                              // 对应 VerificationCheck.id（采集运行点）
  route: string                            // 页面 ref（page:<path>），来自验证合同
  viewport: { width: number; height: number }
  state: string                            // 运行点状态名（与 visualEvidences 同键控）
  side: 'baseline' | 'candidate'           // 侧别：fileDigest 按侧绑定，绝不混用（E §1.3 要求①）
  /** 原始采集快照（纯数据、可序列化、可哈希）。 */
  snapshot: RuntimeIdentitySnapshot        // protocol ripple-runtime-identity/v1
  snapshotSha256: string
  /** 逐实例评估：snapshot.records 每个实例恰好一条，见下。 */
  assessments: RuntimeInstanceAssessmentEntry[]
  /** 侧别绑定的来源文件摘要读取器产物（诊断用，不替代按次核验）。 */
  sourceDigests: Record<string, string>    // file -> sha256(utf8 内容)，本运行点涉及文件
  artifacts: { snapshot: { path: string; sha256: string } }
}

export interface RuntimeInstanceAssessmentEntry {
  sourceRef: string                        // 与 snapshot record 一一对应
  runtimeInstanceId?: string
  side: 'baseline' | 'candidate'           // 冗余携带，防止条目被跨侧误用
  assessment: RuntimeIdentityAssessment    // assessRuntimeIdentity 逐实例产出
  assessmentSha256: string
}
```

**硬规则**：

1. `assessments.length === snapshot.records.length`（逐实例独立绑定 sourceRef +
   runtimeInstanceId + side）；宿主对每个 record 各调一次 `assessRuntimeIdentity`。
2. **一个实例证明成功不得升级同一视口下其他未证明实例**；消费方必须按键
   `(side, sourceRef | runtimeInstanceId)` 查单条，禁止以数组非空、`certainty` 稳定档、
   双侧 id 字符串相等或配对成功代替 `assessment.instanceIdentityProven === true`。
3. E 的 `strictInstanceProofAvailable` 判定位（`visual-geometry.ts:640`）必须逐对核验
   `instanceIdentityProven === true`；`missingEvidence` 为空数组不得单独升级
   （裁决③，§9）。
4. 归档失败的运行点不得静默省略：侧别缺失或版本不可核对的条目以带原因形式保留
   （与 E「缺失证据不发明」语义一致，E §1.3 要求③）。

**侧别组织形式**：本提案采用「每运行点每侧一条 `RuntimeRunIdentity`」+ 显式 `side` 字段。
E PR #34 §1.3 建议的双侧分组 `{checkId, viewport, state, baseline, candidate}` 同样满足
要求，且与视觉证据的双侧比较天然对齐。两者择一由 A 冻结；差异只在归档形状，评估语义不变。

## 3. 字段与版本绑定关系图

```
VerificationRun
└─ runtimeIdentities[]            键控：checkId × route × viewport × state × side
   ├─ snapshot                    浏览器采集（collectRuntimeIdentitySnapshot）
   │   ├─ page {pathname,search,hash}        ← 采集时刻 URL（RuntimePageContext）
   │   └─ records[] { sourceRef, runtimeInstanceId?, certainty, sourceVersion?,
   │                   domNode, sameSourceCount, reasons, label? }
   │        sourceVersion 注册值 = sha256(transform 输入代码 utf8)   ← 插件写入页面注册表
   ├─ sourceDigests               宿主 fileDigest(root, file) = sha256(文件内容 utf8)   ← 同口径
   ├─ assessments[]               宿主对每个 record 各调一次 assessRuntimeIdentity：
   │   { sourceRef, runtimeInstanceId?, side, assessment, assessmentSha256 }
   │        instanceIdentityProven = locatable && id非空 && id≠sourceRef && reasons为空
   └─ artifacts.snapshot.sha256   原始快照工件哈希（可追溯、防篡改复核）

绑定关系（四重关联，E §1.3 要求②）：
  运行点      checkId × route × viewport × state × side ⇔ manifest.visualCaptures[] 键一致，可按运行点回查
  工程版本    side='baseline' → projectRoot / baseSourceDigest；side='candidate' → candidateRoot /
              candidateTreeDigest；两侧绝不混用；快照条目本身可核对其声称的版本
  页面身份    snapshot.page 三元组 == 该运行点 descriptor 的 route/suffix；宿主归档时即可校验，
              不一致归档为带原因条目（page-context-mismatch）
  工件哈希    snapshot/geometry/截图 SHA-256 并列记录；snapshot 可序列化、可哈希，绑定具体字节

  graph.revision.sourceDigest ─┬─ 决定 sourceRef 是否 in-graph（locatable 前置）
                               └─ 与 candidate.baseSourceDigest 对齐（生命周期校验，A 域）
  record.sourceVersion == fileDigest(record.sourceFile)  ⇔ 无 source-version-mismatch
  snapshot.page == expectedPage（caller 给出）           ⇔ 无 page-context-mismatch/unverified
```

## 4. P0-2：跨版本实例对应证明（四支柱）

**问题**：两侧实例身份各自成立后，如何进一步证明 baseline 与 candidate 元素是「同一实例的
两个版本」？不能仅凭两个 `runtimeInstanceId` 字符串一致就宣布跨版本严格证明——必须考虑：

- 相同 id 但组件重新挂载（domNode 变化 ≠ 身份变化，但也不是自动连续）；
- React key 或实例命名空间变化（身份不连续）；
- 源码偏移变化（文本改动使字节偏移移动，但 JSX 来源未变）；
- 同源组件多实例（id 各自唯一，字符串相等恰恰说明可能混淆）；
- 两侧 Assessment 结果不一致（一侧 proven 一侧降级）。

**跨版本严格对应 = 四支柱同时成立**（原型 `proveCrossVersionPair` 已按此实现并实测）：

| 支柱 | 条件 | 承担的风险 |
|---|---|---|
| ① 双侧独立证明 | baseline、candidate 各自按**自己侧别**的 graph + fileDigest + expectedPage 评估，且 `instanceIdentityProven === true`、`reasons` 为空 | 版本混用、单侧降级被掩盖 |
| ② 图侧来源对应 | 两侧 `sourceRef` 在各自 SourceGraph 上对应同一 JSX 来源节点（图节点对应/digest 承担偏移变化） | 源码偏移变化被误判为不同来源 |
| ③ 生命周期连续 | 对该实例 id，`compareRuntimeSnapshots(baselineSnapshot, candidateSnapshot)` 无 removed→added 断裂；重挂载（同 id 不同 domNode）视为连续；key/命名空间变化视为不连续 | 重挂载、key 变化被误认或漏认 |
| ④ 理由干净 | 两侧 assessment `reasons` 均为空 | 一侧带隐藏降级原因 |

**判定规则**：

- 任一支柱不成立 → 该**对**整体降级为「跨版本候选配对」（沿用 E 阶段一的 annotation-pairing
  措辞），降级原因逐条列出（如 `candidate-unproven`、`source-ref-not-corresponding`、
  `lifecycle-discontinuity`）。
- `runtimeInstanceId` 字符串相等**既不必要也不充分**：不等时若四支柱成立仍可证明
  （重挂载再生成 id 的情形）；相等时若任一支柱失败仍必须降级。
- 一对不合格不污染其他对：配对判定在逐实例条目（§2）之上进行，键为
  `(baselineEntry, candidateEntry)` 的 sourceRef 对应关系，不是全视口布尔值。

## 5. 采集点、绑定与降级

1. **采集运行点**：与视觉证据同粒度——每个（check, route, viewport, state, side）。浏览器侧由
   验证容器在 attested 运行后注入采集器并执行（原型用 Vite dev + Playwright 实现同一链路）。
2. **绑定**：运行点键控 + 快照内 page 三元组 + 侧别 sourceDigests（四重关联见 §3）。
   side 决定 fileDigest 读 `candidate.projectRoot` 还是 `candidate.candidateRoot`。
3. **宿主调用**：唯一入口 `assessRuntimeIdentity`，由宿主验证编排调用（非 E）；E 不得自造
   assessment（§7）。
4. **留存**：快照与逐实例 assessment 双哈希（内联 + 工件）；reasons 原文保留，禁止清空或重写。
5. **降级矩阵**（单实例级；跨版本配对降级见 §4）：

| 情形 | reasons | locatable | instanceIdentityProven | 允许操作 |
|---|---|---|---|---|
| 快照缺失（运行点未采集） | （无 assessment，字段缺该运行点） | — | — | E 标 not-run；不得引用实例 |
| 来源版本读取失败 | source-version-unavailable | 保持 true* | false | 源码导航 |
| 图与 served 版本不一致 | source-version-mismatch | false | false | 仅报错，任何定位拒绝 |
| 同文件多版本（HMR/重评估） | source-version-ambiguous | false | false | 仅报错 |
| expectedPage 未给出 | page-context-unverified | true* | false | 源码导航 |
| 实际页 ≠ expectedPage（pathname/search/hash 任一给出且不等） | page-context-mismatch | true* | false | 源码导航 |
| certainty 非稳定档 | identity-not-stable | true* | false | 源码导航（position-dependent 可入图） |
| 采集期即降级（dup/stale/key 不可用等 6 项阻断词表） | 原样保留 | 视词表 | false | 按 §7 只读 |

\* locatable 只看 in-graph ∧ 无版本冲突 ∧ 无版本歧义，与实例证明独立。

## 6. E 的正式消费接口

1. E **只读** `runtimeIdentities[].assessments[]`，按键 `(side, sourceRef | runtimeInstanceId)`
   查单条；严格实例证明的唯一合法判定是该条 `assessment.instanceIdentityProven === true`。
2. E 不得构造、改写、合并 assessment 或 assessments 数组；`identityReasons` 原文展示。
3. 跨版本配对升级只能来自 §4 四支柱的宿主判定回执；E 的视觉配对可继续使用自己的 sampler
   数据，但对外表述必须区分「运行时标注支持的跨版本候选配对」与「C+D 完整身份评估的
   实例证明」。
4. `sameSourceCount > 1` 时 UI 必须并列提示「同源渲染 N 处，改源影响全部」（E §2 矩阵 #2 一致）。
5. page-context 缺失标记的移除条件沿用 `e-pr30-identity-contract-confirmation.md` §3.2 三条件
   （samePage 全等 + expectedPage.pathname ∈ sourceProvenPageImpact.pageRefs +
   无 route-namespace-stale）；search/hash 缺失项的清除需三元组全等（裁决④建议，§9）。
   条件满足前一律保持列出。

## 7. 最小真实实例测试矩阵（原型实测值，exit 0）

| # | 场景 | certainty | instanceIdentityProven | locatable | reasons | 实测 |
|---|---|---|---|---|---|---|
| 1 | 单一静态 JSX 元素 | stable-react-instance | true | true | [] | ✅ |
| 2 | 同源组件多稳定 keyed 实例（business key） | stable-keyed-instance ×2（id 唯一区分，sameSourceCount=2） | true | true | [] | ✅ |
| 3 | 无稳定 key 重复列表（index key） | position-dependent | **false** | true | identity-not-stable | ✅ |
| 4 | React 重新挂载（key 保持） | stable-keyed-instance | true（重挂后重新评估） | true | []；lifecycle=removed→remounted（同 id 不同 DOM 节点） | ✅ |
| 5 | 同源组件不同页面 | stable-react-instance | true（逐页 expectedPage） | true | []；错页评估 → false + page-context-mismatch | ✅ |
| 6 | 图可定位但实例不可证明 | position-dependent | false | **true** | identity-not-stable | ✅（同 #3 断言） |
| 7 | 文件版本不一致 / 页面上下文不匹配 | （保持原档） | false | 版本不一致 → **false**；页面不匹配 → true | source-version-mismatch / page-context-mismatch | ✅ |
| 8 | 运行时身份不稳定（随机 key 重挂即变） | unknown | false | true | identity-not-stable | ✅ |
| 9 | search/hash 三元组负例（expectedPage 给出 search/hash 而实际页不符） | stable-react-instance | **false** | true | page-context-mismatch；完整三元组给出且全等 → true | ✅（v2 新增） |
| 10 | 跨版本双侧独立评估与配对 | stable-react-instance | candidate 侧按己侧评估 true；误按 baseline 版本核验 → **false** | 后者 false | source-version-mismatch；四支柱配对：双 proven → 配对成立，candidate 降级 → 配对降级（`candidate-unproven` 等） | ✅（v2 新增） |

静态来源证明（SourceGraph 边）与运行实例证明全程独立：#3/#6/#8/#9 均 locatable=true（可导航）
而 instanceIdentityProven=false；#7/#10 版本不一致时连定位也关闭。

场景 ↔ 原型 check() 对应：8 场景 9 组断言（#3 与 #6 共用 position-dependent 断言组；
#9 为 search 与 hash 两个负例 + 一个全等正例打包在一组）。

## 8. 原型运行方式与工程发现

```bash
node --experimental-transform-types --loader ./scripts/ts-extension-loader.mjs \
  scripts/runtime-identity-phase2-proto.mjs [output.json]
# exit 0 = 8 场景 9 组断言全过；2 = 有场景未达预期（证据已归档）
```

四个对 A/E 重要的工程事实（原型中实测确认）：

1. **digest 口径**：插件注册的 `sourceVersion` = `sha256(transform 的输入代码, utf8)`，即
   **原始文件内容哈希**，不是标注后输出（`source-annotation.ts` 在注入注册码时用输入 `code`
   计算）。宿主 `fileDigest` 必须使用同一 recipe。建议 A 把它冻结为一个公共纯函数
   （如 `servedSourceDigest(root, file)`），避免容器侧/候选侧各自实现导致口径漂移。
2. **baseline digest 必须冻结**：原型曾共用同一目录模拟两侧，活读磁盘的 fileDigest 在文件
   修改后拿到 candidate 内容，版本不一致负例无从触发（v2 首轮实测踩坑）。正式合同由
   候选工作树与基线 projectRoot 物理分离保证；但宿主仍应在运行开始时按侧固化 digest
   （memo），不支持运行中途活读。
3. **序列化陷阱**：`collectRuntimeIdentitySnapshot.toString()` 内含字符串 `'__reactFiber$'`；
   用 `String.replace` 注入 HTML 时 `$'` 是特殊替换模式，必须用函数形式 replacer
   （本原型注入已用函数 replacer；候选预览桥的 `insertCandidateBridge` 走模板字面量，不受影响）。
4. **samePage 为逐字段可选语义**（`runtime-identity.ts:160-163`）：expectedPage 未给出的字段
   不比较。因此「pathname 强制 + search/hash 可选」只是调用方传参问题，不是判定函数缺陷；
   严格证明路径宿主必须传完整三元组（裁决④，§9）。

## 9. A/C+D 联合评审五项裁决（C+D 建议稿，待 A 冻结）

| # | 接口 | 裁决建议 | 实现负责 |
|---|---|---|---|
| ① | `VerificationRun.runtimeIdentities` 数据结构 | §2 逐实例一对多 + 显式侧别；侧别组织（每侧一条 vs 双侧分组）由 A 二选一；四重关联（§3）为条目硬性要求 | A 冻结字段，C+D 出身份判定 |
| ② | 宿主 `assessRuntimeIdentity()` 调用位置 | 宿主验证编排（非 E），attested 运行后、运行记录定稿前；fileDigest 按侧（projectRoot/candidateRoot）运行开始时 memo 固化；expectedPage 从验证合同 descriptor 的 route 派生 + 实际 URL 三元组 | A 冻结接线，C+D 出派生规则 |
| ③ | 严格实例证明逐对判定 | 逐实例条目核验 `instanceIdentityProven === true`（修复 `visual-geometry.ts:640` 非空即真缺口）；`missingEvidence` 为空不单独升级；view 措辞升级规则（含 `sameSourceCount>1` 必附警示）由 A 冻结，F 会签文案 | E 实现判定修复，A 冻结措辞，F 会签 |
| ④ | page-context 完整验证与 missingEvidence 清除 | **建议**：严格证明路径要求三元组全等（宿主传完整 expectedPage）；导航定位维持宽松（pathname 即可）；search/hash 缺失项的清除以三元组全等为条件；清除判定由宿主评估后代核，E 只消费结论不自核 | A 裁决严格度，C+D 出条件，E 消费 |
| ⑤ | 九项验收矩阵进联合 CI | C+D 原型工作流覆盖 #1-#8 + #9/#10（本仓库 `agent-c-runtime-identity-phase2.yml`，真实 Chromium）；快照缺失/候选重跑过期/多视口不一致归 E 容器矩阵；A 在集成预演汇总联合验收 | C+D 原型 10 项，E 容器矩阵，A 汇总 |

## 10. 实施分工（正式记录）

- **C+D**：身份判定逻辑（assessRuntimeIdentity、四支柱跨版本配对）、版本与页面上下文合同、
  原型与词表测试。
- **A**：`VerificationRun` 数据结构冻结、验证容器与宿主接线合同、公共生命周期与
  Scope/Candidate 门控（实例级授权不进阶段二，D6）。
- **E**：容器侧 snapshot 按运行点归档、视觉证据消费宿主评估回执、跨版本配对 View 扩展
  （additive、只读）。
- **F**：严格证明状态与降级原因的 UI 展示（proofLabel 逐字渲染约定不变，文案会签）。

## 11. E 启动阶段二编码的授权结论（给 A）

C+D 意见：**合同冻结 ①②③ 后正式授权 E 启动阶段二编码**，顺序按 E §6：
容器归档 → 宿主评估 → 浏览器矩阵 → View 扩展。此前 E 保持文档与测试设计，不动核心写入
路径。④的严格度裁决可与 ①②③ 并行，不阻塞 E 的归档与接线开发；E 在 ④ 冻结前不清除
任何 search/hash 缺失标记。

## 12. 需要 A 冻结的决策项

| # | 决策项 | C+D 建议 |
|---|---|---|
| D1 | 采用方案 A：`VerificationRun.runtimeIdentities` 字段 + §2 类型 | 是，沿 visualEvidences 先例 |
| D2 | digest recipe 冻结为公共函数（§8.1） | 是，含输入编码（utf8）、哈希算法（sha256） |
| D3 | 谁写 `runtimeIdentities`：宿主验证编排（非 E），attested 运行后、运行记录定稿前写入 | 宿主写，E 只读 |
| D4 | 原始快照工件落盘位置与保留期 | 与视觉工件同目录同保留期 |
| D5 | 字段冻结前的过渡：先按 Evidence 工件归档，冻结后双写迁移 | 可接受 |
| D6 | 实例级授权接入 Candidate/Scope 的时机 | 不在阶段二；仍按原合同走 A 核心 Scope + 候选生命周期 |

## 13. 原型与正式 Docker VerificationRun 归档的差距（P1）

原型是**本地 Vite dev + 单页 SPA、无 data-router、无候选容器**的最小真实链路；正式接线还需：

1. **attested 运行容器**：采集须挂到 `candidate-verification-runner.mjs` 的真实运行点后，
   snapshot 按 (checkId, viewport, state, side) 键控归档进 VerificationRun（原型只写本地 JSON）。
2. **版本绑定的物理分离**：正式环境 baseline=projectRoot、candidate=candidateRoot 天然分离；
   宿主仍按 §8.2 在运行开始时按侧 memo 固化 digest。
3. **data-router 页面身份**：原型按 pathname 分场景；正式 expectedPage 从验证合同 descriptor
   派生，路由命名空间校验沿用阶段一合同（route-namespace-stale 等词表）。
4. **digest recipe 公共化**：容器插件与宿主读取必须使用同一公共函数（D2），否则
   source-version-mismatch 误报。
5. **多视口/多状态**：原型每场景单视口；正式矩阵归 E 容器工作流（§9-⑤）。

## 14. 未解决限制

- 原型未覆盖 data-router 动态段（`:orderId`）下的命名空间行为；机制上归入 #8 同一
  fail-closed 类（route-coverage / unknown），联合验收时由 A 的集成预演补真实路由样例。
- `position-dependent` 实例可入 RuntimeSourceMap 导航，但 `resolveRuntimeElement` 拒绝其作为
  实例目标——阶段二未改变该行为。
- 快照 records 规模受页面标注元素数约束；极端大页面需运行点拆分（与视觉合同同策略）。
- 跨版本四支柱中的「图侧来源对应」目前以 sourceRef 字符串相等为最小实现；正式实现应由
  A 的图侧节点对应（含偏移变化的 digest/节点映射）承担，C+D 在 SourceGraph 侧配合。
