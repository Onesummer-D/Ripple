# Runtime Identity 第二阶段 v1.2 合同（会签草案）

状态：A 侧草案，等待 A、C+D、E 三方正式会签及 Linux CI。本文在会签前不替代已冻结合同。

本文准确版本以交付列出的 Git commit SHA 为准；草案文本 Git blob SHA-256 也会随提交一起提供。本文不嵌入自引用摘要。

## 1. 权威来源与替代范围

- v1.1 冻结合同来源：提交 `7b24e72b4dc2bba56c8b3f36e36fcd49b46fcaa5`，文件 `docs/architecture/runtime-identity-phase2-frozen.md`。该文件及提交历史不修改、不重写。
- A②-2 补充说明：PR #43 的 `docs/architecture/runtime-identity-phase2-host-assessment-addendum.md`。它记录实现阶段的补充行为，不单独构成高于本合同的权威来源。
- 本 v1.2 经三方会签后，替代 v1.1 中下列条款：第 0、1 节 recordKey 公式；第 1.1 节把版本不可核验归入归档失败的状态表达；第 2 节页面身份及 expectedPage 解释；第 3 节把跨侧 mismatch 写入单侧 reason 词表的要求；以及 Assessment 哈希证明范围的未定义部分。
- v1.1 其他不冲突条款继续有效，包括 13 项单侧原因、来源图与版本检查原则、Verified/Proven 的区分、Verification 七项断言及 Scope/Approval/Apply/Rollback 门控。

| v1.1 条款 | v1.2 修订 |
| --- | --- |
| recordKey 使用 sourceRef 与 runtimeInstanceId 的拼接 | 使用规范紧凑 JSON `[sourceRef, runtimeInstanceId ?? null, snapshotIndex]`；仅在单侧 Snapshot 内定位 |
| 版本不可证明列为 archive failure | 通过宿主完整性核验的 Snapshot 保持 `archive: stored`，使用 `assessmentStatus: version-unverifiable` 并明确标出诊断 digest |
| 页面检查比较合同路径与 Snapshot 三元组，但 namespace 只含 pathname | v1 在 search/hash 非空时 fail-closed；v2 namespace 绑定 pathname/search/hash 精确 tuple |
| 跨侧 mismatch 被列入 record reason 扩展 | 保留 13 个 record-level reason；新增独立 pair-level `RuntimeIdentityPairReason` |
| Assessment 哈希只含 Assessment 内容 | v1.2 哈希绑定捕获元组、已验证 Snapshot SHA-256、recordKey 与 Assessment 内容；仍不视为签名 |

## 2. 身份数据的三种状态

每个可信运行点由外层 `VerificationRun.id` 和捕获元组共同定位。捕获元组固定为：

```ts
type RuntimeIdentityCaptureTuple = {
  checkId: string
  route: string
  viewport: { width: number; height: number }
  state: string
  side: 'baseline' | 'candidate'
}
```

`checkId/route/viewport/state/side` 必须与宿主从正式 Verification Contract、运行计划和视口计划推导的唯一条目逐字段相等。manifest 只提供待核验的声明。重复、缺失、多余或无法唯一匹配的条目不能变成可信 Snapshot。

### 2.1 采集或工件完整性失败

类型为 `RuntimeRunIdentityArchiveFailure`，`archive: 'failed'`，不含 Snapshot、Snapshot hash 或逐 record Assessment。v1.1 的归档失败原因词表有五个字符串；v1.2 将版本原因移入 2.2 的独立 stored 状态，因此 v1.2 `archive: 'failed'` 只接受以下四项：

- `collector-error`
- `snapshot-unavailable`
- `side-missing`
- `artifact-hash-mismatch`

`version-unverifiable` 只允许作为 `RuntimeIdentityVersionFailureReason`，用于 Snapshot 已通过宿主完整性核验、但源码版本无法证明的结果。归档器收到容器自报的 `version-unverifiable` 时，不能据此创建版本失败结果，应按不受支持的容器声明归一为 `snapshot-unavailable`。路径、JSON、schema、协议、字节大小、哈希、运行点绑定失败均不得附带可信 Snapshot。

