# Runtime Identity 阶段二合同提案（C+D → A）

> C+D 出具，2026-10-24。基线：`feat/a-final-integration-20261023 @ 2f2e5a7`（已确认远端实际 HEAD；
> AC-P2a/b 已随 `ce7bc60` 进入 A 集成候选）。本文件只提合同与证据，不改任何门控。
> 真实采集原型：`scripts/runtime-identity-phase2-proto.mjs`；
> 实测证据：`docs/probes/runtime-identity-phase2-proto-20261024.json`（exit 0，8 场景全过）。

## 1. 背景与问题

Runtime Identity 阶段一已交付：页面内自包含采集器 `collectRuntimeIdentitySnapshot`、宿主评估
`assessRuntimeIdentity`、严格证明判定 `instanceIdentityProven`（充要条件见
`sourcegraph-runtime-identity-contract.md` §1）。阶段二要回答的唯一问题是：

**RuntimeIdentityAssessment 如何进入真实 VerificationRun，并保持可追溯、可降级、不被消费方自行升级。**

A 集成候选中 E 的视觉证据已经打了一个样：`VerificationRun.visualEvidences?: VisualRunEvidence[]`
（`model.ts`），按 `checkId/route/viewport/state` 键控、结果永不为 pass、工件带 sha256。
阶段二身份合同沿用同一先例。

## 2. P0：两种方案对比与建议

### 方案 A：`VerificationRun` 增加正式 `runtimeIdentities` 字段（推荐）

```ts
// 提案字段（新增公共字段，A 冻结后实现；类型全部现网已有）
export interface RuntimeRunIdentity {
  checkId: Id                              // 对应 VerificationCheck.id（采集运行点）
  route: string                            // 页面 ref（page:<path>），来自验证合同
  viewport: { width: number; height: number }
  state: string                            // 运行点状态名（与 visualEvidences 同键控）
  side: 'baseline' | 'candidate'           // 侧别：fileDigest 按侧绑定，绝不混用
  /** 原始采集快照（纯数据、可序列化、可哈希）。 */
  snapshot: RuntimeIdentitySnapshot        // protocol ripple-runtime-identity/v1
  snapshotSha256: string
  /** 宿主侧正式评估结果；E/F 只允许消费此对象，不得自算。 */
  assessment: RuntimeIdentityAssessment    // 见 runtime-identity.ts；instanceIdentityProven 唯一严格证明
  assessmentSha256: string
  /** 侧别绑定的来源文件摘要读取器产物（诊断用，不替代按次核验）。 */
  sourceDigests: Record<string, string>    // file -> sha256(utf8 内容)，本运行点涉及文件
  artifacts: { snapshot: { path: string; sha256: string } }
}
// VerificationRun 增量：
//   runtimeIdentities?: RuntimeRunIdentity[]
```

### 方案 B：不改领域模型，复用既有 Evidence 工件

快照与评估 JSON 落盘为工件，`VerificationEvidence.artifactHash` 记哈希；VerificationRun 不增字段。

### 对比

| 维度 | A：正式列表字段 | B：仅 Evidence 工件 |
|---|---|---|
| 与 `visualEvidences` 先例一致性 | 完全同构（键控/只读/带哈希） | 视觉走字段、身份走工件，双口径 |
| E/F 消费成本 | 直接读类型化字段，无法"顺手"改语义 | 每消费方自行解析工件，易私造升级路径 |
| 门控可审计性 | assessment + 哈希在运行记录内，Approval 复核一眼可见 | 需跳工件查找 |
| 模型改动 | +1 字段 +1 类型（均纯数据） | 0 |
| 工件冗余 | 快照同时内联+落盘（内联有界：records ≤ 页面标注元素数） | 只落盘 |

**C+D 建议：方案 A**。理由：身份评估是 VerificationRun 的一等结果（决定实例级证据可否被
F 点选引用），不是附属工件；先例已在 A 集成候选落地，风险最小。方案 B 可作过渡：
字段冻结前，宿主先按 B 归档，字段落地后双写一次即迁。

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
   ├─ assessment                  宿主 assessRuntimeIdentity(graph, snapshot, record, {
   │                              fileDigest, expectedPage })        ← 唯一生产入口
   │   instanceIdentityProven = locatable && id非空 && id≠sourceRef && reasons为空
   └─ artifacts.snapshot.sha256   原始快照工件哈希（可追溯、防篡改复核）

绑定关系：
  graph.revision.sourceDigest ─┬─ 决定 sourceRef 是否 in-graph（locatable 前置）
                               └─ 与 candidate.baseSourceDigest 对齐（生命周期校验，A 域）
  record.sourceVersion == fileDigest(record.sourceFile)  ⇔ 无 source-version-mismatch
  snapshot.page == expectedPage（caller 给出）           ⇔ 无 page-context-mismatch/unverified
