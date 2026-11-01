# D Observation V2 · A 5291ecbf E-OBS-02 迁移矩阵

## 1. 版本与停点

本文件是 D 的 evidence-only 准备材料。A 候选精确提交为
`5291ecbfedd72f5ffcb4fc2afb4d7bf8d31836a1`，Tree 为
`1b398d5b4d33df256d3cd70829c0819742bbe69c`。D 不修改 A 工作树、分支或历史，
也不把 A 报告中的 `passed` 复制成 D 的正式结果。

D 旧门控基线仍是远端 `459b332f4d2b0749d125090332921223090b8526`，Tree
`b2462d4c6df94b206a82c7f3dc3a74c6f612d95e`；旧准备器和 blocked 报告保留在同一
切片父提交中。当前 E-OBS-02 仍为 `blocked`，Dual report 仍为 `blocked`，
N01–N32 仍为 `not-executed`，`productionWrites=false`。

## 2. 合同版本绑定

新版准备只能绑定下面五个互相独立的版本字段：

| 字段 | 绑定值 | 作用 |
| --- | --- | --- |
| `graphIdentityVersion` | `sourcegraph-identity/v2` | 图身份语义 |
| `graphSchemaVersion` | `acp6-sourcegraph/v1` | 节点、关系、unresolved 的形状 |
| `relationIdentityVersion` | `relation-id/v1` | Relation 规范化与重复拒绝规则 |
| `sourceMappingVersion` | `sourcegraph-source-mapping/v1` | host `sourceMappings[]` 的字段与信任根 |
| `observationBindingVersion` | `sourcegraph-observation-binding/v1` | run/check/side/page/viewport/state 的观测绑定 |

`graphIdentityVersion` 不能填入 `graphSchemaVersion`，也不能代替
`relationIdentityVersion`。`observationBindingDigest` 只能在 A/E 冻结 canonical
envelope 后按该 envelope 重算；本切片不生成生产 receipt 或新的 digest 黄金值。

## 3. 旧 fixture 到新 host mapping 的对应

历史旧 fixture `docs/acceptance/2026-11-01/legacy-history/negative-missing-relation-source-identity.v0.json`
保留为旧 E-OBS-02：当前候选裁定是 `graph-schema-invalid`、`unavailable`、
`not-proven`、`graphDigest=null`、`trusted=false`。它不能被重命名为新版通过结果。

`docs/acceptance/2026-10-31/vectors/negative-missing-relation-source-identity.json`
是新版 host mapping 负例：它保留同名语义，但输入已按
`sourcegraph-source-mapping/v1` 组织；不能与 `legacy-history/*.v0.json` 合并计数。

新版信任根改为由宿主从已验证的 side Graph 和源码快照构造
`sourceMappings[]`。四项 required safety gates 按 A 当前候选报告登记如下，
但在 A 独立归档及 E 明确签收前都只是 `prepared`：

| Gate | fixture | 触发 | A 当前候选 reasonCode | D 状态 |
| --- | --- | --- | --- | --- |
| E-OBS-02-G1 | `negative-missing-relation-source-identity.json` | host mapping 缺少可信 source identity | `graph-schema-invalid` | prepared / not-executed |
| E-OBS-02-G2 | `negative-forged-source-identity.json` | caller 伪造 source identity | `graph-schema-invalid` | prepared / not-executed |
| E-OBS-02-G3 | `negative-opaque-node-relation.json` | opaque sourceRef/relation 代替 host mapping | `source-ref-not-in-graph` | prepared / not-executed |
| E-OBS-02-G4 | `negative-source-ref-no-mapping.json` | graph 中不存在 host mapping 的 sourceRef | `source-ref-not-in-graph` | prepared / not-executed |

A 的兼容矩阵对“缺少或伪造 mapping”给出 `graph-schema-invalid`，并对缺失
mapping 给出 `unavailable`；最终 reasonCode 必须使用冻结合同的 `observation/`
命名空间。A 当前文件没有为每一个扩展负例单独发布完整状态裁定，D 不擅自
替换为 `unknown`、`partial` 或其它值。

八项 host trust-root 扩展案例也必须保留映射，作为同一 E-OBS-02 迁移集合的
待复核子集：

| fixture | A 当前候选 reasonCode | D 处理 |
| --- | --- | --- |
| `negative-missing-source-mappings.json` | `graph-schema-invalid` | prepared，等待 A/E 状态签收 |
| `negative-forged-source-mappings.json` | `graph-schema-invalid` | prepared，等待 A/E 状态签收 |
| `negative-old-source-digest.json` | `graph-schema-invalid` | prepared，等待 A/E 状态签收 |
| `negative-missing-source-anchor.json` | `graph-schema-invalid` | prepared，等待 A/E 状态签收 |
| `negative-nonunique-source-anchor.json` | `graph-schema-invalid` | prepared，等待 A/E 状态签收 |
| `negative-source-use-location.json` | `graph-schema-invalid` | prepared，等待 A/E 状态签收 |
| `g0-project-mismatch.json` | `logical-project-mismatch` | prepared，等待 A/E 状态签收 |
| `g0-semantic-candidate.json` | `relation-not-in-graph` | prepared；严格 source-proven 仍拒绝 |

这些记录描述 A 候选文件中的值，不是 D 的执行证据。A/E 若调整原因码或
状态，必须以精确 SHA 的冻结合同为准，并在四套 runner 中逐项一致。

## 4. 必需执行门控

正式复验只能在以下条件同时满足后开始：A 精确 SHA 已独立归档，E 已签收
`sourceMappings[]` 和 reason/status 语义，C/B 已完成新 Graph Identity 版本的
Relation ID 治理，且旧 Graph/重复 Relation ID 仍隔离拒绝。

运行顺序固定为 Node、PowerShell、Schema parity、Dual report。每一套必须显示
四项 required gates 已实际执行并与冻结 reason/status 一致。任一 gate 未执行、
失败、状态不一致、SHA/Tree 不匹配或 Dual 漏报，整体继续 `blocked`。

离线安全复验通过也不改变 N01–N32；N01–N32 只有在后续观察合同、真实 Graph、
运行身份和 A 授权全部满足时才可另行启动。任何步骤都不得写入 SourceGraph、
生产 collector、Runtime Identity、VerificationRun、Approval、Apply 或 Rollback。