### 2.2 Snapshot 已可信归档，但来源版本不可证明

类型为 `RuntimeRunIdentityVersionFailure`：`archive: 'stored'`、`assessmentStatus: 'version-unverifiable'`。只有当宿主已从允许目录读取普通文件、拒绝符号链接与路径逃逸、验证实际字节 SHA-256、大小不超过 16 MiB、JSON/schema 合法并绑定到可信运行点后，才可以保留 Snapshot 和逐 record 评估。

此状态下：

- 所有逐 record `locatable` 和 `instanceIdentityProven` 均为 `false`，并包含 `source-version-unavailable`。
- Snapshot 及其已核验字节 SHA-256、工件引用和逐 record 失败 Assessment 保留，供追溯。
- 不输出成功类型中的 `sourceDigests` 或 `boundDigest`。`observedSourceDigests` 与 `expectedBoundDigest` 仅供诊断，不能用于版本、来源或身份证明。
- `assessmentSha256` 仍是内容校验值，不会把失败状态升级为可信版本。

未通过工件完整性检查的文件不能因为版本核验失败而保留为可信 Snapshot。

### 2.3 Snapshot 与来源版本绑定均已完成核验

类型为 `RuntimeRunIdentity`：`archive: 'stored'`、`assessmentStatus: 'complete'`。`sourceDigests` 来自宿主对 baseline 自身源码树或 candidate 自身源码树的读取；`boundDigest` 必须与该侧可信运行上下文、SourceGraph revision 以及该源码树实际 digest 一致。

`assessmentStatus: 'complete'` 只表示归档与来源版本绑定完成。每条 record 仍需独立通过 13 项单侧 reason、页面和 namespace 条件，才能得到 `instanceIdentityProven: true`。`archive: 'stored'`、非空 Snapshot/Assessment、摘要存在或页面截图相似均不代表实例身份证明。

## 3. recordKey、捕获键和哈希范围

每个 Snapshot 内的 recordKey 为规范紧凑 JSON 元组：

```ts
JSON.stringify([sourceRef, runtimeInstanceId ?? null, zeroBasedSnapshotIndex])
```

`zeroBasedSnapshotIndex` 必须是非负安全整数。此 key 在单个 Snapshot 内唯一，用于定位原始 record；它随原数组位置变化。索引和 recordKey 均不是实例 ID，禁止跨侧配对、来源映射、排序比较或证明推导。

宿主运行点完整键为外层 `VerificationRun.id` 加捕获元组。baseline/candidate 两侧分别保留自己的 `side`、Snapshot、hash 和来源版本绑定。跨侧比较的运行点须满足 checkId、route、viewport、state 一致，side 分别为 baseline 与 candidate；不得用 manifest 数组位置代替这些字段。

`assessmentSha256` 对以下规范化 JSON 的 UTF-8 字节求 SHA-256：

```ts
{
  protocol: 'ripple-runtime-identity-assessment/v1.2',
  capture: { checkId, route, viewport: { width, height }, state, side },
  snapshotSha256, // 宿主已核验的实际 Snapshot 字节摘要
  recordKey,
  assessment
}
```

对象键按字典序稳定序列化，数组保持原顺序，字符串使用 JSON UTF-8 编码。哈希把 Assessment 内容、原始 Snapshot 摘要、单侧捕获元组与 recordKey 绑定在一起，便于检查数据被错配或改写。它不是签名，不证明执行宿主身份、Manifest 来源或 Assessment 结论真实；这些信任来自宿主读取、版本绑定和外层 VerificationRun 记录。

## 4. 单侧 reason 与 pair-level reason

`RuntimeIdentityReason` 固定为以下 13 项，均属于单条 record：

1. `invalid-certainty`
2. `unmapped-owner`
3. `instance-unavailable`
4. `duplicate-runtime-instance`
5. `route-namespace-stale`
6. `source-version-unavailable`
7. `source-version-ambiguous`
8. `source-version-mismatch`
9. `source-not-in-graph`
10. `page-context-mismatch`
11. `page-context-unverified`
12. `react-keys-unavailable`
13. `identity-not-stable`

