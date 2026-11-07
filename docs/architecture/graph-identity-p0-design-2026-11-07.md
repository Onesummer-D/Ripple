# Graph Identity P0：Producer Manifest 与正式 graphDigest 最小设计

状态：evidence-only 设计，等待 A 对生产文件白名单和 E 对齐方案会签。

本设计基于 Ripple PR #72 的冻结实现基线：

- Base / design parent：`d1c941da77d4ab4bbcd7ae557052557628bcb27c`
- Parent tree：`46049ba554a9e7c3ef9048924607a5025342496f`
- 生产集成基线：PR #72，未修改其源码和证据。
- 固定第三方工程：`allanhue/webportflio@b244f857457d2a07f118155602eef9097fd322bd`
- D Observation V2 frozen contract blob：`f8c1e1642e58d96330835cdb7dd98c6d1d262815`
  (`docs/architecture/acp6-sourcegraph-observation-v2-final-2026-10-31.md`，归档提交 `808489c...`)
- D executable canonical serializer used for the replay vectors：blob
  `bb70603a7e02e6cab0277024f7e115226bbb3af4`
  (`docs/acceptance/2026-10-31/canonical-observation-digest.mjs`，提交 `2a261736...`)
- C raw producer supplement：blob
  `23c3c1590ed5c67118283f3618a9f6e3b9e9dc76`，提交 `f574c565...`。
- E PR #73：HEAD `944161c042cfe16184e4122143c0b545e7f16e67`；
  `computeHostGraphDigestV1` 文件 blob `457333dc6485083e003cde139c9a13d7260f4b69`。

本文件不改 `src/`、`model.ts`、PR #72、B v5、Runtime Identity、D Collector、E pairing 或任何授权门控。

## 1. 版本边界

四个版本字段分别表达不同协议，不互相替代：

| 字段 | 固定值 / 形态 | 责任 |
| --- | --- | --- |
| `graphIdentityVersion` | `sourcegraph-identity/v2` | Graph 身份绑定、规范化和 digest 域 |
| `graphSchemaVersion` | `acp6-sourcegraph/v1` | Node、Relation、unresolved 的字段形状和枚举 |
| `relationIdentityVersion` | `relation-id/v1` | Relation tuple、重复拒绝和 producer policy 规则 |
| `sourceMappingVersion` | `sourcegraph-source-mapping/v1` | Host source-use 映射（仅 Observation envelope 使用） |
| `observationBindingVersion` | `sourcegraph-observation-binding/v1` | 运行时页面、run、artifact 绑定，不属于静态 Graph digest |

`graphIdentityVersion` 不等于 `graphSchemaVersion`，也不等于
`relationIdentityVersion`。`sourceDigest` 是源码快照身份；`graphDigest` 是在
producer 证据齐全后生成的 Graph 身份。URL、runId、viewport、页面三元组和
Runtime Identity 不进入 Relation ID，也不改变静态 Graph digest。

## 2. D 的正式 digest 分层

P0 固定以下无循环依赖顺序：

```text
analyzeProject() SourceGraph + trusted source bytes
  -> rawGraphArtifact canonical bytes
  -> rawGraphArtifactSha256
  -> producer evidence (exact analyzer build + every edge occurrence)
  -> producerEvidenceSha256
  -> policy manifest (mixed producer mapping)
  -> policyManifestSha256
  -> final graphDigestSha256
```

### 2.1 Raw graph artifact

`rawGraphArtifactSha256` 是下列 envelope 的 canonical UTF-8 JSON 的 SHA-256：

```json
{
  "artifactVersion": "raw-sourcegraph/v1",
  "nodes": [],
  "edges": [],
  "unresolved": [],
  "sourceBindings": []
}
```

`sourceBindings` 的每项至少有 `role`、仓库相对 POSIX `path` 和
`sourceFileSha256`。它绑定真实固定工程源码字节，不绑定临时工作树路径、时间或
runner。raw artifact 不包含 producer evidence、policy manifest 或最终 digest。

Raw artifact 的稳定排序键来自 v0.3 supplement：

