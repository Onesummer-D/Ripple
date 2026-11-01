# D Observation V2 · A 2ee08975 安全复验归档

## 范围

本切片从 A 精确提交 `2ee08975c891abb1df5ff38881326e78ead28076` 的 Tree
`60e397f075f8a1d62226d6a736993580b48df9ad` 建立 detached worktree
`acp6-d-observation-v2-replay-20261101`。A 原工作树没有被修改，历史 a5291
准备器、blocked 报告和旧 E-OBS-02 身份继续保留。

合同绑定为：

`sourcegraph-identity/v2` · `acp6-sourcegraph/v1` · `relation-id/v1` ·
`sourcegraph-source-mapping/v1` · `sourcegraph-observation-binding/v1`。

## 四组攻击组合

| 组 | 组合 | 主要拒绝边界 |
| --- | --- | --- |
| H1 | caller-forged Graph 与 mappings | caller 输入不是信任根；伪造图、mapping、opaque sourceRef 和自洽 digest 均拒绝 |
| H2 | side、project、digest、版本错配 | baseline/candidate 独立绑定，host envelope 必须匹配 side 与 host registry |
| H3 | 非法 file → token-use 来源锚点 | 必须是唯一 file → token-use、`reads`、`source-proven` 锚点，字段位置一致 |
| H4 | CSS uses-token → JSX 伪造严格证明 | `semantic-candidate` 或 CSS source-use 不能升级为 JSX strict source-proven |

`acp6-d-2ee-safety-negative-matrix.json` 逐行记录 63 个 runner 级 required
negative 检查：E-OBS-02 为 12 行，E-OBS-02-v2 为 32 行，E-OBS-02-v3 为 19
行。每行包含输入向量 SHA（合成 runner case 明确标为无文件）、执行 runner、
期望 reasonCode、实际执行/通过状态、精确测试 SHA 和 `eIndependentSignoff=false`。

## 离线复验

在 detached 干净工件上顺序执行：

1. Node vector runner；
2. PowerShell/.NET canonical recomputation；
3. Schema parity；
4. Dual report。

四项均实际执行并返回成功；Dual 报告为 `requiredNegativeCaseCount=63`、
`requiredNegativeExecutedCount=63`，四组 H1–H4 均有对应映射。复验报告记录于
`acp6-d-2ee-offline-safety-revalidation-report.json`。

这只是 detached evidence-only 复验。E 独立签收仍为 `false`，不能据此解锁生产
Observation、VerificationRun 或授权链。N01–N32 正式浏览器执行仍为
`not-executed`。

## 保留边界

历史文件
`docs/acceptance/2026-11-01/legacy-history/negative-missing-relation-source-identity.v0.json`
保持原 SHA 和历史身份，不与新版 `sourceMappings[]` 负例覆盖或合并计数。

本切片没有修改 SourceGraph、生产 collector、Runtime Identity、VerificationRun、
Approval、Apply 或 Rollback。
