# E PR #30 身份合同确认（C+D → A）

> C+D 出具，2026-10-23。依据 A `dc8269f` 的 `src/core/runtime-identity.ts`、`src/core/model.ts` 与
> E PR #30（`feat/e-visual-wiring-20261023@fdd9ee0`）的 `visual-sampler-identity-rfc.md`。
> 本文件只确认合同，不含代码变更；如需新增公共字段，末尾给出精确类型提案，待 A 审查后实现。

## 1. RuntimeIdentityAssessment —— 严格实例身份证明的唯一判定

### 1.1 精确类型（现网已有，未改动）

```ts
interface RuntimeIdentityAssessment {
  sourceRef: string
  runtimeInstanceId?: string
  certainty: RuntimeIdentityCertainty        // 'stable-keyed-instance' | 'stable-react-instance' | 'position-dependent' | 'unknown' | 'unmapped'
  page: RuntimePageContext                 // 采集时快照页
  locatable: boolean                       // 可导航回源码（非授权）
  instanceIdentityProven: boolean          // 唯一严格实例身份证明标志
  sameSourceCount: number                  // 同源渲染元素数，>1 表示改源影响全部
  reasons: RuntimeIdentityReason[]
}
```

### 1.2 通过条件（充要，逐项必须同时成立）

`instanceIdentityProven === true` 当且仅当：

1. `locatable === true`：`sourceRef` 存在于当前 SourceGraph 的 `jsx-element` 节点中，且无 `source-version-mismatch`、无 `source-version-ambiguous`；
2. `runtimeInstanceId` 非空，且 `runtimeInstanceId !== sourceRef`（id 必须真正区分实例，不允许退化为来源引用）；
3. `reasons` 为空数组。

评估侧产生 reasons 的输入条件（缺一不可，缺则对应 reason 入列）：调用方必须提供
`context.fileDigest`（绑定**被评估那一侧**的修订）与 `context.expectedPage`
（`pathname` 非 undefined；不给出即 `page-context-unverified`，见 §3）。

### 1.3 阻断原因词表（13 项，以 `model.ts` 为准）

采集侧阻断六项（`BLOCKING_RUNTIME_IDENTITY_REASONS`）：
`invalid-certainty`、`unmapped-owner`、`instance-unavailable`、`duplicate-runtime-instance`、
`route-namespace-stale`、`react-keys-unavailable`。

评估侧降级七项：`source-version-unavailable`、`source-version-ambiguous`、
`source-version-mismatch`、`source-not-in-graph`、`page-context-mismatch`、
`page-context-unverified`、`identity-not-stable`。

### 1.4 版本绑定（fileDigest 与工程/候选修订）

`assessRuntimeIdentity(graph, snapshot, record, { fileDigest, expectedPage })` 中：

- `fileDigest(file)` 必须读取**与 graph 同一修订**的文件字节摘要——基线侧绑定
  `candidate.projectRoot`（基线预演工作树），候选侧绑定 `candidate.candidateRoot`
  （候选 worktree），两侧绝不混用（与 E `attach` 现有的按侧 memo 摘要接线同口径）；
- 读取不到摘要 → `source-version-unavailable`；摘要不等 → `source-version-mismatch`
  （同时令 `locatable=false`）；同一文件出现多个历史 digest → `source-version-ambiguous`。
  采集器侧已按 `sourceVersionHistory` 做同文件多 digest 整项省略，与之一致。

### 1.5 给 E 的硬规则

- **禁止以 `identityAssessment != null` 作为严格证明可用**。唯一合法判定是
  `assessment.instanceIdentityProven === true`；
- `identityAssessment` **只能**由宿主侧调用 `assessRuntimeIdentity` 产出，E 不构造、
  不转发自采样数据自造对象（RFC §6 已正确，保持）；
- `sameSourceCount > 1` 时严格证明可以成立（多实例正是 instanceId 要区分的场景），
  但它意味着"改源影响全部同源实例"——E 的配对/UI 需如实呈现，不得暗示单实例修改。

## 2. Runtime observations —— 验证容器采集合同

### 2.1 生产者（容器内）

每个（check, viewport, page state）运行点：在已注入 `sourceAnnotationPlugin` 的页面里
序列化执行 `collectRuntimeIdentitySnapshot()`（自包含、无 import，源由宿主以数据下发——
与 `candidate-preview-vite.config.mjs` 同模式）。产出：

```ts
interface RuntimeIdentitySnapshot {
  protocol: 'ripple-runtime-identity/v1'
  page: RuntimePageContext                 // { pathname, search, hash } —— 见 §3
  records: RuntimeIdentityRecord[]        // sourceRef / runtimeInstanceId? / certainty /
                                         // declaredCertainty / listKey? / sourceVersion? /
                                         // domNode / sameSourceCount / reasons / label?
}
```

### 2.2 绑定 VerificationRun（建议，待 A 确认字段名）

观测值按运行点归档进 `VerificationRun`，使证据可追溯：

```ts
// 提案字段（新增公共字段，A 审查后实现）：
interface VerificationRun {
  // …现有字段不变…
  runtimeIdentity?: Array<{
    checkId: string                        // 对应 VerificationCheck.id
    viewport: { width: number; height: number }
    state: string                        // 运行点状态名
    snapshot: RuntimeIdentitySnapshot     // 原始采集快照（纯数据、可序列化、可哈希）
  }>
}
```