`cross-side-assessment-mismatch` 是独立的 `RuntimeIdentityPairReason`，不是第 14 个 `RuntimeIdentityReason`，不得写入或回写单侧 record 的 `reasons`，也不得更改单侧 Assessment 哈希。

E③ 的 pair 候选必须先满足：捕获运行点除 side 外完全相同；每侧 `runtimeInstanceId` 非空、在该侧唯一且两侧完全相等；`sourceRef` 完全相等，或存在第 6 节定义的唯一、经宿主核验的定向来源映射；每侧为 `archive: 'stored'` 且 `assessmentStatus: 'complete'`；两侧 Assessment 均 `locatable: true`、`instanceIdentityProven: true`、`reasons: []`。找不到唯一候选或任一侧未证明时，结果是未配对/未证明，不生成 pair mismatch。

上述 runtimeInstanceId 相等与 sourceRef 相等/映射是两个独立必要条件，来源映射不得代替实例 ID 相等。当前 v1/v2 identity suffix 都锚定 record 的精确 sourceRef，因此 `baselineRef !== candidateRef` 时，即使存在有效来源映射 receipt，若两侧 runtimeInstanceId 不相等仍必须不配对。对当前 C+D ID 格式，sourceRef 不同的记录一律保持未配对；v1.2 的来源映射 receipt 只证明来源位置关系，不证明两个运行时实例相同，也不能改变此结果。若要跨不同 sourceRef 配对，必须另行定义版本化、可审计的实例级映射协议，由 A、C+D、E 会签；不属于本合同或 A②-3/E③ 当前实现。

候选唯一且两侧证明有效后，pair 一致性投影固定比较：

- `runtimeInstanceId` 精确相等；
- `certainty` 精确相等；
- `assessment.page.pathname/search/hash` 三字段精确相等；
- `sourceRef` 精确相等，或与当前唯一映射 receipt 的 baselineRef→candidateRef 关系精确相等。

sourceRef 相等/映射关系和实例 ID 是独立配对条件。映射只能说明来源位置对应，不能推导实例相等；当前 v1/v2 sourceRef 锚定 ID 下，不同 ref 即使有 receipt 也不配对，跨 ref 配对延后到另行会签的实例级映射协议。无法满足时不能以 recordKey、snapshotIndex、数组/DOM 顺序或近似关系补配。`sourceVersion`、两侧源码 digest、`recordKey`/index、`assessmentSha256`、Snapshot hash、capture `side`、`domNode`、`sameSourceCount`、`listKey` 和 `label` 不做跨侧相等比较：源码版本与工件摘要按侧独立核验，其余字段不是跨版本实例匹配键。只有有效唯一 pair 的上述一致性字段不一致时，E 在 pair 结果增加 `cross-side-assessment-mismatch` 并 fail-closed。该结果只能降级，不能弥补任一侧缺失、版本失败或单侧未证明；单侧失败只保留单侧失败，不伪造 pair mismatch。

## 5. 页面身份与 namespace

页面身份是精确三元组：`[pathname, search, hash]`。合同路径必须是同源 origin-relative 路径，宿主以固定 origin 解析后得到 expected tuple；拒绝 `//host`、反斜线、非法 URL 或不唯一映射。若多个 contract page path 经 URL 解析后得到同一完整 tuple，运行点保持 `page-context-unverified`。查询参数顺序不重排，百分号编码不解码，hash 不剥离；使用解析后 `URL.pathname/search/hash` 的精确字符串进行逐字段比较。

### 5.1 v1 兼容边界

`ripple-runtime-identity/v1` 的实例 ID 只含 pathname namespace。仅当 Snapshot 的 search 与 hash 都为空、ID pathname 前缀和 owner/source suffix 合法且含该 record 的精确 sourceRef anchor、且 Snapshot 页面三元组与唯一 expectedPage 完全相等时，v1 record 才可能通过 namespace 检查。任何非空 search 或 hash 均追加 `route-namespace-stale`，Assessment 保持未证明。v1 可继续用于历史读取和来源导航。

