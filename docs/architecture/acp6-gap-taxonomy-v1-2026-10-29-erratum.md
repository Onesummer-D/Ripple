# ACP6 v0.6 Phase 0 Taxonomy 勘误与证据完整性补充

- 适用合同：`docs/architecture/acp6-gap-taxonomy-v1-2026-10-29.md`
- taxonomyVersion：`acp6-gap-taxonomy/v1`
- mappingVersion：`acp6-gap-mapping/v1`
- 勘误日期：2026-10-29
- 复核对象：C+D Phase 0 evidence `d1d26185710c8e4d80182356f760109123bdc989`
- 本文件是追加勘误，不修改原 Taxonomy 合同，不修改生产代码。

## 1. PR #65 损坏 JSON SHA-256 勘误

B 提交 `998b3d18bb6c42dd59b96bae6d203f8514c9c56b` 已确认：

- 旧文件：`evidence/acceptance-ed58cfd-final.json`
- Git blob：`0f1b0a5f0ace21856951752a42df51a743bb9feb`
- 文件大小：786443 bytes
- 正确 SHA-256：
  `6f2503b9e86a63ab64647bf1e7e742f4e67840c0a1c0b91a8f859be3f963982f`
- 原合同记录的 `b7500c9d...` 标记为历史记录错误，不再作为该文件的 SHA-256。
- 旧损坏文件必须原样保留，不能覆盖、替换或删除。

PR #65 正式矩阵继续使用恢复副本：

- `evidence/acceptance-ed58cfd-original-recovered.json`
- SHA-256：`0d7e5f97d91e69852f15c313522e05587a2571d61489c72274e3944b47d6527a`
- JSON.parse：成功
- Core：`ed58cfdc2892acaa9b97363a3414b1c219d07053`

## 2. mappingVersion 的逐行要求

结论：**`mappingVersion` 是每一条 uncovered row 的必需字段。**

顶层字段不能替代逐行字段。每条 `coverageStatus=uncovered` 必须同时拥有：

```json
{
  "rawGapClass": "selector-owner-unresolved",
  "rawGapClasses": ["selector-owner-unresolved"],
  "gapClass": "no-static-element-anchor",
  "gapClasses": ["no-static-element-anchor"],
  "taxonomyVersion": "acp6-gap-taxonomy/v1",
  "mappingVersion": "acp6-gap-mapping/v1",
  "mappingRuleId": "MAP-SOU-OWNER-001",
  "secondaryReasons": ["no-unique-owner"]
}
```

校验规则：

- 缺少 `taxonomyVersion` 或 `mappingVersion`：失败；
- 任一值不等于冻结版本：失败；
- 顶层有版本、行级缺失：失败；
- `mappingRuleId`、raw 标签、canonical 标签或证据条件不一致：失败；
- covered row 可以不携带 gap 映射字段；若携带，版本也必须匹配。

## 3. 跨平台 offset 证据

单一输入复制生成的 Windows/Linux 两列，即使数值相等，也不能标记为独立跨平台证明。

每个平台必须保存独立观察记录：

```json
{
  "platform": "windows|linux",
  "runnerId": "opaque-runner-id",
  "coreSha": "…",
  "projectRevisionSha": "…",
  "sourceFile": "src/css/style.css",
  "sourceFileSha256": "sha256-of-raw-file-bytes",
  "inputArtifactSha256": "sha256-of-platform-input",
  "byteOffset": 123,
  "charOffset": 123,
  "parserVersion": "…",
  "observedIndependently": true
}
```

每条 row 的跨平台字段：

```json
{
  "offsetEvidence": {
    "windows": { "byteOffset": 123, "sourceFileSha256": "…" },
    "linux": { "byteOffset": 123, "sourceFileSha256": "…" },
    "comparison": "independent-equal"
  }
}
```

可接受状态：

- `independent-equal`：两平台独立 checkout、独立执行、原始文件 SHA 相同、解析器版本已记录，byteOffset 相同。
- `independent-drift-explained`：原始文件 SHA 或换行/编码不同，两个 raw offset 都保留，并附可复算的 EOL/编码转换及映射表；不得覆盖任一平台值。
- `unavailable`：只有一个平台或缺少必要 provenance；不能声称跨平台证明。

必须失败：

- `observedIndependently=false)；
- Windows 值复制到 Linux，或反向复制；
- 两列相等但共用同一个 inputArtifactSha256、runId 或生成文件；
- byteOffset 来自 code-unit offset 而非原始 UTF-8 字节；
- 原始文件 SHA 不同但未记录差异和映射；
- 实际 offset 不同且无法解释；
- 任一平台的 `coreSha`、项目版本或 parserVersion 缺失。

未满足独立条件时，row 可以保留原始 offset，但 `crossPlatformStatus` 必须是 `unavailable`，不得计入跨平台证明。

## 4. AC6.4 pair 内容完整性

现有校验器能发现 pair ID/数量问题，但必须同时绑定 pair 内容，防止保持 ID 不变后篡改 token、sourceRef、selector、consumer 或 edge 内容。

每条 pair 增加：

```json
{
  "pairId": "stable-pair-id",
  "pairContentSha256": "sha256(canonical-utf8-json(pair-content))"
}
```

`pairContentSha256` 的输入至少包含：

- token 名称；
- CSS source-use 文件、UTF-8 byteOffset、selector；
- consumer JSX sourceRef、文件和 byteOffset；
- component、matched class、dynamic/certainty；
- graph node IDs、edge IDs；
- rawGapClass、gapClass、gapClasses、mappingRuleId。

顶层增加：

```json
{
  "ac64PairSetSha256": "sha256(canonical-utf8-json(sorted-pair-content))"
}
```

规范：

- pairId 必须唯一；
- pair 按稳定 pairId 排序后计算集合摘要；
- key 使用确定性 UTF-8 JSON；
- 修改任一 pair 内容而不更新摘要，校验必须失败；
- 修改 pair 内容并同步伪造摘要，源工件 SHA 或 manifest 校验仍必须失败；
- pair 数量、ID、内容、摘要任一不一致均不得 pass。

必须新增负例：保持 pairId 不变，仅修改 token、consumer sourceRef、CSS byteOffset、selector、edgeId 或 certainty，校验器必须拒绝。

## 5. Phase 0 状态与解锁条件

当前 `d1d2618` 只能视为基础映射和复跑材料，不能视为最终 Phase 0 验收。

在 C+D 新会签归档满足以下条件并经独立外审复跑前：

- 旧损坏 JSON 使用 B 勘误 SHA；
- 38 条 uncovered row 逐行携带 `mappingVersion`；
- 跨平台 offset 具备独立 provenance，复制值不得冒充证明；
- AC6.4 pair 内容篡改负例可被拒绝；
- 原始统计、source-use、consumer pair 和 canonical 映射不变；

Phase 0 继续 HOLD，C Phase 1 与 D 不解锁。

本勘误不改变五类 canonical taxonomy、Runtime Identity v1.2、v0.6 Base 或任何生产门控。
