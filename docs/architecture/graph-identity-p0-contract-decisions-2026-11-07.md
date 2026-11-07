# Graph Identity P0：D/E 合同补充裁定

状态：evidence-only，会签候选；不修改生产代码。

本补充针对 PR #74 设计复审中的两个 D G0 向量、producer provenance 与 E Host
Binding 的层级边界。它不覆盖 D、E 或 A 尚未签署的正式正文；正式实现前必须由
A/D/E 选择并冻结单一 canonical vector。

## 1. 旧 D G0 与 PR #74 G0 的版本关系

| 标识 | 字节来源 | 规范身份 | 结论 |
| --- | --- | --- | --- |
| `d-g0-formal-v2` | D Observation V2 归档向量，digest `4b061992...` | `GraphIdentityV2` / `sourcegraph-identity/v2` | 目标正式 Graph Digest 向量；包含 host-issued `projectId`、`sourceMappingVersion` 和 host-derived `sourceMappings`。 |
| `pr74-replay-raw-v1` | PR #74 对 D executable serializer 的实际重放，digest `ff8735ed...` | `raw-sourcegraph/v1` serializer replay | 早期/较小的 canonical graph replay；缺少正式 v2 的 `projectId` 与 `sourceMappings`，不能冒充 `graphDigest`。 |

两者不是同一输入的“旧值/新值”，也不是允许静默替换的两个 digest。它们属于不同
输入 envelope：前者是 host-bound Graph Identity V2，后者只可作为 raw artifact
或 serializer replay 记录。历史值均保留；在 A/D 选定正式字节前，生产
`graphDigestStatus=unavailable`。

## 2. Graph Digest 的范围

正式 `graphDigest` 只针对 canonical Graph Identity V2。其输入包含：

```text
graphIdentityVersion
graphSchemaVersion
relationIdentityVersion
sourceMappingVersion
projectId
sourceDigest
sourceMappings
nodes
edges
unresolved
```

Producer evidence、policy manifest、run/check、side、route/page、viewport、state、
artifact 和 runtime observation 不直接进入 V2 Graph Digest。`sourceMappings` 是
Graph Identity 的 host-derived 输入，必须在 Graph Digest 计算前完成独立校验。

Graph Digest 的数组/对象排序、UTF-8 字节序、重复拒绝、未知字段拒绝和 domain
prefix 使用 D 的冻结规则；缺少任一必需字段时不输出可信 digest。

## 3. Producer Evidence 与 provenance attestation

Producer Evidence SHA 与 Policy Manifest SHA 应形成独立的
`graphProvenanceDigest`，而不是悄悄改变 `graphDigest` 的输入：

```text
source snapshot
  -> SourceGraph
  -> GraphDigestV2
  -> ProducerEvidenceV1(rawGraphArtifactSha256 + exact analyzer build + occurrences)
  -> ProvenanceAttestationV1(graphDigest + producerEvidenceSha256 + policyManifestSha256)
  -> HostBinding
```

建议固定：

- `graphProvenanceVersion = sourcegraph-provenance/v1`；
- `graphProvenanceDigest` 是 attestation canonical bytes 的 domain-separated SHA-256；
- attestation 必须引用精确 `graphDigest`、raw artifact SHA、producer evidence SHA、
  policy manifest SHA、analyzer build 和每条 edge occurrence 的唯一映射；
- attestation 不回写 `graphDigest`，不把自身 digest 放入自身输入。

如果未来要求“最终 digest”同时承诺 Graph 内容和 producer evidence，必须新增明确
类型和版本，例如 `GraphDigestWithProvenanceV3` / `sourcegraph-identity/v3`。不能把
producer evidence 追加到 `sourcegraph-identity/v2` 后继续声称兼容。

## 4. E Host Binding 的使用方式

E PR #73 当前修订 HEAD `44649afa1d698fd77fd0e445e473e135995dc5c3` 的
`computeHostGraphDigestV1` 已采用 D 的 graph domain、UTF-8 key 排序、字段白名单、
重复 ID/端点/来源映射校验。它可以作为 Host Registry 的 Graph Digest 重算器，但
必须遵守以下边界：

1. Host 先从已验证的 SourceGraph、source snapshot 和 host mapping 重算
   `GraphDigestV2`，再与注册的 `graphDigest` 比较；
