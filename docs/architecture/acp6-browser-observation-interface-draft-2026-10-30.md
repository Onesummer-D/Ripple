# AC-P6 浏览器观测接口草案

状态：**技术准备稿，未会签，不接入生产**
协议建议版本：`acp6-browser-observation/v1-draft`
归档分支：`evidence/acp6-browser-observation-docs-20261030`
归档基线：`5b75fe699afce98638e6fd6ad110911d83389dc8`

## 1. 目的与边界

本文把 A 的 `acp6-gap-taxonomy/v1` 第 8 节转成可实现的浏览器观测接口。它只定义采集记录、完整性校验、跨侧配对和负例行为，不修改 `SourceGraph`、`VerificationRun`、Candidate、Scope、Approval、Apply 或 Rollback。

Phase 0 已在固定证据归档上 ACCEPT，但 AC6.2 的 `sourceUseGraphNodeIds` 仍可能为 `missing`，AC6.4 仍有 UNKNOWN。浏览器观测可以补充运行时事实，不能把几何位置、静态 candidate edge 或缺失消费者边升级为 `source-proven`。正式生产接线须同时等待 C Phase 1 验收和 A 冻结本协议。

## 2. 身份与记录单位

一条记录表示一个 `VerificationRun` 中一个 `VerificationCheck`、一侧浏览器、一个页面状态下的一次观测。baseline 和 candidate 必须分别记录，不能用一条合并记录代替两侧。

### 2.1 逻辑项目身份

`projectId` 是宿主项目注册表产生的逻辑 ID，跨候选临时 worktree 保持不变。它不能来自临时目录名、浏览器 URL、DOM 属性或调用者提交的任意字符串。

- baseline/candidate 必须属于同一个逻辑 `projectId`；
- 临时 worktree、容器、端口和运行指纹不能证明项目相等；
- 记录中的 `projectId` 必须由可信 Verification 宿主绑定，采集器不能自行生成或改写。

### 2.2 运行绑定

`runId` 必须等于现有 `VerificationRun.id`，`checkId` 必须等于该 run 的 `VerificationCheck.id`，`side` 只能是 `baseline` 或 `candidate`。`checkId` 的 route、viewport、state 是预先声明的检查计划；浏览器报告只能匹配它，不能创建额外检查或改变检查合同。

### 2.3 页面、视口和状态

页面身份同时保存检查计划的 `route` 和浏览器实际位置三元组：

```ts
type PageTuple = {
  pathname: string   // 以 / 开头；保留实际大小写和尾部 slash
  search: string     // 空串或以 ? 开头
  hash: string       // 空串或以 # 开头
}

type Viewport = {
  width: number
  height: number
  deviceScaleFactor?: number
}

type RuntimeState = {
  id: string         // 来自 VerificationContract/检查计划的稳定 opaque ID
  digest?: string    // 若状态有可序列化输入，记录其 SHA-256
}
```

`pathname/search/hash` 缺失、不能解析、与 `VerificationCheck.route` 或运行时已验证 route identity 不一致时，记录不能成为完整证据。不能只用 pathname 丢弃 search/hash，也不能从 hash/router 约定猜 pageRef。几何位置、屏幕坐标和 CSS selector 不是页面身份。

## 3. 建议的接口形状

下列是独立的观测信封，不是本轮要加入 `src/core/model.ts` 的公共字段。命名和序列化版本待 A 会签。

