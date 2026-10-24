# Runtime Identity 阶段二合同（A 冻结版 v1.1）

> A 出具，2026-10-24。输入：C+D 提案 `runtime-identity-phase2-contract.md` @ `2ad8528`、
> E 准备报告 `e-identity-phase2-prep-20261024.md`（PR #34 @ `0c38123`）。
> v1.1 修订（联合 C+D 裁决 offset drift 与失败归档类型，回应负责人审查）：
> §3 条件 4 的跨版本同源判定改为「字符串相等 **或** 正式跨版本节点映射」，
> 新增 §1.1 失败归档正式类型；其余 v1 内容不变。
> 基线：`feat/project-first-core-20261018 @ 652b42c`。
> 本文件冻结后即为唯一权威口径；与两输入文档冲突处以本文件为准。
> 不修改既有 Verification/Approval 安全门控；严格证明接线完成前
> `strictInstanceProofAvailable` 保持 `false`。

## 0. 裁决摘要（六项）

| # | 议题 | 冻结结论 |
|---|---|---|
| 1 | 字段命名与形态 | **方案 A**：`VerificationRun.runtimeIdentities?: RuntimeRunIdentity[]`，键控 `checkId × route × viewport × state × side`，与 `visualEvidences` 完全同构；**不采用**双侧分组（列表键控与先例一致，E 可按运行点回查） |
| 2 | 逐实例 Assessment 保存 | 每条 `RuntimeRunIdentity` 内含 `assessments[]`：宿主归档时对 snapshot 内**每个 record** 调用 `assessRuntimeIdentity`，按 `recordKey = sourceRef + '#' + (runtimeInstanceId ?? '@' + index)` 键控，逐条携带 `assessment + assessmentSha256`。一对不合格不污染其他对（采纳 E §1.4 补充②） |
| 3 | 侧别与版本绑定 | `side: 'baseline' \| 'candidate'` 为条目必填。baseline 侧 `sourceDigests` 读 `projectRoot` 且绑定 `graph.revision.sourceDigest`（= baseSourceDigest）；candidate 侧读 `candidateRoot` 且绑定 `candidateTreeDigest`。条目声明所绑定摘要值，宿主归档时核验，不符则以带原因条目保留（E §1.3 第 2 点采纳） |
| 4 | expectedPage 派生与 page-context | expectedPage 从 `verificationContract.pages[]` 派生：运行点 route → 合同页 pageRef → `expectedPage = { pathname: page.path, search: '', hash: '' }`。**冻结为完整三元组严格比对**（E §1.5：search/hash 可选比较口径废弃；合同页无 search/hash，则实际页 search/hash 必须为空）。无合同页 → `page-context-unverified`，fail-closed |
| 5 | 跨版本实例对应独立证明 | 见 §3。双侧 id 字符串一致**不构成**证明；须同时满足六项条件 |
| 6 | 严格证明 View 升级与降级 | 见 §4。`identityAssessment != null` 判定口径废弃，逐对核验 `instanceIdentityProven === true` |

## 1. 数据结构（冻结）

```ts
export interface RuntimeRunIdentityAssessmentEntry {
  recordKey: string                                // sourceRef#instanceId|@index
  assessment: RuntimeIdentityAssessment              // 宿主正式评估，唯一生产入口
  assessmentSha256: string
}
export interface RuntimeRunIdentity {
  checkId: Id
  route: string                                     // page:<path>，来自验证合同
  viewport: { width: number; height: number }
  state: string
  side: 'baseline' | 'candidate'
  snapshot: RuntimeIdentitySnapshot                  // ripple-runtime-identity/v1，纯数据可哈希
  snapshotSha256: string
  assessments: RuntimeRunIdentityAssessmentEntry[]   // 逐 record，不得整体省略
  sourceDigests: Record<string, string>              // 按侧读取，本运行点涉及文件
  boundDigest: string                                // 本侧修订摘要（baseline=baseSourceDigest / candidate=candidateTreeDigest）
  artifacts: { snapshot: { path: string; sha256: string } }
}
// VerificationRun 增量（v1.1 联合类型）：
//   runtimeIdentities?: Array<RuntimeRunIdentity | RuntimeRunIdentityArchiveFailure>
```

