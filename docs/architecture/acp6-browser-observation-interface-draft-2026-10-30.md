# AC-P6 浏览器观测接口草案

状态：**技术准备稿，未会签，不接入生产**
协议建议版本：`acp6-browser-observation/v1-draft`
合同修订：`r3`（N05 状态、复杂摘要样本和真实 Graph 兼容性审计勘误）
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
  contractRevision: '2026-10-30-r3'
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
  primaryReasonCode: ObservationReasonCode
  secondaryReasonCodes: ObservationReasonCode[]
  diagnosticText?: string
  proof: ObservationProof
}
```

### 3.1 原因码、状态优先级和长度限制

`reasons: string[]` 不属于合同。记录只能使用以下固定 `ObservationReasonCode`，不得出现自由文本原因码：

```ts
type ObservationReasonCode =
  | 'complete'
  | 'missing-side' | 'missing-artifact' | 'artifact-hash-mismatch'
  | 'artifact-path-invalid' | 'artifact-changed-after-validation'
  | 'graph-schema-invalid'
  | 'cross-run' | 'cross-check' | 'side-mismatch'
  | 'logical-project-mismatch' | 'untrusted-capture'
  | 'required-verification-not-pass'
  | 'source-digest-mismatch' | 'graph-digest-mismatch'
  | 'runtime-version-stale' | 'route-namespace-stale'
  | 'geometry-only' | 'runtime-location-conflict'
  | 'declaration-node-not-source-use' | 'relation-not-in-graph'
  | 'source-use-location-mismatch' | 'duplicate-record'
  | 'duplicate-artifact-conflict' | 'page-context-mismatch'
  | 'viewport-mismatch' | 'state-mismatch' | 'identity-not-stable'
  | 'pseudo-element-without-host-proof' | 'non-strict-consumer-edge'
  | 'missing-consumer-edge' | 'runtime-instance-without-edge'
  | 'dynamic-without-runtime-map' | 'page-impact-not-proven'
  | 'missing-cross-side-map'
```

规范约束：

- 每个 code 使用小写 ASCII kebab-case，长度 `1–64` 字节；未知 code、重复 code 或超过 8 个 `secondaryReasonCodes` 直接拒绝；
- `primaryReasonCode` 必须是该记录所有原因中按状态优先级选出的第一项；`secondaryReasonCodes` 不得包含 primary，按下方固定顺序排序，不按输入顺序保留；
- 状态优先级固定为 `unavailable > stale > unknown > partial > complete`。同一状态内按本节枚举出现顺序选 primary，再按相同顺序排序 secondary；
- `status=complete` 时，`primaryReasonCode` 必须为 `complete`，secondary 必须为空，所有必要证据齐全；
- `status` 不是调用者可自由填写的结论，而是由校验器根据证据和原因码重算；调用者填写的冲突值拒绝；
- `diagnosticText` 只能用于人类诊断，最多 1,024 个 UTF-8 字节，必须脱敏，不能承载额外授权语义、凭据、未校验路径或新的 reason code；
- 原始失败记录保留完整结构化原因，但不得作为可信 receipt 或修改授权。

固定选择顺序如下（从高到低）：

```text
unavailable: missing-side, missing-artifact, artifact-hash-mismatch,
             artifact-path-invalid, artifact-changed-after-validation,
             graph-schema-invalid,
             cross-run, cross-check, side-mismatch,
             logical-project-mismatch, untrusted-capture,
             required-verification-not-pass
stale:       source-digest-mismatch, graph-digest-mismatch,
             runtime-version-stale, route-namespace-stale
unknown:     geometry-only, runtime-location-conflict,
             declaration-node-not-source-use, relation-not-in-graph,
             source-use-location-mismatch, duplicate-record,
             duplicate-artifact-conflict, page-context-mismatch,
             viewport-mismatch, state-mismatch, identity-not-stable,
             pseudo-element-without-host-proof
partial:     non-strict-consumer-edge, missing-consumer-edge,
             runtime-instance-without-edge, dynamic-without-runtime-map,
             page-impact-not-proven, missing-cross-side-map