2. E 不重新定义 Graph Digest，不把 `runId`、`checkId`、`side` 或 artifact 加进
   静态 Graph Digest；
3. Host Binding 可携带 `graphDigest` 和可选的
   `graphProvenanceDigest` 引用；两者都必须与 host registry 精确匹配；
4. E 的 `runtimeProof` 继续为 `none`，`authorizationEligible=false`；
5. 缺少或冲突的 provenance attestation 只能使 provenance/host trust 降级，不能
   将静态 UNKNOWN 或 semantic-candidate 升级。

## 5. 身份层归属

| 数据 | 所属层 | 是否进入 Graph Digest | 说明 |
| --- | --- | --- | --- |
| `sourceDigest` | 源码快照 / Graph Identity | 是 | 绑定真实源码字节。 |
| `projectId` | Host-issued logical project / Graph Identity | 是 | 由 project registry 提供；不是临时路径。 |
| `sourceMappings` | Host-derived Graph Identity | 是 | `sourceRef`、token-use 节点、source span 和 anchor 的严格映射。 |
| `graphDigest` | Static Graph Identity | 产出值 | D canonical Graph 的唯一摘要。 |
| `producerEvidenceSha256` | Producer Evidence | 否，进入 attestation | 绑定 analyzer build 与 edge occurrence。 |
| `policyManifestSha256` | Producer Policy | 否，进入 attestation | 绑定 mixed producer policy。 |
| `graphProvenanceDigest` | Provenance Attestation | 否，作为独立产出 | 不回写 Graph Digest。 |
| `side` | Host/Observation Binding | 否 | baseline/candidate 绑定。 |
| `runId`, `checkId` | Observation Binding | 否 | 运行点身份。 |
| route/page/viewport/state/artifact | Observation Binding | 否 | 运行时采样和证据归档。 |

## 6. 无循环依赖与 fail-closed

| 阶段 | 必需输入 | 缺失/冲突结果 |
| --- | --- | --- |
| SourceGraph | exact source snapshot、analyzer output | SourceGraph 可读，但无可信 digest。 |
| GraphDigestV2 | D canonical Graph、sourceMappings、projectId、sourceDigest | `graphDigestStatus=unavailable`。 |
| ProducerEvidenceV1 | raw artifact、exact analyzer build、每条 occurrence | `producerEvidenceStatus=rejected`。 |
| ProvenanceAttestationV1 | Graph Digest、evidence SHA、policy SHA、版本匹配 | `graphProvenanceStatus=unavailable`。 |
| Host Binding | registry 中唯一 project/side/run/check/artifact、Graph Digest、可选 attestation | host binding `rejected` / `unavailable` / `stale`；不授予 runtime proof。 |

任何版本不匹配、重复 occurrence、多重 policy、未知字段、来源 span 不一致或
source mapping 非唯一都必须 fail-closed。不能从 Relation ID 前缀、数组顺序、caller
claims 或摘要数量推断 producer 或 source identity。

## 7. 机器向量与会签事项

机器向量在同目录 `graph-identity-p0-contract-decision-vectors.json`，覆盖：

- formal D G0 与 PR #74 raw replay 的不同 envelope；
- 同一 Graph、不同 producer evidence 时 Graph Digest 不变而 attestation 改变；
- 缺失/冲突 evidence 或 policy 时 attestation unavailable；
- Host run/check/side 变化不改变 Graph Digest，但改变 Observation/Host Binding；
- 将 evidence 直接追加到 GraphDigestV2 时拒绝，要求新版本/新类型。

A/D/E 需要共同签署：

1. `4b061992...` 是否冻结为 formal GraphDigestV2 向量；
2. `ff8735ed...` 是否归档为 `raw-sourcegraph/v1` replay；
3. `graphProvenanceDigest` 的正式类型、domain 和字段；
4. E 是否只消费/重算 GraphDigestV2，并以 attestation 作为独立可选证据；
5. `projectId` 与 `sourceMappings` 的 host registry 来源；
6. GraphDigestV2 与 ProvenanceAttestationV1 的 fail-closed 状态枚举。

本补充不修改 PR #72、B v5、Runtime Identity、D Collector、E production pairing、
Candidate/Scope/Verification/Approval/Apply/Rollback 或历史 2413 条 NOT-PROVEN 记录。
