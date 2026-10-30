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

G0–G3 的历史摘要保留在 `golden-manifest.json` 和 r3 合同中。原始 G0–G3 payload 未随当前 evidence 分支归档，因此 manifest 将它们标为 `reference`，不会伪造执行通过。