替代方案（不动 model.ts）：复用现有 `evidence: VerificationEvidence[]`，把 snapshot
作为工件落盘并将工件哈希记入 `artifactHash`——C+D 认可，但字段化方案更利于
门控与复核，供 A 定夺。

### 2.3 消费者（宿主侧，正式判定路径）

```
snapshot.records
  → assessRuntimeIdentity(graph, snapshot, record, { fileDigest: 按侧绑定, expectedPage })
  → RuntimeIdentityAssessment（§1）→ 严格证明唯一来源
snapshot + 合格 observations
  → selectableRuntimeObservations(snapshot)  → createRuntimeSourceMap(graph, observations)
  → RuntimeSourceMap { graphId, sourceDigest, runtimeFingerprint, observations }
  → resolveRuntimeElement(graph, { sourceRef, runtimeInstanceId }, runtimeMap, verification)
```

- `selectableRuntimeObservations` 的入图规则：仅 `runtimeInstanceId` 非空、
  certainty 非 `unknown`/`unmapped`、除 `source-version-unavailable` 外无其他 reason 的记录；
  `position-dependent` 可入图用于源码导航，但 `resolveRuntimeElement` 拒绝其作为实例目标；
- `createRuntimeSourceMap`/`resolveRuntimeElement` 只回答"定位"，**不做授权**；
  授权仍走 A 核心 Scope + 候选生命周期（见 `sourcegraph-runtime-identity-contract.md` §1）。

### 2.4 最小样例

```json
{
  "protocol": "ripple-runtime-identity/v1",
  "page": { "pathname": "/pages/profile", "search": "", "hash": "" },
  "records": [{
    "sourceRef": "jsx:src/sub-components/profile/ProfileHeader.tsx#131",
    "runtimeInstanceId": "/pages/profile:jsx:src/sub-components/profile/ProfileHeader.tsx#131",
    "declaredCertainty": "stable-react-instance",
    "certainty": "stable-react-instance",
    "sourceVersion": "3f9a…",
    "domNode": 7,
    "sameSourceCount": 1,
    "reasons": []
  }]
}
```

## 3. RuntimePageContext —— 三元组够不够，何时可安全移除 page-context 标记

### 3.1 结论：pathname/search/hash 单独**不足以**证明页面身份

三个真实缺口：

1. **同 pathname、不同路由树位置**：条件路由/errorElement 状态下同一 pathname 可渲染
   不同组件树；客户端路由器的 pathname 不携带路由对象身份；
2. **陈旧命名空间**：React.memo 等未随导航重渲的元素保留旧 pathname 命名空间
   （采集器已用 `route-namespace-stale` 阻断此类 id——但仅阻断 id，不证明"当前页身份"）；
3. pathname 可跨工程/部署复用，本身不含工程身份（工程身份由 graphId/sourceDigest 承担）。

### 3.2 可安全移除 E `page-context` 缺失标记的精确条件（合同草案，A 冻结后生效）

同时满足：

1. `snapshot.page` 与调用方给出的 `expectedPage` 三元组相等
   （`assessRuntimeIdentity` 内 `samePage`，任一字段 undefined 即不证明）；
2. `expectedPage.pathname` 属于目标 `sourceRef` 经 `sourceProvenPageImpact` 证明的
   `pageRefs`（形如 `page:<path>` 去掉前缀后参与比较）——即"观测页"必须是被编辑目标
   的**已证明消费者页面**，而非任意浏览器位置；
3. 采集侧该记录无 `route-namespace-stale`（第 2 条 graph 侧兜底 + 本条运行时侧兜底，
   双保险）。

满足 1–3 → `page-context` 可从 `missingEvidence` 安全移除；任一不满足保持列出，
**绝不允许无依据清空**。

### 3.3 E 侧落地方式（无需 E 改代码的前提）

宿主在验证容器编排里持有目标的 `PageImpact.pageRefs`，把观测点期望页传给
`assessRuntimeIdentity`；E 只需消费最终 `instanceIdentityProven`（§1.5）。
若 E 需要在配对层自行核对，`expectedPage` + `pageRefs` 判定可由宿主以
`identityAssessment.page` 与 `assessment.reasons` 不含 page-context 类原因间接确认。

## 4. 联合验收核对表（E + C+D 合并前后）

| 项 | 合同 |
|---|---|
| 视觉证据 | 只读辅助，永不 PASS，不改 Approval/Receipt/Apply 状态机 |
| missingEvidence | 逐项有依据才可移除；source-version 按侧核验、page-context 按 §3.2 |
| 严格实例证明 | 仅 `assessRuntimeIdentity` 产出的 `instanceIdentityProven === true` |
| 版本绑定 | fileDigest 按侧（projectRoot / candidateRoot），不混用 |
| PR #29/#30 重叠 | 由 A 统一 rebase 取舍，同一接线代码只合入一次（C+D 不重复合 PR #28 已含部分） |

## 5. 新增公共字段提案（A 审查后再实现）

唯一提案：§2.2 的 `VerificationRun.runtimeIdentity?: Array<{checkId, viewport, state, snapshot}>`。
类型全部现网已有（RuntimeIdentitySnapshot 为纯数据），样例见 §2.4；阻断条件即 §1.3 词表。
C+D 本轮不改任何代码、不改 E PR #30；AC-P2a/b 主线修复在
`feat/sourcegraph-ac-p2a-p2b-20261023`（`bd321d8` + `6359ccb`，CI 已绿）独立推进。
