# MEDIA asset-swap 执行器集成说明（B，2026-10-20）

状态：**已按 A 的 CandidateOperationExecutor seam 完成适配，无需修改 A 共享核心**。
集成基线：PR #2 `5225fe3`（双方确认；`7b9981f` 起引入 seam）。

## 架构（与 structured-candidate-executors.md 一致）

```
受信任资产服务（B: createStagedAssetStore，内容寻址暂存区）
    │ store(bytes) → sha256；readStagedAsset(sha256) → 字节副本
    ▼
B 执行器 mediaAssetSwapExecutor（kind MEDIA / action asset-swap）
    │ plan() 同步返回数据，零写盘：
    │   sourceEdits: [{ path, start, end, before, after }]   —— 严格落在 target.location 授权区间
    │   fileWrites:  [{ path: public/... , bytes: readStagedAsset(assetHash) }]  —— create-only 新资产
    ▼
A 候选核心（createCandidate({ executors, readStagedAsset })）
    统一执行写入、授权区间/漂移/重叠/语法校验、Git binary patch、
    patchHash / candidateTreeDigest、完整性校验、审批/应用/回滚。
```

- B 代码：`src/core/media-asset-staging.ts`（暂存服务 + assetRef 布局解析）、
  `src/core/media-asset-swap.ts`（执行器）。不改 candidate.ts / model.ts / session.ts。
- 应用接入：`localProjectApiPlugin({ candidateOperationExecutors: mediaAssetSwapExecutors(), readStagedAsset: store.readStagedAsset })`。

## 授权边界（遵守 A 在 Issue #6 的裁定）

- 只替换**已存在、SourceGraph 可定位、Scope 已证明传播范围**的 src / srcSet 属性值：
  sourceEdit 的 [start,end) 就是 target.location 区间，核心复核原始字节与语法。
- **新增 JSX 属性（如原本没有 srcSet）v1 显式 unsupported**：plan 抛出带用例指引的错误，
  不扩大授权、不字符串插入。如真实青野用例必须新增 srcSet，按 A 要求提交固定源码片段、
  targetRef、预期属性位置、页面消费关系与后置 spread/重复属性负例，协商"同一 JSX 元素内、
  指定属性"的最小授权扩展。
- payload.variants（任何 mechanism）同样显式 unsupported（v1）；
  focalPoint / containerHint 为 Evidence 阶段输入，plan 不消费但不拒绝。

## 语义约定

- `operation.before` = 目标节点源码区间切片（= 原引用值，如 `/images/hero.webp`）；
  `operation.after` = `payload.assetRef`（执行器强制一致，保证候选记录真实）。
- `assetHash` 必须是小写 SHA-256；核心与暂存服务双重复核字节身份。
- assetRef 布局规则（无项目名特判）：`/` 开头 → `public/`（可配 publicDir）；
  `./`/`../` 相对消费文件解析；外部 URL、`..` 段、引号/空格等不安全字符显式拒绝。

## 验证状态（`media-asset-swap.test.ts`，9 项）

- 暂存服务：存取一致、缺失/篡改 fail-closed、身份格式校验、跨 realm 字节判定。
- 执行器 validate：14 组畸形输入（kind/action/before/after/payload/哈希/不安全 assetRef/
  focalPoint/variants/containerHint）全部拒绝。
- 执行器 plan：sourceEdit 落授权区间、fileWrites 路径与受控字节、**无副作用断言**
  （plan 前后工程字节与 git status 完全一致）、variants/after 不一致/目标缺位置显式拒绝。
- 候选核心集成（真实 Git fixture + analyzeProject）：二进制补丁含资产与新引用、
  assertCandidateCurrent 通过、原工程与未授权页面（AutumnPage）不变；
  fail-closed：未注册执行器 / 畸形 payload / 受保护目标 / page-override 结构化操作 /
  调包 readStagedAsset 字节不符。
- 应用/回滚：stageOperations→approve→applyApprovedCandidate→rollbackAppliedCandidate
  复用 A 公共生命周期，应用后树摘要 = candidateTreeDigest，回滚后恢复原基线摘要。

## 已知边界与后续

- 本机 Windows 全量测试存在已知 EPERM 临时目录清理失败（与基线相同，零断言失败）；
  以 Linux CI 为准。
- 四视口图片加载与裁切几何 Evidence 模块（focalPoint/containerHint 消费方）随后续提交
  加入本分支，用于青野真实 MEDIA 纵向闭环的浏览器验证。
