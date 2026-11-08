# Phase 1B-b SourceMapping 合同会签报告

- 审查基线：`da89402738b3f46aeea1dc9eedaa5231a22fd571`
- 基线 Tree：`d4065b4cf07a487bb73a8efc8130ff566be59973`
- 本地只读检查 HEAD：`4ba7ed829aab69f4769b5e770b1f1abf572a50b6`
- 证据范围：`evidence-only`
- 生产写入：`false`
- GraphDigestV2 纯模块、SourceGraph、Runtime Identity、VerificationRun、Collector：均未修改
- 最终裁定：**ADJUST REQUIRED**
- Phase 1B-b 实现及生产接线：**HOLD**

## 1. 证据绑定

| 证据 | 精确身份 |
| --- | --- |
| SourceGraph 基线 | `d1c941da77d4ab4bbcd7ae557052557628bcb27c` |
| GraphDigestV2 纯模块 | `30030cd10c4eefbd976749be1b2b5df800bbf200` |
| GraphDigestV2 纯模块 Tree | `f49b9800a433c44c298a330aa70ebce0d95d50f6` |
| E Host Binding 参考 | `44649afa1d698fd77fd0e445e473e135995dc5c3` |
| D G0 evidence | `e1834d683fb0e3c56e856f5ba2922404912b3e76` |
| 固定工程 | `allanhue/webportflio@b244f857457d2a07f118155602eef9097fd322bd` |
| source-mapping contract SHA-256 | `716f8f4383efbe0b2cfbc4d590259701504d87882c4d4b0d3876dded9e4efae2` |
| field matrix SHA-256 | `2058f5028ddbb1c38594d99f2e51b149f0da3f5e0d960ed8f6b601edb8335931` |
| snapshot supplement SHA-256 | `760212fedffa451a975875150347f015926a8697fc0db2077f3052b192124900` |
| negative vectors SHA-256 | `71486e918df6925d8f5b7702da6538ed27136352471e13860b23e382f21c832d` |

以上文件均为合同/设计证据，不代表 Adapter 已实现或测试已通过。

## 2. SM-01～SM-04 裁定

| 项目 | 裁定 | 会签结论 |
| --- | --- | --- |
| SM-01 path | **PASS（需按本报告冻结解释）** | `token-use.location.path`、`mapping.sourceUse.path` 和唯一锚点 `from` 文件节点的规范路径必须逐字相等。文件路径取 `file` 节点的 `location.path` 与 `label` 的一致值；不得从 `file:<path>`、Relation ID、label 相似度或字符串截取推导。路径必须是仓库相对 POSIX 路径。 |
| SM-02 charOffset | **ADJUST** | 当前合同声明了 code-unit，但没有冻结 UTF-8 严格解码、UTF-16 code-unit 计数、边界/span 检查及无规范化规则的完整算法。必须从同一份不可变字节快照严格 UTF-8 解码，要求 `location.offset === sourceUse.charOffset`，并以解析器 token 起点/span 复算；缺失、越界、替换字符或偏移不一致均不得形成 Mapping。 |
| SM-03 byteOffset | **ADJUST** | 当前 `when present` 允许缺失，不能作为来源证明。对于可进入 Mapping 的 `token-use`，`node.byteOffset`、`location.byteOffset`、`sourceUse.byteOffset` 必须全部存在且逐字节相等，并等于原始 UTF-8 字节快照中该 UTF-16 起点前的字节数；禁止 LF/CRLF、NFC/NFD 或其它规范化。 |
| SM-04 anchor | **PASS（需按本报告冻结解释）** | `sourceAnchorRelationId` 必须唯一指向一条 `kind=reads`、`certainty=source-proven`、`from.kind=file`、`to===graphNodeId` 的边；边的 `sourceUse` 与 Mapping 完全相等，文件路径也必须相等。缺失、重复、错误端点、非 reads/source-proven 或 sourceUse 不一致均不能成为锚点。 |

## 3. sourceRef / graphNodeId / sourceAnchorRelationId

- `sourceRef === graphNodeId`，均为实际 `token-use` 节点 ID；不能使用 Relation ID、label、CSS token 名称或字符串前缀推导。
- `graphNodeId` 必须唯一命中一个 `kind=token-use` 节点。
- `sourceAnchorRelationId` 只表示唯一静态文件→token-use 锚点的 Relation ID，不是 sourceRef 的别名。
- `mapping.projectId === graph.projectId`；`sourceIdentity` 必须由已验证的 `sourceDigest + sourceUse` 生成：`source:<sourceDigest>:<path>:<charOffset>:<byteOffset>`。
- GraphDigestV2 纯模块只验证十字段和结构关系；Adapter 负责快照字节、路径、offset、Host Registry 与覆盖率证明。

## 4. Mapping 覆盖率准入

准入集合固定为当前 `SourceGraph.nodes` 中**全部** `kind=token-use` 节点。CSS `token` 声明节点、semantic-candidate 消费边、cascade 边和运行时节点不扩大或替代该集合。

必须满足：

1. 每个 token-use 节点恰好一条 Mapping；
2. 每条 Mapping 恰好对应一个 token-use 节点和一个唯一 anchor；
3. Mapping 数量与 token-use 节点数量相等；不得有额外 Mapping；
4. 任意 token-use 缺少、重复或冲突 Mapping，结果为 `unavailable`，保留原 graph 与 unresolved，不删除节点、不补造 Mapping、不计算可用 GraphDigest；
5. 没有 token-use 节点时，Mapping 必须为空；
6. semantic-candidate 或 UNKNOWN 消费者不能提升覆盖率，也不能改变 Mapping 结论。

