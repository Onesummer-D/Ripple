# MEDIA AssetImportRecord contract draft

状态：D MEDIA 阶段一复审版，供 A 审查；不替代 `CandidateRecord`、`ScopeDecision` 或 `VerificationRun`，也没有接入正式 Candidate 生命周期。

## 记录边界

`AssetImportRecord` 描述素材进入 Ripple 受控暂存区的 provenance：

- `importId`：ledger 内唯一、不可用于路径穿越的记录身份。
- `consent`：可信应用授权器签发、并在读取账本时验证的回执。回执绑定 `importId`、来源类型和源 hash/URL 指纹。`{granted:true}` 之类调用方字段不构成同意证明；未注入可信签发和验证器时 ledger 拒绝工作。
- `source`：`local-file` 只保留文件名；`external-url-reference` 只保留语法校验后的 HTTP(S) URL，拒绝 URL 凭据并清空常见敏感查询参数值。
- `stagedAssetHash`、`extension`、`format`：仅本地导入成功后写入。字节进入现有 `createStagedAssetStore`，读取复用 `readStagedAsset`，执行器与导入层复用 `assertMediaSwapAsset`。
- `formatValidation: header-only`：明确只识别格式头，不声称完整图片可解码。媒体通过仍须依靠正式浏览器 Verification 的 `media-loaded`（自然尺寸大于 0）证据。
- `targetRef` / `pageImpact` / `projectRevision`：ledger 只接受当前 `SourceGraph` 中带 AST 位置的 media 节点，并自行调用 `sourceProvenPageImpact`。页面集合必须完整、无 unresolved 且指向已知 route；绑定记录关联图 ID 和源码/运行时修订。版本变化后必须重新证明。
- `candidateId` / `retainedReferences`：仅是 pending provenance association 和账本内的保留标记。`bindCandidate` 不读取或验证真实 `CandidateRecord`，不证明项目身份、目标、素材 hash、Scope 或生命周期，也不授予执行或审批权限。正式 CandidateRecord 校验须在 A 接线阶段完成；Candidate、Scope、Verification、Approval 和 Apply 仍由既有核心独立校验。
- `result`：`staged` 或 `reference-only`。外部 URL 不触发网络下载，也不产生暂存 hash。

## 安全与生命周期

1. 本地来源必须是普通文件，拒绝符号链接、空文件、未知格式和扩展名/格式不匹配。
2. ledger 记录和 staged bytes 存在 Ripple 自有目录；不会写入用户项目原 checkout。
3. 同一 `importId` 与同一来源字节的重复导入返回原记录；不同 `importId` 可以共享一个 hash。存在 Candidate、VerificationRun 或 manual 保留引用时，`remove(importId)` 拒绝删除该账本记录；无保留引用时才可移除记录。任何情况下都不删除共享或孤儿字节。
4. `previewUnreferencedAssets()` 只报告可能孤儿与保留引用，绝不删除字节或未知目录项。阶段一不提供物理清理；删除策略须经 A 会签引用来源与保留期后另行实现。
5. `external-url-reference` 只做来源登记。任何分支都不调用网络抓取；重定向、SSRF/DNS rebinding、下载、MIME/魔数和完整解码策略不在阶段一实施。
6. 本地文件使用 `lstat`、`O_NOFOLLOW`（平台支持时）、文件描述符及读取前后 inode/size/time 比较；检查后替换、读取过程中变化和普通读取错误都 fail-closed。
7. `records/*.json` 的损坏 JSON、部分字段、无效授权回执、暂存字节缺失或 hash 不匹配，在读取时拒绝；暂存父目录和 ledger records 目录拒绝符号链接越界。

## 与候选生命周期的关系

```
用户明确同意 → AssetImportRecord + staged hash
  → 可信应用签发授权回执
  → SourceGraph source-proven target + 完整 PageImpact 追溯
  → Candidate ID 仅作为待接线的 provenance association
  → A 接线阶段须校验正式 CandidateRecord 的项目身份、目标、素材 hash、Scope 和生命周期
  → 应用层仍需创建 MEDIA asset-swap operation.payload.assetHash
  → 原有 candidate.ts / createMediaAssetSwapExecutor
  → Scope → Verification（浏览器 media-loaded/naturalWidth 证据）→ Approval → Apply
```

导入记录本身不创建 Candidate、不建立 Scope、不证明浏览器解码，也不表示候选通过。尚未证明的目标或消费者仍由原 Candidate 核心拒绝。B1 接入前须有可复现的 SourceGraph 导出/导入/JSX consumer/PageImpact 证据、接入端授权器以及 A 对 Candidate 接线和 Scope 的会签。