complete:    complete
```

### 3.2 记录约束

1. `sourceDigest` 与 `graphDigest` 是 side-specific；不能只记录 candidate 侧再复制给 baseline。
2. `sourceUseRef` 的 `path/charOffset/byteOffset` 必须与对应图中的 relation `sourceUse` 完全一致；偏移以 UTF-8 字节和现有 `offsetUnit: code-unit` 同时保留，不能做换行归一化。
3. `consumerEdge.relationId` 必须在该 side 的图中唯一存在，端点必须与 `sourceUseRef.graphNodeId` 相符；声明节点本身不能冒充 `token-use` 或 consumer 节点。
4. `certainty=semantic-candidate`、`runtime-observed` 或 `unknown` 的边都不是 strict consumer edge。`certainty=source-proven` 仍只是图边条件，不自动授予 PageImpact、Candidate 或 Apply 权限。
5. `artifact.path` 必须是可信 run artifact root 下的普通文件；绝对路径、越界路径、符号链接、目录和重算 SHA-256 不一致均拒绝。
6. 采集器不能写入审批、Candidate、Scope 或源文件；它只能向宿主提交本次 run 的记录。

## 3.3 只读 sidecar 与正式身份边界

观测记录只能作为绑定在既有 run artifact 上的只读 sidecar。它不具备任何生产写权限，宿主必须以独立的不可变归档保存它：

```ts
interface BrowserObservationSidecar {
  protocol: 'acp6-browser-observation/v1-draft'
  contractRevision: '2026-10-30-r3'
  readonly: true
  projectId: string
  runId: string
  checkId: string
  side: ObservationSide
  observationRecordIds: string[]
  sourceGraphMutation: 'forbidden'
  pageImpactMutation: 'forbidden'
  verificationResultMutation: 'forbidden'
  candidateScopeApprovalMutation: 'forbidden'
  applyRollbackMutation: 'forbidden'
}
```

- 观测器不得创建或修改 SourceGraph node、Relation、`sourceUse`、PageImpact、Candidate、ScopeDecision、VerificationRun 权威字段/状态、Approval、Apply 或 Rollback；它只能读取既有对象并提交 sidecar。
- `sourceUseRef` 是待校验的图引用，`recordId` 是归档记录身份，二者都不能替代正式运行实例身份。DOM 坐标、selector、截图位置也不能产生身份绑定。
- `runtimeInstanceId` 只有在宿主已验证的 Runtime Identity 归档中存在，并同时绑定项目、run/check、route namespace、source/graph digest 时，才可作为诊断关联；观测器不能自行提升其稳定性或写入 Runtime Identity。
- 没有正式 Runtime Identity、严格消费边或 PageImpact 证明时，sidecar 仍可保留为 `unknown`/`partial`，但不得形成 `source-proven`、Candidate、Scope 或执行授权。

## 4. graphDigest 与 sourceDigest

### 4.1 `sourceDigest`

`sourceDigest` 直接引用该 side 的 `ProjectRevision.sourceDigest`，由宿主在浏览器启动前和收集记录后核对。浏览器上报的字符串不是可信哈希声明，必须由宿主从已绑定源码/快照重新确认。

### 4.2 `graphDigest`

`graphDigest` 只对下列白名单图对象计算规范化 UTF-8 JSON 的 SHA-256。输入先分成图结构和运行环境元数据两层：允许排除的环境字段只能出现在 sidecar、run manifest 或显式 `environment` 包装对象中，校验器在计算前移除它们；它们不会影响 digest。图 envelope、node、relation、location、`sourceUse` 和 `pageOverrides` 中出现未知结构字段时必须拒绝，不能静默丢弃。白名单字段缺失、类型不符、非法数值或显式 `null` 也必须拒绝，不以默认值补齐。

```json
{
  "schemaVersion": "acp6-sourcegraph/v1",
  "sourceDigest": "<64 lowercase hex SHA-256>",
  "nodes": ["<CanonicalNode>"],
  "edges": ["<CanonicalRelation>"],
  "unresolved": ["<exact diagnostic strings>"]
}
```

#### 白名单与值规则

字段处置固定如下：

| 输入字段类别 | 处置 | 说明 |
|---|---|---|
| 允许排除的环境字段 | 仅在 wrapper `environment`、sidecar 或 run manifest 中接受并从 digest 输入移除 | 例如 `projectId`、`runId`、runtime/browser 版本、主机、时间戳、artifact 路径/hash、viewport、state、URL；加入、删除或改值都不改变 graphDigest |
| 未知图结构字段 | 拒绝 | 例如在 graph envelope、node、relation、location、`sourceUse` 中增加未列入白名单的 key；不得靠丢弃字段制造 digest 通过 |
| 非法白名单字段 | 拒绝 | 缺失必填字段、显式 `null`、错误类型、非法数字、重复集合成员、未知 relation 端点和重复 ID 都属于此类 |

- `CanonicalNode` 只允许 `id`、`kind`、`label`、`location`、`page`、`routePath`、`pages`、`selector`、`selectorScope`、`byteOffset`、`mediaContext`、`className`、`dynamicClassName`、`value`、`pageOverrides`、`tokenOrigin`；`location` 只允许 `path/start/end/offset/byteOffset`；
- `CanonicalRelation` 只允许 `id`、`from`、`to`、`kind`、`certainty`、`evidenceRefs`、`sourceUse`、`selectorScope`、`mediaContext`；`sourceUse` 只允许 `path/charOffset/byteOffset/offsetUnit`；
- `node.id`、`node.label`、`Relation.id`、`Relation.from`、`Relation.to` 和所有 path/selector 字段必须是非空字符串；`node.kind` 只能是 `file`、`symbol`、`component`、`route`、`data`、`media`、`token`、`token-use`、`jsx-element` 或 `state`；`Relation.kind` 只能是 `imports`、`reads`、`renders`、`uses-token`、`token-reference`、`asset-consumer`、`css-cascade`、`same-copy` 或 `semantic-link`；`certainty` 只能是 `source-proven`、`runtime-observed`、`semantic-candidate` 或 `unknown`；
- `evidenceRefs`、`pages`、`mediaContext` 必须是字符串集合；`sourceUse.offsetUnit` 必须为 `code-unit`；`dynamicClassName` 只能是布尔值；`tokenOrigin` 只能是 `css-custom-property` 或 `tailwind-palette`；
- 必填标量不能为 `null`；可选字段缺失时省略，不能写显式 `null`；空集合可以写 `[]`；
- 所有字符串保持原始 UTF-8 内容，不 trim、不换行归一化、不大小写折叠；SHA-256 必须为 64 位小写十六进制；
- `start/end/offset/byteOffset/charOffset` 必须是有限、非负、安全整数；拒绝 `NaN`、`Infinity`、`-0`、浮点数、指数形式和超出安全整数的数字；
- 对象键递归按 UTF-8 字节序升序排列，JSON 使用无空白 `,`/`:` 分隔和标准 JSON 字符串转义；
- `nodes` 和 `edges` 是身份集合，输出前按 `id` 的 UTF-8 字节序排序；重复 `node.id` 或 `Relation.id` 直接拒绝；
- `pages`、`evidenceRefs`、`mediaContext` 和 `unresolved` 是无序集合，禁止重复元素，按 UTF-8 字节序排序；不能把它们当作输入顺序数组；
- `pageOverrides` 是按 key 排序的对象；其 key/value 必须是非空字符串；
- 每条 relation 的 `from`/`to` 必须指向当前 `nodes` 中存在的 ID；未知端点、声明节点冒充 source-use 节点、缺失 `sourceUse` 对应位置均拒绝；
- `unresolved` 字符串逐字保留并排序，不能为空字符串；丢失、重写或拼接 unresolved 内容均使摘要校验失败。

#### 排除字段

`projectId`、`runId`、`checkId`、`side`、`runtimeFingerprint`、浏览器/Playwright/collector 版本、时间戳、主机名、操作系统、PID、端口、容器 ID、临时目录、artifact path/hash、日志、截图尺寸、viewport、state、URL 和任何运行环境变量都不进入规范图。它们必须在观测信封或 run manifest 中独立绑定。

#### 黄金样本

以下样本使用同一最小图：两个节点、一个 `uses-token` relation、空 `unresolved`，`sourceDigest` 为 64 个 `a`。规范 JSON 的 SHA-256 结果固定为：

| 样本 | 变体 | 预期结果 |
|---|---|---|
| G0 | 基准输入 | `a0a7e9c7e63e94a3fc3fe3e1d5b92e256f1fed3f4153f6b0410aa0f82c402093` |
| G1 | 只交换 nodes、edges 和 set 成员输入顺序 | 与 G0 完全相同 |
| G2 | 将 relation `certainty` 从 `semantic-candidate` 改为 `source-proven` | 摘要改变为 `88b500e631d7dd302fe8f526bb9f10b682228857605184639f7a11dbde0d42f4` |
| G3 | 在 graph wrapper 的 `environment` 中加入 `projectId`、`runId`、`runtimeFingerprint`、host OS 和 artifact path | 与 G0 完全相同；排除字段不得污染图身份 |

G0/G1 必须逐字产生相同 canonical JSON；G2 的关系语义发生实质变化，必须改变 digest；G3 的运行环境变化不能改变 digest。

为覆盖多个集合和关系的排序，追加复杂样本 G4/G5。二者使用同一三节点、两 relation 输入；每条 relation 有多个 `evidenceRefs`，节点和 relation 含多个 `pages`/`mediaContext`，并有三条 `unresolved`。G5 只将 nodes、edges、pages、mediaContext、evidenceRefs 和 unresolved 的输入顺序全部打乱。规范化后的 canonical JSON 必须逐字相同，预期 SHA-256 为：

```text
{"edges":[{"certainty":"semantic-candidate","evidenceRefs":["ev:css-1","ev:css-2","ev:runtime-1"],"from":"jsx:src/App.tsx#42","id":"rel:consumer","kind":"uses-token","mediaContext":["base","dark"],"sourceUse":{"byteOffset":42,"charOffset":42,"offsetUnit":"code-unit","path":"src/App.tsx"},"to":"token-use:src/App.tsx#42"},{"certainty":"source-proven","evidenceRefs":["ev:import-a","ev:import-b"],"from":"file:src/App.tsx","id":"rel:file-token","kind":"imports","to":"token-use:src/App.tsx#42"}],"nodes":[{"id":"file:src/App.tsx","kind":"file","label":"App.tsx","location":{"end":120,"path":"src/App.tsx","start":0},"pages":["page:/","page:/about"]},{"id":"jsx:src/App.tsx#42","kind":"jsx-element","label":"button","location":{"byteOffset":42,"end":58,"path":"src/App.tsx","start":42},"mediaContext":["base","dark"],"pages":["page:/","page:/about"]},{"id":"token-use:src/App.tsx#42","kind":"token-use","label":"--accent","location":{"byteOffset":42,"end":49,"path":"src/App.tsx","start":42},"pages":["page:/","page:/about"],"selectorScope":".cta"}],"schemaVersion":"acp6-sourcegraph/v1","sourceDigest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","unresolved":["css-token-use-unknown:--accent","dynamic-classname:src/App.tsx#42","route-coverage:/about"]}
```

G4 与 G5 的 canonical JSON SHA-256 和 graphDigest 都必须为 `a75ccff69fbae29ed069721d8d82eb2ff07bfc85d306c81ecca99ff35c45f398`。该样本只证明规范排序和字节稳定性，不改变 unresolved 或 relation certainty 的来源证明语义。

重复 node/relation ID、未知端点、非法数字、显式 null、未知图结构字段和 unresolved 重复项都必须独立返回拒绝，不允许“先去重再计算”。允许排除的环境字段只在规定 wrapper 位置被移除；如果同名字段出现在图结构对象内，则按未知图结构字段拒绝。

图摘要不等于来源证明。图摘要相同只能说明规范化内容相同；图中若没有严格消费边、含 unresolved，或 PageImpact 不是 `source-proven`，结果仍不能进入严格来源证明。

### 4.3 真实 SourceGraph 兼容性审计

重复 ID 规则必须先在真实 Graph 上审计，再冻结合同。当前 evidence/docs 分支可独立读取的 `docs/acceptance/2026-10-27/acp6-pr61-ac62-ac64-detail.json` 只保存统计摘要：`nodes=675`、`edges=5302`、`unresolved=253`，没有 node、Relation 或 unresolved 的原始数组，因此这些数字不能证明唯一性。C 提供的整改版 `edges=3046` 也必须以原始 Graph 导出或内容寻址 manifest 交付后才能核对；本轮不把摘要数字当作审计通过。

冻结前由 A/B/C 提供两份只读输入：Base Graph 和整改 Graph。独立审计器必须逐项输出：

1. node 数量、Relation 数量、unresolved 数量及各自输入 SHA-256；
2. `node.id` 重复列表、`Relation.id` 重复列表、unresolved 重复列表；
3. Relation `from`/`to` 的未知端点列表；
4. 每个 node、Relation、location、`sourceUse`、`pageOverrides` 的 canonical 类型/白名单错误；
5. 不重复、不重编号、不忽略字段前提下的 canonical JSON 和 graphDigest。

审计通过条件是所有重复列表和未知端点为空、所有字段满足第 4.2 节类型规则，并且 canonical 输出能由原始输入重算。缺少原始 Graph 导出或 manifest 时，结果为 `missing-artifact`/`unavailable`；发现重复 node ID、重复 Relation ID、重复 unresolved、未知端点或类型错误时，结果为 `graph-schema-invalid`/`unavailable`，不得生成 graphDigest、trusted receipt 或来源证明。禁止自动去重、重新编号、忽略边或吞掉 unresolved；上游必须修复并重新导出后才能复审。

### 4.4 工件可信根与不可变归档

可信根由 Verification 宿主在 run 创建时建立，形状为：

```text
<host-owned-artifact-root>/<logical-project-id>/<run-id>/<side>/
```

根目录必须在源码工程、候选 worktree 和普通临时目录之外，由宿主创建并登记 `rootDigest`。采集器只能写入 staging 子目录，不能选择或替换可信根。

归档流程固定为：

1. 宿主用 `lstat`/等价 no-follow API 逐级检查 root 和每个父目录；遇到符号链接、Windows reparse point、目录替代或越界路径立即产生 `artifact-path-invalid`；
2. 输出先写入同一可信根内的唯一 staging 文件，限制大小，完整写入后 flush/fsync，再原子 rename 为最终相对路径；
3. 宿主从同一个已打开的只读文件句柄读取并计算 SHA-256 和 size，绑定 `artifact.path + sha256 + sizeBytes + recordId`；不接受调用者单独提交的 hash；
4. 读取前后比较文件身份、size 和 mtime/文件 ID；句柄读取期间发生替换、截断、增长或 rename 时，保留失败 bytes/诊断并返回 `artifact-changed-after-validation`；
5. 归档完成后目录和文件进入宿主只读/不可变状态，manifest 记录相对路径、字节 SHA-256、大小、生成时间、run/check/side 和失败记录索引；后续读取必须重新校验 manifest 与实际 bytes；
6. 任何损坏、空文件、非普通文件、越界文件、哈希不匹配或校验后变化均为 `unavailable`，原始失败记录保留供审计，不能删除后伪造成功记录。

路径只能是相对 POSIX 形式，拒绝盘符、UNC、绝对路径、NUL、`..`、重复分隔符和大小写替代。校验器不能先 `realpath` 再放宽符号链接；必须在打开、读取和最终绑定全过程拒绝 TOCTOU 替换。

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

状态重算优先级固定为 `unavailable > stale > unknown > partial > complete`。同一记录同时命中多个原因时，只能按第 3.1 节选择一个 primary，其余进入排序后的 secondary。

| 条件 | 单侧状态 | primary/secondary 示例 | 是否可证明 |
|---|---|---|---|
| 所有必需证据齐全且重算一致 | `complete` | `complete` / `[]` | 仅 `runtime-observed` |
| 记录可读但缺 strict edge、跨侧 mapping、动态映射或 consumer edge 仅缺失而运行身份无冲突 | `partial` | `non-strict-consumer-edge` / `runtime-instance-without-edge` / `missing-cross-side-map` | 否 |
| 记录存在但有歧义、重复、几何-only 或位置依赖 | `unknown` | `duplicate-record` / `geometry-only` | 否 |
| side/工件/原始 Graph 缺失、越界、篡改、跨 run、Graph schema 无效或未经可信执行器 | `unavailable` | `missing-artifact` / `graph-schema-invalid` / `untrusted-capture` | 否 |
| 来源/图/运行版本或 route namespace 已过期 | `stale` | `source-digest-mismatch` / `runtime-version-stale` | 否 |

`complete` 的必要证据必须全部满足：可信宿主绑定的 `projectId/runId/checkId/side`；匹配的 `sourceDigest/graphDigest`；存在且唯一的 route/page tuple、viewport、state；可信根内普通工件的路径、size、SHA-256 和不可变归档；浏览器/runtime 版本匹配；精确可重算的 `sourceUseRef` 与唯一 strict consumer edge；目标相关的 unresolved 已清除，且检查需要跨侧结论时已有完整 cross-side map；以及可重算的 `primaryReasonCode=complete`、空 secondary。即使全部满足，结论最多是 `runtime-observed`，不能产生 `source-proven`、Candidate、Scope 或修改授权。

没有 strict consumer edge 时，若其它字段完整优先为 `partial`；若目标、图边或运行身份存在冲突则为 `unknown`；不能把任何状态改写成 `pass`。

### 6.2 必须的特殊行为

| 负例 | 处理 | 禁止的恢复动作 |
|---|---|---|
| stale | 拒绝加入当前 run 的可信证据，保留原始工件供审计 | 不用当前 projectId 或相同 URL 复活旧记录 |
| missing side/artifact | 该 check 的 side 为 `unavailable`；双侧配对失败 | 不复制另一侧摘要、截图或状态 |
| duplicate record/artifact | 同一 tuple 出现多个不等价记录时整体 `unknown` | 不选 first/last、不按时间戳裁决 |
| cross-run/check/side | 记录 `unavailable`；污染的 pair 不可形成证据 | 不把 baseline 的记录借给 candidate |
| no strict consumer edge | 有运行事实则 `partial`，无可定位目标则 `unknown` | 不由几何、静态候选或 selector 生成 strict edge |
| graph schema invalid or raw Graph unavailable | `unavailable`；不生成 graphDigest | 不去重、不重编号、不忽略边或把摘要统计当作唯一性证明 |
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

## 11. 合同修订记录

| 修订 | 日期 | 内容 | 状态 |
|---|---|---|---|
| `r1` | 2026-10-30 | 初版字段、双侧身份、图边消费校验和 32 项负例索引 | 被 `r2` 取代 |
| `r2` | 2026-10-30 | 固定 reason code 与状态优先级；收紧 graphDigest 规范与黄金样本；增加可信工件根、TOCTOU 和不可变归档；明确只读 sidecar、Runtime Identity 与授权边界 | 待 A 冻结 `observation/v1` |
| `r3` | 2026-10-30 | 统一 `runtime-instance-without-edge` 为 `partial`；补充 G4/G5 复杂集合排序黄金样本；区分环境字段排除、未知图字段拒绝和非法白名单字段拒绝；增加 `graph-schema-invalid` 与真实 SourceGraph 唯一性审计处置 | 待 A 字段级会签和真实 Graph 审计 |

`r3` 是本轮 evidence/docs 归档合同，不能作为生产接线授权。生产实现仍须等待 C B1.1 精确验收、A 正式冻结、真实 Graph 唯一性审计和独立外审复跑。