- `nodes`: `[id, kind, sourceRef ?? "", payloadSha256 ?? ""]`；
- `edges`: `[relationId, kind, from, to, certainty, payloadSha256, sourceUse.path ?? "", sourceUse.byteOffset ?? -1, sourceUse.charOffset ?? -1, selectorScope.raw ?? "", mediaContext ?? ""]`；
- `unresolved`: `[id, reason, sourceRef ?? "", byteOffset ?? -1, charOffset ?? -1]`；
- `sourceBindings`: `[role, path, sourceFileSha256]`。

比较键按 UTF-8 字节顺序比较。相同排序键的 raw occurrence 仍保留；不得静默折叠。
`occurrenceOrdinal` 是 canonical `edges` 排序后的零基审计定位，只属于固定 raw
Graph，不属于 `relation-id/v1`，不能恢复 sourceRef 或 runtime identity。

### 2.2 Producer evidence

每条 canonical edge occurrence 必须恰好有一条 producer evidence：

```json
{
  "evidenceVersion": "producer-evidence/v1",
  "graphIdentityVersion": "sourcegraph-identity/v2",
  "rawGraphArtifactSha256": "<64 lowercase hex>",
  "analyzerBuild": {
    "implementationSha": "<commit>",
    "implementationTree": "<tree>",
    "relevantBlobs": [{"path": "<repo-relative POSIX path>", "blobSha": "<blob>"}],
    "toolVersion": "<exact version>",
    "lockfileSha256": "<64 lowercase hex>"
  },
  "edgeOccurrences": []
}
```

`edgeOccurrences` 的唯一审计键是
`[rawGraphArtifactSha256, occurrenceOrdinal, relationId, payloadSha256]`，并携带
`producerPolicyId`、`producerIdentity`、`producerContractVersion` 和
`policyVersion`。缺失、重复或冲突的 occurrence 使
`producerEvidenceStatus=rejected` 且 `graphDigestStatus=unavailable`。
不能用 Relation ID 前缀、endpoint、certainty 或数组位置猜测 producer。

### 2.3 Mixed producer policy manifest

policy manifest 不含自身 hash，不含最终 graph digest：

```json
{
  "policyManifestVersion": "producer-policy/v1",
  "graphIdentityVersion": "sourcegraph-identity/v2",
  "rawGraphArtifactSha256": "<raw hash>",
  "producerEvidenceSha256": "<evidence hash>",
  "producerPolicies": []
}
```

每个 policy 绑定 `policyId`、`producerIdentity`、`relationIdentityVersion`、允许的
`relationKinds`、允许的 `certaintySet`、`mode` 和 `producerEvidenceRef`。其中
`css-selector-candidate` 使用 `relation-id/v1` 和 `css-cascade` /
`semantic-candidate`；其余既有 producer 使用显式 `legacy` policy。policy 按
`policyId` 排序，嵌套字符串集合按 UTF-8 排序。一个 edge occurrence 必须且只能匹配
一个 policy；多重、缺失或冲突映射直接拒绝。

### 2.4 Final graphDigest

在前三个 artifact 均独立验证后，final canonical input 为：

```json
{
  "graphIdentityVersion": "sourcegraph-identity/v2",
  "rawGraphArtifactSha256": "<raw hash>",
  "producerEvidenceSha256": "<evidence hash>",
  "policyManifestSha256": "<policy hash>",
  "sourceBindings": [],
  "nodes": [],
  "edgeOccurrences": [],
  "unresolved": []
}
```

本设计建议沿用 D 的精确 Graph domain prefix：

```text
ripple/sourcegraph-identity/v2/graphDigest\0
```

`graphDigestSha256 = SHA-256(prefix UTF-8 bytes || final canonical UTF-8 bytes)`。
raw、producer evidence 和 policy manifest 的各自 SHA-256 只对各自 canonical
bytes 计算，不包含下游 hash。若 A/E 认为 raw supplement 对 final digest 的 domain
prefix 另有冻结表述，必须在会签中给出精确字节和向量；实现不得自行选择第二套算法。

Digest 变化边界：

