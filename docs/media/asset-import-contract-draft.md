# Ripple MEDIA 资产导入合同 v1（AssetImportRecord，D 侧实现）

状态：已实现（`src/core/asset-import-record.ts` + `src/core/asset-import-record.test.ts`，11 项真实断言）；
不改 A 核心 Approval / Scope / Verification 合同，不写入正式 CandidateRecord。
评估依据：青野 f7e4998a 真实评估（本地工作区证据 `qingye-import-eval.txt`，结论与本合同一致）。

## 1. 结论摘要（P0：本地资产优先）

「用户显式导入本地图片 → 校验 → 合法暂存 → 记录来源/哈希/目标 → 冻结字节进候选 → 沿用现有生命周期合同」成立且无需修改 A 任何核心合同：

- 正例（可证明目标）：导入 → 内容寻址暂存 → 合法候选创建成功，补丁含源码引用替换 + 新资产文件写入（`public/media/…`）。
- 导入校验负例全部 fail-closed：伪造格式头、扩展名与字节格式不符、暂存哈希缺失/篡改、记录字段级篡改。
- 可追溯性：来源（local-file / external-url-reference）、暂存哈希、候选目标三方互查；记录自带完整性哈希，字段级篡改即拒读。

青野当前仍无目标图片能进入合法候选：B1（export const 常量无节点）与 B2（unknown 影响在 A 核心候选门控 `candidate.ts:94` 被无条件拒绝，用户全量 Scope 不豁免）。解锁路径 = 本地导入 + B1 修复。

## 2. AssetImportRecord（记录合同）

```ts
interface AssetImportRecord {
  schema: 'asset-import-record/v1'
  importId: string            // import-<stagedAssetHash 前 12 位>
  source:                     // 来源可追溯（保留原外链 ↔ 本地化结果关系）
    | { kind: 'local-file'; value: string }             // 原始文件名（用户上传路径语义）
    | { kind: 'external-url-reference'; value: string } // 被替换的原始外链 URL（不抓取，仅记录）
  stagedAssetHash: string     // SHA-256，与暂存区内容寻址身份一致
  format: 'jpeg' | 'png' | 'webp' | 'gif' | 'avif'      // 格式头嗅探结果
  canonicalExtension: string  // 规范化扩展名（.jpg / .png / …）
  byteSize: number
  dimensions?: { width: number; height: number }        // JPEG SOF 解析；其他格式/截断文件缺省
  assetRef: string            // 写入源码的引用（/、./、../ 开头，与 format 扩展名一致）
  targetRef?: string          // 计划修改的 sourceRef（media:…）
  sourceRevision?: string     // 候选 sourceRevision（attachImportToCandidate 登记）
  candidateId?: string        // 关联候选 id（同上）
  confirmation: { confirmedBy: string; confirmedAt: string }  // 用户显式导入确认，必填
  validation: {
    sniffedFormat: SniffedImageFormat
    extensionMatch: true
    decodeGuarantee: 'header-only'   // 能力边界：头识别 ≠ 完整可解码性证明
    validatedAt: string
  }
  importedBy: string
  importedAt: string
  integrity: { algorithm: 'sha256-v1'; recordHash: string }   // 全字段（除 integrity）canonical JSON 哈希
}
```

不变量：

1. 记录一文件（`imports/<importId>.json`），内容以完整性哈希自锚定，任何字段级篡改（含来源 URL）读取即拒。
2. 记录只增不改；唯一允许的后续变更是 `attachImportToCandidate` 的**幂等**候选关联（冲突拒绝，不静默改写追溯链）。
3. `source.kind === 'external-url-reference'` 仅作来源追溯，不代表执行过网络抓取。
4. 候选使用冻结字节：`createCandidate` 经 `readStagedAsset(assetHash)` 取字节，导入后源文件再变不影响候选。
5. 导入记录与 StagedAssetStore 并置，不进 git 跟踪的工程目录。

## 3. API

- `createAssetImport(store, importsRoot, input)`：校验（`assertMediaSwapAsset` 同源）→ 暂存 → 落记录。`confirmedBy` 必填（拒绝隐式导入）；同一字节同语义字段重复导入幂等。
- `readAssetImport / listAssetImports`：读取（完整性校验）/ 列出。
- `verifyImportTraceability(store, record)`：暂存字节 ↔ 记录（哈希/字节数/格式）核对；缺失与篡改原因区分。
- `attachImportToCandidate(store, importsRoot, importId, { candidateId, sourceRevision, linkedBy })`：幂等关联、冲突拒绝、关联后重算完整性哈希。

## 4. 最小正反例（仓库内单测，CI 可复现）

`src/core/asset-import-record.test.ts`（11 项）：

- CI-1 合法 JPEG 导入：暂存、哈希重算核对、SOF 尺寸解析、记录字段完整、幂等重导。
- CI-2 文件头不匹配拒绝（HTML/SVG/MZ 字节）。
- CI-3 扩展名与实际格式不匹配拒绝（PNG 字节配 .jpg）。
- CI-4 暂存哈希丢失或篡改拒绝（缺失/字节不符原因可区分）+ 记录结构破坏拒读。
- CI-5 能力边界：截断 JPEG（合法头、不可解码）放行但 `decodeGuarantee: 'header-only'`；真实可解码性由浏览器 naturalWidth 证据兜底。
- CI-6 未证明 PageImpact 拒绝候选：青野 B2 同形态（整对象 prop 透传 + 成员取值 → asset-candidate 非确定消费），即使用户全量 Scope 也被 `candidate.ts:94` 拒绝；正例对照（可证明目标）候选成功、关联幂等、拒绝串改。
- CI-7 追溯一致性：外链 URL ↔ 暂存哈希 ↔ 候选目标三方互查；记录字段级篡改（改来源 URL）完整性校验拒读；暂存字节篡改追溯拒。
- CI-8 失败路径不修改原项目：三种非法导入 + 拒绝候选后工程 digest 不变、无资产残留、无候选树。
- 用户显式确认必填；external-url-reference 非法形态（非 http/https、空描述）拒绝。

## 5. 待 A 决策的接口问题

1. **unknown 影响的候选路径**：`candidate.ts:94` 无条件拒绝 unresolved 是否保持？D 倾向保持 fail-closed；青野演示需求由 B1 解锁 hero 路径覆盖。
2. **导入记录归属**：作为 D 侧工件随 MEDIA 模块移交，还是由 A 收编为暂存服务的一部分？两种实现 D 均可。
3. **B1 修复后复测**：A/C+D 补上 `export const` 媒体常量提取后，D 以青野 f7e4998a 复测 heroImage PageImpact 并重跑导入正例链。
