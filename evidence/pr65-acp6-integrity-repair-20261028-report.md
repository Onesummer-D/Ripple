# PR #65 AC-P6 原始 JSON 完整性修复

旧签字分支和旧文件保留不变。本分支新增正式运行的完整副本。

- 旧文件：`evidence/acceptance-ed58cfd-final.json`
- 旧文件 SHA-256：`b7500c9d5fc1b4c99bea8b889fa195915172abe8bc7ed9ccada52c64a3d037a4`
- 旧文件状态：JSON.parse 在第 11201 行附近失败
- 恢复文件：`evidence/acceptance-ed58cfd-original-recovered.json`
- 恢复文件 SHA-256：`0d7e5f97d91e69852f15c313522e05587a2571d61489c72274e3944b47d6527a`
- 恢复文件字节数：`1035281`
- JSON.parse：OK
- 退出码：2

## 固定对象

- Core HEAD：`ed58cfdc2892acaa9b97363a3414b1c219d07053`
- Core tree：`24de55f8bc1d8146b12b42b8bfdd4b24d5f41f6c`
- 第三方工程：`b244f857457d2a07f118155602eef9097fd322bd`
- Probe：`3431294c0807161432e0a7c986825ffc5263bc87`
- Matcher：`3a04ab896b40500b2c314b710b4cb1c3a3893dcb`
- Loader：`5368f6e098176f453f6e159544e4b0cbe6bcabff`

## 命令

```text
node --experimental-transform-types --loader ./scripts/ts-extension-loader.mjs ./scripts/b-css-token-probe.mjs <fixed-project-root> --acceptance --json acceptance-ed58cfd-final.json --expect-core-sha ed58cfdc2892acaa9b97363a3414b1c219d07053
```

## 结果

- AC6.1 PASS
- AC6.2 PENDING
- AC6.3 PASS
- AC6.4 PENDING
- AC6.5 PASS
- 3 PASS / 2 PENDING / 0 ERROR
- Graph：675 nodes / 5302 edges / 253 unresolved

C+D 派生矩阵的正式输入应为恢复文件；旧损坏文件只作为历史完整性问题保留，不能作为验收输入。