| 变化 | raw hash | evidence hash | policy hash | final graphDigest |
| --- | --- | --- | --- | --- |
| Node/edge/source bytes 改变 | 改变 | 必须重建 | 需重新绑定 | 改变 |
| analyzer build/evidence 改变、Graph 内容不变 | 不变 | 改变 | 必须重建 | 改变 |
| producer policy/version 改变 | 不变 | 不变 | 改变 | 改变 |
| 输入数组或对象键顺序改变 | 不变 | 不变 | 不变 | 不变 |
| producer 缺失/重复/冲突 | 可计算 | rejected | 不可接受 | `unavailable` |

## 3. Graph canonical field contract

### 3.1 Graph envelope

静态 D serializer 的顶层字段白名单是：

`graphIdentityVersion`, `graphSchemaVersion`, `relationIdentityVersion`,
`sourceDigest`, `nodes`, `edges`, `unresolved`。

`projectId` 和 `sourceMappings` 不加入当前静态 Graph envelope；它们属于 host
project/source mapping binding。若最终 producer envelope需要它们，必须使用
2.4 的明确字段，不得把 Observation envelope 字段混进静态 Graph。

### 3.2 Node

允许字段：

`id`, `kind`, `label`, `location`, `page`, `routePath`, `pages`, `selector`,
`selectorScope`, `byteOffset`, `mediaContext`, `className`, `dynamicClassName`,
`value`, `pageOverrides`, `tokenOrigin`。

Node kind 只允许：`file | symbol | component | route | data | media | token |
 token-use | jsx-element | state`。`id` 必须唯一；未知字段、未知 kind、重复 id、
显式 `null`/`undefined`、非有限数或不安全整数均拒绝。

`location` 仅允许 `path`, `start`, `end`, `offset`, `byteOffset`；`sourceUse`
仅允许 `path`, `charOffset`, `byteOffset`, `offsetUnit`，其中
`offsetUnit` 固定为 `code-unit`。源码 path 必须为合法仓库相对 POSIX 路径。保留
UTF-16 `charOffset` 和原始 UTF-8 `byteOffset`，不做换行或 Unicode 归一化。

### 3.3 Edge / Relation

允许字段：

`id`, `from`, `to`, `kind`, `certainty`, `evidenceRefs`, `sourceUse`,
`selectorScope`, `mediaContext`, `producerIdentity`, `sourceIdentity`。

Relation kind 只允许：`imports | reads | renders | uses-token | token-reference |
asset-consumer | css-cascade | same-copy | semantic-link`。certainty 只允许：
`source-proven | runtime-observed | semantic-candidate | unknown`。

`from`、`to` 必须各自解析到唯一 node。`evidenceRefs` 必须存在且为不重复字符串
集合。Relation id 必须唯一；同 id 同 payload 和同 id 异 payload 都是拒绝，不能静默
去重或重编号。`selectorScope`、`mediaContext`、`sourceUse` 是 payload 身份的一部分，
同端点不同 scope/context 不能合并。`semantic-candidate` 不得升级为
`source-proven` 或 runtime-observed。

### 3.4 unresolved

`unresolved` 是不重复字符串集合，按 UTF-8 字节排序。它记录无法证明的来源、
consumer、route、producer 或 digest 问题。任何 digest 前置校验失败都保留
`unresolved` 并返回 `graphDigestStatus=unavailable`；不得通过删除 unresolved
获得 digest。

## 4. 现有构造链与最小接线方案

当前 `analyzeProject(input, requireClean)` 的真实链路为：

1. `readProjectSnapshot()` 读取 Git root、tracked files、`ProjectRevision.sourceDigest`；
2. TypeScript/JSX 与 CSS 解析填充本地 `nodes`、`edges`、`unresolved`；
3. `addNode()` 以 `node.id` 去重，`addEdge()` 追加 Relation；
4. CSS candidate producer 使用 `createRelationIdRegistry()` 拒绝重复 `relation-id/v1`；
5. 返回 `{ id, revision, nodes, edges, unresolved }`，当前 `SourceGraph` 没有 digest/provenance 字段。

最小方案是新增纯函数接线，而不是扩大 `SourceGraph`：