```ts
type ObservationSide = 'baseline' | 'candidate'
type ObservationStatus = 'complete' | 'partial' | 'unknown' | 'unavailable' | 'stale'
type ObservationProof = 'not-proven' | 'runtime-observed'

interface BrowserObservationRecord {
  protocol: 'acp6-browser-observation/v1-draft'
  recordId: string

  // host-owned identity
  projectId: string
  runId: string
  checkId: string
  side: ObservationSide

  // side-specific immutable claims
  sourceDigest: string
  graphDigest: string
  graphSchemaVersion: string

  // browser context
  route: string
  page: PageTuple
  viewport: Viewport
  state: RuntimeState
  runtime: {
    runtimeFingerprint: string
    browserName: string
    browserVersion: string
    playwrightVersion: string
    collectorVersion: string
  }

  // exact SourceGraph identity, when one was found
  sourceUseRef?: {
    graphNodeId: string       // token-use/source-use node, never inferred from declaration node
    relationId?: string       // exact edge that carries sourceUse, if known
    path: string
    charOffset: number
    byteOffset: number
    offsetUnit: 'code-unit'
  }
  consumerEdge?: {
    relationId: string
    fromNodeId: string
    toNodeId: string
    kind: 'reads' | 'uses-token' | 'asset-consumer' | 'renders' | 'css-cascade'
    certainty: 'source-proven' | 'runtime-observed' | 'semantic-candidate' | 'unknown'
    evidenceRefs: string[]
  }

  // optional runtime locator; diagnostic only
  runtimeElement?: {
    runtimeInstanceId: string
    certainty: 'stable-keyed-instance' | 'stable-react-instance' | 'position-dependent' | 'unknown' | 'unmapped'
    boundingBox?: { x: number; y: number; width: number; height: number }
    selector?: string
  }

  artifact: {
    kind: 'observation-json' | 'runtime-snapshot' | 'mapping'
    path: string                 // relative to the trusted run artifact root
    sha256: string
    sizeBytes: number
  }
  status: ObservationStatus
  reasons: string[]
  proof: ObservationProof
}
```

### 3.1 记录约束

1. `sourceDigest` 与 `graphDigest` 是 side-specific；不能只记录 candidate 侧再复制给 baseline。
2. `sourceUseRef` 的 `path/charOffset/byteOffset` 必须与对应图中的 relation `sourceUse` 完全一致；偏移以 UTF-8 字节和现有 `offsetUnit: code-unit` 同时保留，不能做换行归一化。
3. `consumerEdge.relationId` 必须在该 side 的图中唯一存在，端点必须与 `sourceUseRef.graphNodeId` 相符；声明节点本身不能冒充 `token-use` 或 consumer 节点。
4. `certainty=semantic-candidate`、`runtime-observed` 或 `unknown` 的边都不是 strict consumer edge。`certainty=source-proven` 仍只是图边条件，不自动授予 PageImpact、Candidate 或 Apply 权限。
5. `artifact.path` 必须是可信 run artifact root 下的普通文件；绝对路径、越界路径、符号链接、目录和重算 SHA-256 不一致均拒绝。
6. 采集器不能写入审批、Candidate、Scope 或源文件；它只能向宿主提交本次 run 的记录。

## 4. graphDigest 与 sourceDigest

### 4.1 `sourceDigest`

`sourceDigest` 直接引用该 side 的 `ProjectRevision.sourceDigest`，由宿主在浏览器启动前和收集记录后核对。浏览器上报的字符串不是可信哈希声明，必须由宿主从已绑定源码/快照重新确认。

### 4.2 `graphDigest`

`graphDigest` 使用规范化 UTF-8 JSON 的 SHA-256：

```json
{
  "schemaVersion": "<SourceGraph schema>",
  "sourceDigest": "<side sourceDigest>",
  "nodes": "<stable node records sorted by node.id>",
  "edges": "<stable relation records sorted by relation.id>",
  "unresolved": "<normalized unresolved records>"
}
```

- 节点按稳定唯一 `node.id` 排序；重复 ID 直接拒绝；
- 边按稳定唯一 `Relation.id` 排序；重复 ID、缺端点或未知端点直接拒绝；
- `unresolved` 以稳定 UTF-8 表示保留；规范化时不丢失原因；
- 保留 `sourceUse`、`selectorScope`、`mediaContext`、`certainty` 等会影响来源判断的字段；
- 排除临时 `projectId`、运行指纹、时间戳、日志、端口和临时目录；
- baseline/candidate 分别计算，不能因为 projectId 相同而复制摘要。

图摘要不等于来源证明。图摘要相同只能说明规范化内容相同；图中若没有严格消费边、含 unresolved，或 PageImpact 不是 `source-proven`，结果仍不能进入严格来源证明。

## 5. sourceUseRef 与消费边校验

宿主在接受记录时按以下顺序校验：