### 1.1 失败归档类型（v1.1 冻结）

快照缺失/采集失败/侧别缺失/版本不可核对的运行点**不得静默省略**，以正式失败条目留存：

```ts
export type RuntimeIdentityArchiveFailureReason =
  | 'collector-error'            // 容器内 collector 抛错
  | 'snapshot-unavailable'       // 运行点未产出 snapshot（records 缺项等）
  | 'side-missing'               // 条目缺 side 或侧别工件缺失
  | 'version-unverifiable'       // boundDigest 与按侧实际摘要不符
  | 'artifact-hash-mismatch'     // 内联 snapshotSha256 与工件实际哈希不符

export interface RuntimeRunIdentityArchiveFailure {
  checkId: Id
  route: string
  viewport: { width: number; height: number }
  state: string
  side: 'baseline' | 'candidate'
  archive: 'failed'
  reason: RuntimeIdentityArchiveFailureReason
  /** 工件已落盘但核验失败时记录声明哈希；未落盘则为 undefined（不得伪造）。 */
  declaredSnapshotSha256?: string
  detail?: string               // 原始错误信息，原样保留
}
```

哈希语义（冻结）：成功条目 = 内联 `snapshotSha256` 与工件哈希**双核验一致**才算归档成功；
失败条目中 `declaredSnapshotSha256` 仅是"声称值"（artifact-hash-mismatch 时即冲突证据），
**其存在不构成任何证明**；消费方（E/F）不得把失败条目计入严格证明的输入。

- digest 口径冻结为公共纯函数 `servedSourceDigest(root, file) = sha256(fs.readFileSync(file, 'utf8'))`
  （与插件注册 `sourceVersion` 同 recipe；A 实现于 core，容器/宿主禁止各自实现，C+D D2 采纳）。
- 归档失败/侧别缺失/版本不可核对的运行点**不得静默省略**：以 §1.1 正式失败条目留存
  （成功条目亦可在 assessments 层逐 record 失败，两层不冲突；E §1.3 第 3 点采纳）。
- 快照与 assessment 双哈希（内联 + 工件），工件目录与保留期同视觉证据（C+D D4 采纳）。

## 2. 生产与消费分工（冻结）

| 环节 | 负责人 | 内容 |
|---|---|---|
| 容器采集 | A | 验证容器在 attested 运行后按运行点执行 collector，snapshot 原始归档（双侧） |
| 宿主评估与写入 | A（C+D 会签评估语义） | 唯一入口 `assessRuntimeIdentity`；在运行记录定稿前写入 `runtimeIdentities`（C+D D3 采纳：宿主写，E 只读） |
| 身份判定语义 | C+D | `instanceIdentityProven` 充要条件与 13+1 项 reason 词表维护 |
| 视觉消费/配对 | E | 只读 `assessments[]`；配对层第三参接线；View additive 扩展 |
| UI 展示 | F | 严格证明状态与降级原因展示（会签 §4 措辞） |

## 3. 跨版本实例对应：严格配对条件（冻结）

`archive: 'failed'` 条目不参与配对（v1.1）。同一运行点键下，
一对 (baseline record, candidate record) 满足**全部**六项才可宣布跨版本严格实例证明：

1. `baseline.assessment.instanceIdentityProven === true`；
2. `candidate.assessment.instanceIdentityProven === true`；
3. 双侧 `runtimeInstanceId` 相等且非空、不等于 sourceRef；
4. **双侧同源（v1.1 修订）**：`sourceRef` 字符串相等（含偏移一致），**或**
   存在 A/C+D 正式**跨版本节点映射**（候选创建时建立的 sourceRef 对齐表，随候选
   生命周期版本化，宿主归档时按侧摘要核验映射本身有效）将两侧 sourceRef 关联。
   无映射且字符串不等 → **保持未证明**（fail-closed）；禁止按文件+类型相似度放行；
5. 双侧 snapshot.page 三元组一致，且等于该运行点 expectedPage；
6. 双侧 `recordKey` 的 identity 匹配来自 id 相等，**不得**按数组顺序配对（同源多实例须 id 逐对唯一匹配；配不出唯一对 → 全部降级）。