```text
SourceGraph + trusted source snapshot
  -> buildRawGraphArtifact(graph, sourceBindings)
  -> buildProducerEvidence(rawArtifact, analyzerBuild, producerOccurrences)
  -> validatePolicyManifest(evidence, policyManifest)
  -> computeGraphDigestV2(rawArtifact, evidence, policy)
```

`analyzeProject` 继续负责事实生产；digest helper 只负责 evidence-side serialization、
校验和 hash。不得从 `graph.id`、数组下标、Relation 前缀、临时路径或 runtime fingerprint
推断 producer 身份。Graph digest 生成失败时，Graph 仍可被读取，但 digest 输出为
`unavailable`，并写入诊断；不产生可消费的 trusted identity。

### 建议生产文件白名单（待 A 最终确认）

只允许以下新增/最小修改：

- `src/core/graph-identity-v2.ts`：纯 canonical serializer、schema validator、raw/evidence/policy/final digest；
- `src/core/graph-identity-v2.test.ts`：golden、乱序、重复、未知字段和 fail-closed 测试；
- `src/core/project.ts`：最多一个导出调用点，用于传递现有 `SourceGraph` 和可信 source snapshot；不改分析语义；
- `src/core/project.test.ts`：验证 analyzeProject 图内容和 digest sidecar 的兼容性；
- `docs/acceptance/2026-11-07/graph-identity-p0/**`：producer manifest、运行日志、golden 与负例。

本轮设计没有修改上述任何生产文件。不得修改 `model.ts`、`runtime-identity*`、D
collector、E pairing、B v5 matcher/probe、Candidate/Scope/Verification/Approval/Apply/
Rollback 或部署配置。

## 5. 固定工程和 source snapshot 绑定

在固定工程 exact checkout 上，manifest 必须同时记录：

- requested project SHA `b244f857457d2a07f118155602eef9097fd322bd`；
- 实际 checkout HEAD、是否 exact checkout；
- `sourceDigest` 及参与计算的每个 tracked source binding；
- analyzer implementation SHA/tree、relevant blobs、tool version、lockfile SHA；
- Node/TypeScript 版本和运行平台仅作为诊断字段，不作为 Graph identity；
- raw artifact、producer evidence、policy manifest、final digest 的文件 SHA-256。

source bytes 的 LF/CRLF、中文/非 ASCII、UTF-16 code-unit offset、UTF-8 byteOffset
均按真实字节记录。跨平台一致性只允许在相同源码快照字节上声称；换行或字节变化必须
改变 sourceDigest/相关 span，不能在 serializer 中隐式归一化。

## 6. Golden / negative 验收向量

机器可读向量在同目录的 `graph-identity-p0-vectors.json`。核心向量：

- D-G0：冻结 D serializer 对 `g0.json` 的 canonical bytes 和 digest；
- D-G0-shuffled：节点、edge、evidenceRefs、对象键重排后 digest 不变；
- D-byte-offset-change：只改 UTF-8 `byteOffset`，digest 改变；
- E-vs-D：相同语义输入下，E 的无域、未规范数组 digest 与 D 不相等；
- E-order-sensitive：仅重排 Graph nodes，E digest 改变，D digest 不变；
- producer-missing / duplicate / conflicting：final digest unavailable；
- unknown-field / duplicate-node / duplicate-relation / unknown-endpoint：schema reject；
- same-id-same-payload / same-id-different-payload：都 reject，不静默去重；
- unicode-and-offset：中文、LF/CRLF、UTF-16 与 UTF-8 offset 作为不同输入核对；
- policy-change：raw/evidence hash 可保持，policy hash 和 final digest 必须改变。

D executable serializer 当前对 G0 的实际重算为
`ff8735ed6e3ff1f8321f66c2263d37c243ad7ec36616f28b98406fdc6ebcb9fe`，canonical JSON
UTF-8 SHA-256 为 `7670bc338a3b26ced964761dde0131c603f9b7c08c1ae1ff5e21b79fe1bd94d8`。
冻结文档表格曾列出 `4b061992...`；该值与归档 serializer 对同一 `g0.json` 不一致，
因此不能直接当作通过向量，需 A/D 在会签时选择并冻结一个精确字节来源。此设计保留该
差异为 `vector-contract-mismatch`，不改写历史报告。