1. 从 `runId/checkId/side` 找到预先登记的检查和 side 图快照；
2. 重新计算 side 的 `sourceDigest` 和 `graphDigest`，与记录逐字节比较；
3. 以 `consumerEdge.relationId` 在该图查找唯一 edge；
4. 核对 edge 的端点、kind、certainty、evidenceRefs 及 `sourceUse`，与 `sourceUseRef` 一致；
5. 运行时 element 的 page tuple、状态和实例身份只作为补充观测，与 graph edge 独立记录；
6. 调用既有 PageImpact/Scope/Verification 校验，不能用观测记录绕过任何门控。

以下关系不能满足 strict consumer edge：

- 只有几何重叠、屏幕坐标、截图像素相似或 CSS selector 命中；
- 只有 `css-cascade`/`uses-token` 的 `semantic-candidate` 边；
- 只有静态 candidate consumer 数量，没有对应 `Relation.id` 和 `sourceUse`；
- 只有 DOM instance，没有 SourceGraph 节点或消费边；
- 只有声明节点，没有精确 `token-use`/source-use 位置；
- `dynamic-className`、伪元素、旧 DOM 或位置依赖实例没有独立的正式映射。

这类记录仍可作为诊断资料，但 `proof` 只能是 `not-proven`，状态按第 6 节降级。

## 6. 状态、降级和配对规则

### 6.1 单侧记录

| 条件 | 单侧状态 | 原因码示例 | 是否可证明 |
|---|---|---|---|
| 字段齐全、图/源码/工件重算一致、页面/视口/状态匹配 | `complete` | — | 仅 `runtime-observed`，不能自动 `source-proven` |
| 记录有效但缺少跨侧 mapping、严格边或某个可选运行字段 | `partial` | `missing-cross-side-map`, `non-strict-consumer-edge` | 否 |
| 有可读工件但记录歧义、重复、几何-only、位置依赖或 candidate-only | `unknown` | `duplicate-record`, `geometry-only`, `semantic-candidate-edge` | 否 |
| 工件/side/route/state 无法读取、越界、篡改、跨 run 或没有可信捕获 | `unavailable` | `missing-artifact`, `cross-run`, `artifact-hash-mismatch` | 否 |
| 记录来自旧 sourceDigest、graphDigest、runtimeFingerprint 或已失效 route namespace | `stale` | `source-digest-mismatch`, `graph-digest-mismatch`, `runtime-version-stale` | 否 |

`complete` 只表示观测记录完整，不表示可以授权。没有 strict consumer edge 时，如果其它字段完整优先用 `partial`；若无法判断目标或记录存在冲突则用 `unknown`。不能把这些状态改写成 `pass`。

### 6.2 必须的特殊行为

| 负例 | 处理 | 禁止的恢复动作 |
|---|---|---|
| stale | 拒绝加入当前 run 的可信证据，保留原始工件供审计 | 不用当前 projectId 或相同 URL 复活旧记录 |
| missing side/artifact | 该 check 的 side 为 `unavailable`；双侧配对失败 | 不复制另一侧摘要、截图或状态 |
| duplicate record/artifact | 同一 tuple 出现多个不等价记录时整体 `unknown` | 不选 first/last、不按时间戳裁决 |
| cross-run/check/side | 记录 `unavailable`；污染的 pair 不可形成证据 | 不把 baseline 的记录借给 candidate |
| no strict consumer edge | 有运行事实则 `partial`，无可定位目标则 `unknown` | 不由几何、静态候选或 selector 生成 strict edge |
| artifact/hash/path 失败 | `unavailable` | 不信任调用者提供的 SHA-256 |
| route/viewport/state 不匹配 | `unknown` 或 `unavailable`（按是否仍能确定目标） | 不把相邻 viewport/状态视为同一 check |

### 6.3 双侧聚合

双侧聚合键为：`projectId + runId + checkId + route + pathname/search/hash + viewport + state`。聚合器不得用 sourceUseRef、DOM 坐标或 recordId 代替这些键。

