# D Observation Gate · A 329028d8 集成准备

## 当前停点

D 的独立门控基线固定为远端 `459b332f4d2b0749d125090332921223090b8526`，Tree 为
`b2462d4c6df94b206a82c7f3dc3a74c6f612d95e`。本地准备 worktree 从等价的 D
证据提交 `5a203b31d81ca640402a560ab4cde668a8e8a721` 建立，未修改 A 的
`329028d8` 分支或历史。

A 新版当前仍是候选输入：

- A SHA：`329028d8226dad1a637b1a5d4cd232457b3374d0`
- 独立远端归档：未确认
- E 签收：未完成
- 所以本轮不运行四套正式 required negative，不更新 PASS 结果。

## E-OBS-02 版本化映射

保留原始 fixture：
`docs/acceptance/2026-10-31/vectors/negative-missing-relation-source-identity.json`。

在 A/E 冻结前，候选版本元组必须完整且逐项一致：

| 字段 | 候选值 |
|---|---|
| `graphIdentityVersion` | `sourcegraph-identity/v2` |
| `graphSchemaVersion` | `acp6-sourcegraph/v1` |
| `relationIdentityVersion` | `relation-id/v1` |
| `sourceMappingVersion` | `sourcegraph-source-mapping/v1` |
| `observationBindingVersion` | `sourcegraph-observation-binding/v1` |

负例预期保持：`graph-schema-invalid`、`unavailable`、`not-proven`、
`trusted=false`、`graphDigest=null`。缺少 host `sourceIdentity` 时不能由
`sourceRef`、`graphNodeId`、`Relation.id`、坐标或静态候选边恢复可信来源。

A 329028d8 当前存在版本元数据差异：执行清单仍写入
`relationIdentityVersion=A-governed-required`，而新版 compatibility matrix
使用 `relation-id/v1` 并增加 `sourceMappingVersion`。该差异必须由 A/E
统一后才能执行，不能由 D 自动选择或覆盖。

## 精确 SHA 运行门控

正式运行前，执行器必须先确认输入树精确解析到：

```text
329028d8226dad1a637b1a5d4cd232457b3374d0
```

确认 A 独立归档和 E 明确签收后，才按以下顺序运行：

1. Node vector runner；
2. PowerShell/.NET recomputation；
3. Schema parity；
4. Dual report。

四套结果都必须显示 E-OBS-02 已执行且通过。任一 required negative 未执行、
版本元组不一致或 Dual report 漏报 pending case，整体保持 `blocked`。

离线安全负例通过不改变 N01–N32 的 `not-executed` 状态，也不产生生产
Observation receipt、VerificationRun、Approval、Apply 或 Rollback 权限。