E #73 代表向量（HostTrust registry envelope）重算：

- E canonical SHA-256：`d4839721ed7761ee767a953e2edca79c8bb6c0f52f6d42e21e4f0672b02bfa6d`；
- 同一 envelope 仅反转 Graph nodes 后：`1938139927d6711c8c263b2d7c8a7eb902a254993d2ffb321e6480e0bb5e3ba6`；
- D G0 graph-domain digest：`ff8735ed6e3ff1f8321f66c2263d37c243ad7ec36616f28b98406fdc6ebcb9fe`。

这些值是设计复算结果，不是生产 digest，也不授权 E 直接接入。

## 7. AC-P6 当前边界

保持 B 已登记结果，不以设计向量改写验收：

- AC6.2：`34/123`，`89` 未闭合；
- AC6.4：`34/147`，`113` UNKNOWN；
- 不恢复历史 `85/123`、`131/147`，不修改 B v5 阈值；
- 四条指定 negative case 继续 UNKNOWN，除非后续取得独立严格证据；
- producer manifest/digest 只能证明 Graph 完整性和来源工件绑定，不生成 JSX consumer strict proof、computed style、runtime-observed、Candidate、Scope 或授权。

## 8. 风险和 A/E 会签项

| 风险 | 影响 | 必须的控制 |
| --- | --- | --- |
| D 文档 digest 表与 executable serializer 向量不一致 | E 可能实现另一套 bytes | A/D 冻结单一 vector 和 blob；未冻结前 GraphDigest unavailable |
| E 当前 algorithm 接受数组 emission order | 相同 Graph 在 Node/PowerShell 可能产生不同 digest | E 对齐 D 的 sort/duplicate/unknown-field validator |
| E 当前 algorithm 无 domain prefix | cross-protocol collision / wrong binding | 使用 D 的 exact prefix；保留 E 算法为不兼容 legacy helper |
| E 当前 algorithm 包含 `side`, `mappingVersion`, `projectId` 外层字段并保留完整 `graph.revision` | 静态 Graph digest 混入 host observation 维度 | 将 host binding 与 static Graph 分层；producer final envelope 只按冻结字段计算 |
| `sourceMappings` 来源不可信 | caller 可伪造 sourceRef | sourceMappings 必须由 host verified graph/source snapshot 派生；缺失/多重/冲突拒绝 |
| Relation ID 重复或同端点多 scope | digest 不能表达 occurrence 身份 | relation-id/v1 先拒绝重复；selectorScope/mediaContext/sourceUse 全入 payload/tuple |
| fixed project 不是 exact checkout | 统计和 digest 不能归因到 b244 | manifest 标记 `exactCheckout=false` 并保持 unavailable |
| LF/CRLF 或 Unicode 归一化 | source span / sourceDigest 漂移 | 原始 UTF-8 bytes、charOffset、byteOffset 原样保留 |
| unknown/unresolved 被删除 | 伪造完整证明 | unknown/unresolved 计入 canonical Graph；删除或改 certainty 拒绝 |

A 需要签署：

1. Graph envelope 和 raw artifact 是否采用上述分层；
2. final digest 是否使用 D 的 domain prefix；
3. `projectId/sourceMappings/sourceBindings` 的边界；
4. producer evidence 的精确 analyzer build 字段；
5. mixed producer policy 的唯一映射规则；
6. duplicate / unknown / missing provenance 的 unavailable 结果；
7. D G0 `4b061...` 与 executable `ff8735...` 的 vector mismatch 处理；
8. 本节文件白名单。

E 需要签署：

1. PR #73 `computeHostGraphDigestV1` 不作为正式 v2 digest；
2. E 只消费已验证 final graphDigest，不从 Relation ID 前缀推断 producer；
3. graphDigest unavailable 时保持 fail-closed，不进入 runtime pairing 或 proof upgrade。

## 9. 后续实施门槛

只有 A 冻结单一 golden bytes、E 完成算法对齐并取得独立授权后，才可创建生产
Graph Identity Draft。未满足前，本分支只承载设计、向量和审计记录。