## 5. Adapter 状态、诊断码与优先级

`mapping-rejected` 不再作为与 `rejected`、`unavailable` 并列的聚合状态，而是单条 Mapping 的拒绝诊断。聚合结果只有：

| 聚合状态 | 语义 | Digest |
| --- | --- | --- |
| `rejected` | 输入结构非法：未知字段、版本错误、重复 node/Relation/Mapping ID、未知端点、非法路径/offset、非数据对象等 | 不产生 |
| `unavailable` | 结构可解析，但来源证据不足或无法证明：Registry 缺失/不匹配、快照不可变性不足、TOCTOU、缺失/拒绝 Mapping、文件读取或哈希失败 | 不产生可信 Adapter 结果 |
| `available-content-only` | 所有十字段、全部 token-use Mapping、原始字节、快照身份和 Registry 绑定均验证通过 | 仅产生纯内容 GraphDigestV2；不表示 host-trusted、source-proven、runtime-proven 或授权 |

单条 Mapping 决策：`accepted` 或 `mapping-rejected`。建议固定诊断码：

- `mapping-missing`
- `mapping-path-mismatch`
- `mapping-char-offset-mismatch`
- `mapping-byte-offset-mismatch`
- `mapping-anchor-missing`
- `mapping-anchor-non-unique`
- `mapping-anchor-kind-mismatch`
- `mapping-source-use-mismatch`
- `mapping-source-identity-mismatch`
- `mapping-coverage-incomplete`
- `source-snapshot-unavailable`
- `source-snapshot-changed`
- `host-project-registry-missing`
- `host-project-registry-mismatch`

优先级固定为：

1. `rejected`：结构错误优先，终止 Adapter 输入；
2. 无结构错误但存在 `mapping-rejected`、`mapping-missing` 或外部证据不足：聚合为 `unavailable`；
3. 只有所有必需 Mapping 和外部证据通过时，才允许 `available-content-only`。

因此，当前文档中的 `mapping-rejected; graphDigestStatus=unavailable` 应改写为：`mappingDecision=mapping-rejected`、`adapterStatus=unavailable`。不能把 `mapping-rejected` 当成一种可用状态，也不能把 `unavailable` 升级成 `rejected` 来隐藏证据缺失。

## 6. digestTrackedTree() 字节合同

`da894027...` 已把记录分隔符固定为一个实际 LF 字节 `0A`：

```text
length(path UTF-8 bytes) : path : byteLength : sha256(file bytes) + LF(0A)
```

复算必须：

- 按既有 tracked 相对路径集合排序并去重；
- 使用原始文件字节、路径 UTF-8 字节长度和文件字节长度；
- 保留每个文件 SHA-256 和单个 LF `0A`；
- 不把 `\\n` 两字节 `5C 6E` 当成 LF；不把 CRLF 归一化为 LF；不做 Unicode NFC/NFD 或路径大小写归一化；
- 对生产 `digestTrackedTree()` 与独立复算器比较完整 64 位小写 SHA-256，并保存输入文件清单、每文件 SHA、记录字节和 exit code；
- Adapter 在快照验证层拒绝 symlink、special file、越界路径和 TOCTOU。当前纯函数对 symlink/special file 使用合成字节表示，因此 Adapter 不得把纯函数单独的 digest 当成这些来源已可信。

该字节合同本身 **PASS**；固定工程的实际双实现复算仍属于后续 Adapter evidence，不在本报告冒充已执行。

## 7. GraphDigestV2 与 Adapter 边界

- 纯模块只接收固定十字段，执行严格结构验证、规范 JSON、排序和 domain-separated SHA-256；结果最多是 `content-only`。
- Adapter 负责不可变 Source Snapshot、HEAD/tree/tracked set、原始字节、Mapping 覆盖率、TOCTOU、Host Registry 和错误聚合。
- Adapter 只能调用已验收纯模块，不能扩展 GraphDigestV2 字段、改写 reason code、重新分析源码、修改 SourceGraph 或跳过 B/E/A 门控。
- E 可以独立重算并比较 GraphDigestV2，但不能重定义摘要或以摘要相等替代 Host Binding、Producer Evidence、Runtime Identity 或授权证明。

## 8. 合同剩余问题

1. A/D/E 需把 SM-02 的严格 UTF-8 解码、UTF-16 code-unit/span 复算算法写入冻结合同。
2. A/D/E 需把 SM-03 的三处 byteOffset 全部必需化，并定义缺失字段的诊断码。
3. Adapter Schema 需正式拆分 `adapterStatus` 与 `mappingDecision`，避免三套状态并列歧义。
4. 覆盖率集合和 zero-token-use 行为需写入公共合同及 Schema parity。
5. 需由 C/B 提供真实 SourceGraph 的重复 Relation ID / symlink / special-file 分类证据；不能由 Adapter 自动去重或合成字节后通过。
6. `digestTrackedTree()` 的固定工程双实现复算、LF/CRLF/`\\n` 负例和 TOCTOU 仍未在本会签中执行。

## 9. 最终裁定

**ADJUST REQUIRED**。

SM-04、LF `0A` 字节合同和纯模块/Adapter 边界可接受；SM-02、SM-03、覆盖率与错误状态模型必须完成上述最小勘误后，才能进入 A/E 正式冻结。生产 Collector、VerificationRun、Runtime Identity、Approval/Apply/Rollback 和 D-P1 继续 HOLD。
