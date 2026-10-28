# PR #65 AC-P6 原始 JSON 完整性勘误（追加）

本文件追加修正历史报告，不改写或删除旧损坏文件。

## 旧文件勘误

- Git blob：`0f1b0a5f0ace21856951752a42df51a743bb9feb`
- 大小：786443 bytes
- 正确 SHA-256：`6f2503b9e86a63ab64647bf1e7e742f4e67840c0a1c0b91a8f859be3f963982f`
- 原报告中的 `b7500c9d…` 为记录错误；旧文件仍原样保留。

## Windows 正式运行材料

恢复副本：

`evidence/acceptance-ed58cfd-original-recovered.json`

- JSON SHA-256：`0d7e5f97d91e69852f15c313522e05587a2571d61489c72274e3944b47d6527a`
- 大小：1035281 bytes
- 退出码：2
- stdout：1035928 bytes，SHA-256 `b11fbeac539c876405d40504f29a32f40ecde741c1eec63ae4ddb6cfada2072e`
- stderr：476 bytes，SHA-256 `5fd4b54fac8e4f556ab1b1ffd5dc5ec1660b09fb42ad6aa28664524e1d04c888`
- 退出码文件：`2`，SHA-256 `df4e26a04a444901b95afef44e4a96cfae34690fff2ad2c66389c70079cdff2b`

命令：

```text
node --experimental-transform-types --loader ./scripts/ts-extension-loader.mjs ./scripts/b-css-token-probe.mjs <fixed-project-root> --acceptance --json acceptance-ed58cfd-final.json --expect-core-sha ed58cfdc2892acaa9b97363a3414b1c219d07053
```

保留目录中的 ref 文件指向 `ed58cfd…`，但 Git object database 不完整，`git cat-file` 无法读取 HEAD/tree。因此不能把该 Windows 目录证明为可复核的原始 checkout；恢复 JSON 应标为恢复副本。

## 独立运行证明

Linux run [40656095611](https://github.com/Onesummer-D/Ripple/actions/runs/40656095611) 实际 checkout 了 Core `ed58cfd…`，tree 为 `24de55…`，使用冻结 v5 probe/matcher，退出码 2，结果 3 PASS / 2 PENDING / 0 ERROR。

PR61 的 `289edde…` JSON 对应 Core `2ebd1e20…`；删除两份 JSON 中唯一的 `aCore.sha` 和 `aCore.expectedSha` 字段后，结构完全一致。

C+D 正式矩阵输入继续使用恢复 JSON；旧损坏文件只保留为历史记录。