- 任一 side `stale`：pair `stale`；
- 任一 side `unavailable` 或跨 run：pair `unavailable`；
- 任一 side `unknown`/重复：pair `unknown`；
- 双侧可读但任一 side `partial` 或没有 strict edge：pair `partial`；
- 即使双侧 `complete`，pair 的 `proof` 仍最多为 `runtime-observed`。只有 A 的正式 SourceGraph/PageImpact、七项 Verification 和授权门控全部满足时，外层系统才可判断是否存在 source proof；观测接口本身不产生该升级。

## 7. 与七项 Verification 和授权门控的关系

现有七项 assertion ID 必须原样保留：

`target-change`、`non-target-preserved`、`scope-propagation`、`interaction`、`responsive-layout`、`source-mapping`、`browser-errors`。

1. 观测记录必须隶属于已由可信 Playwright executor 创建的 `VerificationRun`，不能从调用者路径直接注册可信 receipt。
2. `source-mapping` 可以消费经过本协议校验的 `sourceUseRef`/consumer edge，但仍需既有 run record、artifact hash、route identity 和 source graph 校验。
3. 其它六项 assertion 的结果不得由观测接口代写；截图、几何、computed style、DOM 位置都只是对应 assertion 的输入或补充证据。
4. 任一必需 assertion 为 `risk`、`unknown`、`not-run`、`failed-to-run` 或 `stale`，不得生成可审批的 `passed` run。
5. Scope 的 `includedRefs`、`excludedRefs`、`protectedRefs` 仍由 A 决定；观测到的 DOM 不能扩大 Scope，也不能解除保护。
6. Candidate 必须已有合法项目身份、目标、资源哈希和生命周期状态；`sourceUseRef` 不能自行创建 CandidateRecord 或授予执行权限。
7. Approval、Apply、Rollback 仍只接受同一已验证 CandidatePatch；观测记录不写入审批、不触发应用、不改变回滚条件。

## 8. 端到端生命周期（未来实现）

```text
可信宿主绑定 project/run/check/side
  → 读取 side SourceGraph 与 source/graph digest
  → 启动固定 viewport/state 的浏览器检查
  → 采集 page tuple、运行时实例、sourceUseRef、工件
  → 宿主重算文件 SHA-256 和 graphDigest
  → 严格校验 run/check/side/route/state/edge
  → 产出 complete/partial/unknown/unavailable/stale
  → 与另一侧配对并附到 VerificationRun（只读补充证据）
  → A 既有七项 Verification/Scope/Candidate/Approval 门控继续裁决
```

采集失败或超时必须留下 bounded failure artifact；该工件不是可审批 receipt。外部 URL 只可按既有脱敏、只读规则记录，不触发远程抓取。

## 9. 本轮不做的事与后续解锁条件

本轮不修改生产 SourceGraph、不增加公共模型字段、不接线正式 `VerificationRun`、不写入 Approval/Apply 权限、不运行真实 Bolt、不开展青野四视口全链验收。

正式实现前必须同时具备：

1. C Phase 1 精确验收通过并提供可锁定 SHA 与测试证据；
2. A 会签并冻结本协议的字段、digest 规范、状态表和授权边界；
3. A 确认 `projectId`、`graphDigest`、运行点、消费边和 UNKNOWN 语义；
4. 独立外审复跑正例及第 10 节负例，证明不会由静态候选、几何或缺失消费边升级来源证明。

## 10. 本协议的独立负例索引

详细执行表见 [`acp6-browser-observation-negative-test-plan-2026-10-30.md`](../acceptance/2026-10-30/acp6-browser-observation-negative-test-plan-2026-10-30.md)。最小强制集合包括：

- 相同几何位置、不同 `sourceUseRef`；
- 只有 `semantic-candidate` 的静态边；
- 无 consumer edge 但存在 DOM instance；
- 声明 node 冒充 token-use node；
- stale source/graph/runtime version；
- 缺 side、重复 record、跨 run/check/side；
- artifact path 越界、符号链接、SHA 篡改及校验后替换；
- pathname/search/hash、viewport 或 state 不匹配；
- 未经可信 executor/授权门控的伪造记录；
- 七项 assertion 中任一非 pass 时仍试图生成 passed/approved 结果。