```

## 4. 采集点、绑定与降级（P0-1..P0-5 的回答）

1. **采集运行点**：与视觉证据同粒度——每个（check, route, viewport, state, side）。浏览器侧由
   验证容器在 attested 运行后注入采集器并执行（原型用 Vite dev + Playwright 实现同一链路）。
2. **绑定**：运行点键控（checkId/route/viewport/state/side）+ 快照内 page 三元组 + 侧别
   sourceDigests。side 决定 fileDigest 读 `candidate.projectRoot` 还是 `candidate.candidateRoot`。
3. **宿主调用**：唯一入口 `assessRuntimeIdentity`；E 不得自造 assessment（§6）。
4. **留存**：快照与 assessment 双哈希（内联 + 工件）；reasons 原文保留，禁止清空或重写。
5. **降级**：见 §5 矩阵。任何缺失/过期/不匹配 → `instanceIdentityProven=false` + 具体 reason，
   视觉证据仍可作只读辅助（与视觉合同一致：永不为 pass）。

## 5. 降级矩阵（缺失/过期/不匹配/不稳定）

| 情形 | reasons（新增项） | locatable | instanceIdentityProven | 允许操作 |
|---|---|---|---|---|
| 快照缺失（运行点未采集） | （无 assessment，字段缺该运行点） | — | — | E 标 not-run；不得引用实例 |
| 来源版本读取失败 | source-version-unavailable | 保持 true* | false | 源码导航 |
| 图与 served 版本不一致 | source-version-mismatch | false | false | 仅报错，任何定位拒绝 |
| 同文件多版本（HMR/重评估） | source-version-ambiguous | false | false | 仅报错 |
| expectedPage 未给出 | page-context-unverified | true* | false | 源码导航 |
| 实际页 ≠ expectedPage | page-context-mismatch | true* | false | 源码导航 |
| certainty 非稳定档 | identity-not-stable | true* | false | 源码导航（position-dependent 可入图） |
| 采集期即降级（dup/stale/key 不可用等 6 项阻断词表） | 原样保留 | 视词表 | false | 按 §6 只读 |

\* locatable 只看 in-graph ∧ 无版本冲突 ∧ 无版本歧义，与实例证明独立。

## 6. E 的正式消费接口

1. E **只读** `runtimeIdentities[].assessment`；严格实例证明的唯一合法判定是
   `assessment.instanceIdentityProven === true`。禁止以对象非空、`certainty` 稳定档、
   双侧 id 相等或配对成功代替之。
2. E 不得构造、改写、合并 assessment；`identityReasons` 原文展示。
3. E 的视觉配对可继续使用自己的 sampler 数据，但对外表述必须区分
   「运行时标注支持的跨版本候选配对」与「C+D 完整身份评估的实例证明」（与 E 本轮 P1 一致）。
4. `sameSourceCount > 1` 时 UI 必须提示「改源影响全部同源实例」。
5. page-context 缺失标记的移除条件沿用
   `e-pr30-identity-contract-confirmation.md` §3.2 三条件，无新口径。

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

静态来源证明（SourceGraph 边）与运行实例证明全程独立：#3/#6/#8 均 locatable=true（可导航）
而 instanceIdentityProven=false；#7 版本不一致时连定位也关闭。

## 8. 原型运行方式与工程发现

```bash
node --experimental-transform-types --loader ./scripts/ts-extension-loader.mjs \
  scripts/runtime-identity-phase2-proto.mjs [output.json]
# exit 0 = 8 场景断言全过；2 = 有场景未达预期（证据已归档）
```

两个对 A/E 重要的工程事实（原型中实测确认）：

1. **digest 口径**：插件注册的 `sourceVersion` = `sha256(transform 的输入代码, utf8)`，即
   **原始文件内容哈希**，不是标注后输出（`source-annotation.ts` 在注入注册码时用输入 `code`
   计算）。宿主 `fileDigest` 必须使用同一 recipe。建议 A 把它冻结为一个公共纯函数
   （如 `servedSourceDigest(root, file)`），避免容器侧/候选侧各自实现导致口径漂移。
2. **序列化陷阱**：`collectRuntimeIdentitySnapshot.toString()` 内含字符串 `'__reactFiber$'`；
   用 `String.replace` 注入 HTML 时 `$'` 是特殊替换模式，必须用函数形式 replacer
   （本原型注入已用函数 replacer；候选预览桥的 `insertCandidateBridge` 走模板字面量，不受影响）。

## 9. 需要 A 冻结的决策项

| # | 决策项 | C+D 建议 |
|---|---|---|
| D1 | 采用方案 A：`VerificationRun.runtimeIdentities` 字段 + `RuntimeRunIdentity` 类型（§2） | 是，沿 visualEvidences 先例 |
| D2 | digest recipe 冻结为公共函数（§8.1） | 是，含输入编码（utf8）、哈希算法（sha256） |
| D3 | 谁写 `runtimeIdentities`：宿主验证编排（非 E），在 attested 运行后、运行记录定稿前写入 | 宿主写，E 只读 |
| D4 | 原始快照工件落盘位置与保留期 | 与视觉工件同目录同保留期 |
| D5 | 字段冻结前的过渡：先按方案 B 归档，冻结后双写迁移 | 可接受 |
| D6 | 实例级授权接入 Candidate/Scope 的时机 | 不在阶段二；仍按原合同走 A 核心 Scope + 候选生命周期 |

## 10. 未解决限制

- 原型未覆盖 data-router 动态段（`:orderId`）下的命名空间行为；机制上归入 #8 同一
  fail-closed 类（route-coverage / unknown），联合验收时由 A 的集成预演补真实路由样例。
- `position-dependent` 实例可入 RuntimeSourceMap 导航，但 `resolveRuntimeElement` 拒绝其作为
  实例目标——阶段二未改变该行为。
- 快照 records 规模受页面标注元素数约束；极端大页面需运行点拆分（与视觉合同同策略）。
