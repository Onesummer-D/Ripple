# MEDIA AssetImportRecord contract draft

状态：D MEDIA P0-1 草案，供 A 审查；不替代 `CandidateRecord`、`ScopeDecision` 或 `VerificationRun`。

## 记录边界

`AssetImportRecord` 描述素材进入 Ripple 受控暂存区的 provenance：

- `importId`：ledger 内唯一、不可用于路径穿越的记录身份。
- `consent`：导入者、明确同意时间；没有同意记录就拒绝导入。
- `source`：`local-file` 只保留文件名；`external-url-reference` 只保留经过语法校验的无凭据 HTTP(S) URL。
- `stagedAssetHash`、`extension`、`format`：仅本地导入成功后写入。字节进入现有内容寻址 `StagedAssetStore`，候选执行器仍按 hash 复核。
- `targetRef`：只有 SourceGraph 关系已经达到 `source-proven` 后才能绑定；runtime-observed、semantic-candidate、unknown 都保持 unresolved。
- `projectRevision` / `candidateId`：可选追溯绑定，跨源码摘要复用会拒绝。
- `result`：`staged` 或 `reference-only`。外部 URL 不触发网络下载，也不产生暂存 hash。

## 安全与生命周期

1. 本地来源必须是普通文件，拒绝符号链接、空文件、未知格式和扩展名/格式不匹配。
2. ledger 记录和 staged bytes 存在 Ripple 自有目录；不会写入用户项目原 checkout。
3. 内容寻址允许底层字节暂存幂等，但 ledger 默认拒绝同一 hash 的重复导入记录，避免重复 provenance。
4. 删除记录不会立即删除字节；`cleanupUnreferencedAssets()` 扫描并回收没有任何记录引用的 orphan，保留被引用对象。
5. `external-url-reference` 只做来源登记。远程抓取、重定向、SSRF/DNS rebinding、MIME/魔数和大小策略属于后续单独设计，当前不实施。

## 与候选生命周期的关系

```
用户明确同意 → AssetImportRecord + staged hash
  → SourceGraph source-proven target binding
  → MEDIA asset-swap operation.payload.assetHash
  → candidate.ts / mediaAssetSwapExecutor
  → 四视口 Verification（浏览器 naturalWidth 等真实解码证据）
```

导入记录本身不能证明页面消费、Scope 传播、浏览器可解码或候选通过。`PageImpact` 未证明时，candidate 仍按核心规则拒绝。