逐情形处置（不能仅凭两个实例 ID 一致）：

| 情形 | 结果 |
|---|---|
| 相同 runtimeInstanceId 但组件重新挂载 | 允许成立：key 保持则视为同一实例（C+D 实测 #4，lifecycle removed→remounted 同 id 不同 DOM 节点） |
| React key 或命名空间变化 | id 不等 → 第 3 条不满足 → 不成立，降级 + `identity-not-stable` |
| 源码偏移变化（offset drift，v1.1） | 实例身份本身绑定 id 而非偏移，第 3 条不受影响；但第 4 条同源判定因 sourceRef 含偏移而字符串不等 → **必须**有正式跨版本节点映射才成立；映射缺失 → 该对保持未证明，reason 沿用版本/映射词表（`source-version-mismatch` 或映射失效的具体词），不得自行放宽 |
| 同源多实例 | 第 6 条唯一配对；`sameSourceCount>1` 成立时 UI 必须并列警示「改源影响全部同源实例」 |
| 两侧 Assessment 不一致 | 该对降级 unproven，reason 新增 **`cross-side-assessment-mismatch`**（词表 13→14 项，C+D 维护） |

## 4. 严格证明判定与 View 规则（冻结）

1. **判定修复**：`visual-geometry.ts` 的 `strictInstanceProofAvailable` 必须逐对核验
   `instanceIdentityProven === true`；`identityAssessment != null` 口径废弃；
   `missingEvidence` 为空**不得单独升级**；不传 assessment 保持阶段一保守语义。
2. **view 措辞上限**：某对严格证明成立 → 允许实例级措辞；否则 ≤ `same-sourceRef-observed`，
   禁止「实例级已证明」表述；`locatable=true` 仅允许「可导航回源码」。
3. **降级语义**：任何 reason 非空 → 该对 fail-closed；视觉证据永远只读、永不为 pass；
   `missingEvidence` 四项（source-version / page-context / collection-reasons / graph-membership）
   的清理由**宿主归档时核验后代为清除**（给结论），E 不自核（E 清单④ 裁决：宿主代核）。
4. **升级路径**：`crossVersion.pairs[]` additive 增加宿主评估回执
   `{ recordKey, instanceIdentityProven, reasons }`；scope 增加 `provenance: 'host-assessed'`；
   F 消费 additive 字段，既有渲染不破坏。

## 5. CI 验收标准（冻结）

1. C+D 八场景原型矩阵 + E 九项消费面矩阵（其准备报告 §2）合并为联合回归，
   挂载点：`src/core/runtime-identity.test.ts`（词表 it.each）+ 视觉接线测试。
2. 正例必须真实浏览器产出（container collector → 宿主评估），禁止手工构造 passed。
3. 负例必须断言具体 reason（含新增 `cross-side-assessment-mismatch`）。
4. 宿主接线落地前，全部门控测试保持 `strictInstanceProofAvailable === false`；
   接线落地以「新增测试先红后绿」方式合入。
5. Approval/Apply/Rollback 门控测试不回退。

## 6. 实施顺序（冻结）

A：①容器双侧归档 + servedSourceDigest 公共函数 → ②宿主评估写入 runtimeIdentities（C+D 会签）；
E：③配对层接线 + View additive 扩展（①② 落地后）；F：④UI 展示（③ 会签文案后）；
全程 C+D 维护词表与评估语义。

## 7. 未解决能力边界（如实登记）

- data-router 动态段（`:orderId`）命名空间行为未实测，联合验收由 A 补真实路由样例（fail-closed 归类）。
- `position-dependent` 实例可入 RuntimeSourceMap 导航但不可作实例目标——阶段二不变。
- 极端大页面 records 规模需运行点拆分（同视觉合同策略）。
- AGENTS.md 在基线中不存在：项目约定以 `docs/architecture/` 合同文档为准（回应 E §0）。

## 8. 授权结论

**正式授权 E 启动阶段二编码**，范围仅限其准备报告 §6 边界内（不提前改核心写入路径；
③ 工作须在 A 完成 ①② 的集成预演分支上进行）。