兼容阶段一的 sticky fail-closed 规则：若 C+D collector 在同一文档生命周期观察到 pathname 不变而 search 或 hash 变化，则必须将该 pathname 的 v1 namespace 标为歧义；即使后续 URL 回到空 search/hash，collector 仍须在相关 records 保留 `route-namespace-stale`。宿主 Assessment 必须保留 Snapshot 中已有的该 reason，不能因最终 `Snapshot.page` 与 expectedPage 相等而移除或覆盖它。此规则只能约束 collector 实际观察到的导航；未被采样的中间状态不可还原，不构成完整历史证明，也不替代 v2 render-time tuple。

### 5.2 v2 namespace

`ripple-runtime-identity/v2` 使用如下 ID 表示：

```text
ripple-page-v2:<encodeURIComponent(JSON.stringify([pathname, search, hash]))>:<原 identity suffix>
```

编码采用 JavaScript `encodeURIComponent` 对紧凑 JSON 数组编码；不对 tuple 字段做额外语义规范化。分隔符是编码 tuple 后的第一个冒号；其后的全部文本为原 identity suffix。宿主必须验证前缀、单一边界、合法 URI 解码、解码结果为三个字符串的 JSON 数组、重新编码后字节级相同、tuple 与 Snapshot.page 三字段逐项完全相等，以及 suffix 符合原 owner/source ID 格式。

Snapshot `page` 与唯一 expectedPage 不匹配时加入 `page-context-mismatch`；expectedPage 缺失、合同路径非法或映射重复时加入 `page-context-unverified`。namespace 缺失、格式不合法、编码非规范、tuple 与 Snapshot 页面不一致，或 suffix 不含该 record 的精确 sourceRef anchor 时加入 `route-namespace-stale`。任何上述情况都必须 `instanceIdentityProven: false`。

v2 collector 必须在每次实际 render/evaluation 读取完整 location 三元组并生成 namespace；采集时再将 namespace tuple 与实际 Snapshot.page 比较。页面 URL 改变但 DOM 未按新 tuple 重新渲染时，旧 namespace 会被降级。此协议不证明 URL 之外的应用路由状态。

## 6. 来源版本与跨版本映射

- baseline 的源码 digest 绑定到可信 `baseSourceDigest` 及对应 baseline SourceGraph；candidate 绑定到可信 `candidateTreeDigest` 及对应 candidate SourceGraph。两侧分别读取，禁止互换或使用容器自报版本字符串代替宿主 digest。
- 单独的 sourceRef 精确相等是直接来源定位条件，不等同实例身份相等。仍需两侧 runtimeInstanceId 非空且唯一相等、双方 Assessment 完成并已证明、页面 tuple 与 namespace 可证明。
- sourceRef 不同时，只有正式 Candidate 生命周期产生的唯一、定向 baselineRef→candidateRef 映射才可证明来源位置关系。其最小消费位置是 `VerificationRun.runtimeIdentitySourceRefMappings?: RuntimeIdentitySourceRefMappingReceipt[]`。每个 receipt 必须含 `protocol: 'ripple-source-ref-mapping/v1'`、`verificationRunId`、`candidateId`、`patchHash`、`baselineSourceDigest`、`candidateSourceDigest`、`baselineGraphId`、`candidateGraphId`、`parserSchemaVersion`、规范内容 `mappingSha256` 与映射项。每个 baselineRef 和 candidateRef 在同一 receipt 内均须唯一，映射方向固定为 baseline→candidate。`mappingSha256` 是对移除该字段后的其余 receipt 字段规范 JSON（`mappings` 按 baselineSourceRef、candidateSourceRef 排序）UTF-8 字节求 SHA-256；它是内容校验值而非签名。A 只附加已从正式 Candidate 生命周期来源读取、绑定当前 VerificationRun 与 Candidate、并由宿主复核唯一性的 receipt；须核对 run/candidate/patch、两侧 digest、graphId、解析器/schema 版本。E 只能消费挂在当前 run 上的 receipt，并核对所有 binding 字段。容器声明、行号近似、数组顺序、DOM 顺序、几何相似均不是映射。此 receipt 仅声明 sourceRef 来源位置对应，不声明实例身份等价；因当前 C+D v1/v2 identity suffix 锚定精确 sourceRef，receipt 不会使不同 sourceRef 的 records 成为 pair candidate。
- SourceGraph 解析规则或 schema 版本变化会使旧映射失效，必须重新生成和复核。缺失、重复、方向错误、revision 不匹配或过期映射均 fail-closed。

