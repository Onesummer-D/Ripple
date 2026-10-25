# Runtime Identity A②-2 宿主评估补充裁决

本文件是 A②-2 对冻结合同的实现补充，不替代跨版本配对和 View 合同。

## 权威合同来源

Runtime Identity 阶段二 v1.1 的唯一权威文本为
`Ripple涟漪/_scratch/merge-fresh/docs/architecture/runtime-identity-phase2-frozen.md`，冻结提交为
`7b24e72b4dc2bba56c8b3f36e36fcd49b46fcaa5`。该文件位于 A② 开发分支之外，本仓库分支不含该文件。
若其他提案、准备报告或代码注释冲突，以该冻结文本为准；本补充只记录本次复审授权的 A②-2 澄清。

## 页面身份

可信 `BrowserVerificationContract.pages[].path` 是同源绝对路径，允许包含查询和 hash。宿主将 path 与运行点 route 均按同源 URL 解析为
`{ pathname, search, hash }`，三个分量逐字匹配。合同缺失、无 route 匹配、重复匹配或非法路径均产生
`page-context-unverified`；唯一映射存在但 Snapshot 三元组不同则产生 `page-context-mismatch`。
不确定或不匹配时 `instanceIdentityProven` 必须为 `false`。

## 快照归档与来源版本证明

`RuntimeRunIdentityArchiveFailure` 仅表示采集、结构、缺失或字节完整性失败；它不携带可信 Snapshot。
`version-unverifiable` 是宿主侧结论，不能由容器声明。A① 已验证字节哈希和 Snapshot 协议后，若宿主无法把源码树/图绑定到运行计划：

- 返回 `archive: 'stored'`、`assessmentStatus: 'version-unverifiable'` 的
  `RuntimeRunIdentityVersionFailure`。
- 保留已验证的 Snapshot、宿主实际核对过的 `snapshotSha256`、工件路径及哈希、来源摘要和逐 record Assessment。
- 每条 Assessment 都保留 `source-version-unavailable`，且 `locatable` 与 `instanceIdentityProven` 均为 `false`。

来源版本核验成功时返回 `RuntimeRunIdentity`，其 `archive` 为 `stored`，`assessmentStatus` 为 `complete`；
每条 record 都有 Assessment，单条 Assessment 仍可因具体 reason 降级。未通过字节哈希核验的内容只能形成
`archive: 'failed'` 归档失败条目，不能进入上述两类含 Snapshot 的结果。

## recordKey

逐 record 键是规范 JSON 元组：
`JSON.stringify([sourceRef, runtimeInstanceId ?? null, zeroBasedSnapshotIndex])`。
快照索引使重复 `sourceRef`/`runtimeInstanceId` 组合仍可唯一追溯；重复实例 ID 的所有记录仍必须带
`duplicate-runtime-instance` 并保持未证明。
