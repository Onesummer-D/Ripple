# AC-P6 golden digest fixture

这是独立 evidence-only 验证材料，不被生产 collector、SourceGraph 或 VerificationRun 引用。

## 执行

在仓库根目录运行：

```text
node docs/acceptance/2026-10-30/acp6-browser-observation-golden/validate-golden.mjs
```

当前可执行的 G4/G5 都必须输出 `status: pass`，canonical JSON SHA-256 和 graphDigest 都是：

```text
a75ccff69fbae29ed069721d8d82eb2ff07bfc85d306c81ecca99ff35c45f398
```

可用 `--case=G4` 或 `--case=G5` 单独执行。使用 `--input=<absolute-path>` 可以对外部 Graph JSON 做只读校验；重复 node/relation ID、未知端点、未知结构字段、重复集合成员和非法类型都会以 `graph-schema-invalid` 退出码 1 拒绝。

运行 `node docs/acceptance/2026-10-30/acp6-browser-observation-golden/validate-golden.mjs --negative` 会执行重复 node ID、不同 payload 的重复 Relation ID、相同 payload 的重复 Relation ID、未知 relation endpoint 和 unknown field 五项拒绝样本。五项预期均为 `graph-schema-invalid`、`observationStatus=unavailable`、`graphDigest=null`、`trusted=false`。其中未知 endpoint 的校验覆盖 `from` 或 `to` 任一端点不在 node 集合中的情况；相同 payload 的重复 Relation ID 证明重复发射也不会被去重接受。

本轮固定报告见 `golden-validation-report-2026-10-31.json`。报告中的 G4/G5 结果不能替代 N01–N32，也不能证明真实 SourceGraph 已完成 Relation ID 身份治理。

G0–G3 的历史摘要保留在 `golden-manifest.json` 和 r3 合同中。原始 G0–G3 payload 未随当前 evidence 分支归档，因此 manifest 将它们标为 `reference`，不会伪造执行通过。