当前 A②-3 不接入 Candidate sourceRef mapping registry，也不生产来源映射 receipt。E 对 sourceRef 不相等的 records 一律不配对，即使未来本字段存在有效 receipt，也不能绕过当前 identity ID 相等要求。receipt 字段只为来源位置关系提供可审计的绑定位置；跨 ref 实例配对须在未来另行制定实例级映射合同，不能由 E 从普通 SourceGraph 或容器 Snapshot 自行拼装。

## 7. Verified Snapshot 与实例证明

**Verified Snapshot** 表示宿主验证了具体 artifact 的普通文件属性、可信根内路径、实际字节 SHA-256、16 MiB 上限、规范 JSON、协议/schema 与可信运行点。它只证明这份字节工件完整并被归档。

**实例身份证明** 是单条 record 的 Assessment 结论，要求 Snapshot 已验证、对应侧源码 revision 已绑定、sourceRef 在对应 SourceGraph 中、record 的来源版本与宿主 `servedSourceDigest` 一致、页面 tuple 和 namespace 均可信、实例 ID 有效且唯一、certainty 稳定且 13 项单侧 reasons 为空。前者不能单独推出后者。

超出 16 MiB 的 Snapshot 不得截断后归档；超限按工件不可用处理。符号链接、路径逃逸、目录或非普通文件、读取竞态、哈希不匹配、非法 schema 均不得被标作 stored。

## 8. A②-3 与 E③ 的生产/消费边界

### A②-3：宿主生产单侧正式回执

A 从宿主可信运行根读取 A① 工件，复核完整性、计划 tuple 和两侧独立来源 revision；调用正式 `assessRuntimeIdentity` 生成每条 Snapshot record 的 Assessment 与 v1.2 `assessmentSha256`；将三态条目追加到 `VerificationRun.runtimeIdentities`。A 保留单侧成功与失败记录，不静默省略。该字段是 VerificationRun 的兼容附加数据。

A 不因 runtime identity 改写既有七项 Verification 断言，也不修改 Scope、Approval、Apply 或 Rollback 门控。Identity 失败不能伪造成功回执或放宽原门控。A②-3 不将 identity 结果提升为视觉 PASS，也不改变 E③ 的 View/Compare 严格展示合同。

### E③：消费回执并呈现 pair/view 结果

E 只消费附着在正式 VerificationRun 上的 A 宿主回执及 A 已核验的 sourceRef mapping receipts。E 不读取容器原始声明来建立信任，不自行重算来源 digest、namespace 或单侧 Assessment，也不将 hash 当作签名。E③ 按本合同做严格唯一跨侧配对和 pair-level 一致性检查；`cross-side-assessment-mismatch` 只出现在 pair 结果中。任何不完整、歧义或失败回执都只能显示为 UNKNOWN/RISK/STALE 等非通过状态。

C+D 负责 v2 namespace 的生成、collector 内 tuple 校验及 13 项单侧 reason 的采集语义；A 负责宿主归档、宿主 Assessment 与正式运行回执；E 负责消费单侧回执、按正式配对条件形成只可降级的 pair/View 展示。角色变更须三方重新会签。

## 9. 启动 A②-3 的前置条件

A②-3 仅在以下条件全部满足后启动：本草案定稿并取得 A、C+D、E 会签；C+D v2 namespace 接口和真实 Chromium 正反例可用；A 的 host reader/Assessment 与新 schema 定向测试、Typecheck、Build、Linux Docker/Chromium CI 全绿；E 明确消费字段和 pair-level reason 类型。未满足前，PR #43 保持 Draft，A②-3 不启动。

此合同不会宣告 Runtime Identity 严格证明全链完成；严格跨版本视觉配对和 View 展示仍需 E③ 独立交付与验收。
