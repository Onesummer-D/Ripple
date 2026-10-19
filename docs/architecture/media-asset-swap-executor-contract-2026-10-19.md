# MEDIA asset-swap 执行器最小契约需求（B → A，2026-10-19）

状态：待 A 确认。确认前 B 不修改 `candidate.ts` / `model.ts` / `session.ts`。

## 背景

冻结契约 `ripple-edit-operation-session/v1` 已定义 `MediaAssetSwapPayload`（model.ts），
但 `createCandidate` 目前对一切带 `action`/`payload` 的操作直接拒绝
（candidate.ts:372「结构化操作尚无候选执行器，拒绝按字面量替换降级执行」）。
B 已实现 MEDIA asset-swap 执行器（B 侧模块，不改共享核心）：

- `src/core/media-asset-staging.ts` — 资产字节暂存 + SHA-256 校验（哈希不符 fail-closed，拒绝覆盖，符号链接防线）。
- `src/core/media-asset-swap.ts` — `applyMediaAssetSwapOperations(context, operations)`：校验 payload、核对 `operation.before`、计算替换、暂存字节、应用编辑并做 TSX 语法检查，返回修改的项目相对路径（源码 + 暂存资产）。
- `src/core/media-asset-swap.test.ts` — 12 项单测全部通过；`tsc --noEmit` 通过。

## 需要 A 确认的最小核心改动（3 处）

1. **路由而非拒绝**。`createCandidate` 的拒绝分支改为：
   `kind: 'MEDIA'` 且 `action: 'asset-swap'` 的操作放行给 B 的执行器；
   其余带 `action`/`payload` 的操作维持拒绝（未知/畸形/未实现不得降级为字符串替换，与 A 既有防线一致）。

2. **执行器接入点**。`applyOperations`（shared 分支）在字面量替换前先把 MEDIA asset-swap
   操作交给 `applyMediaAssetSwapOperations`，其返回的暂存资产路径连同源码文件一起进入
   `modifiedPaths`。

3. **字节进入哈希链**。暂存资产是 worktree 内的新文件（untracked），需要：
   - 对暂存资产路径执行 `git add --intent-to-add`（与 page-overrides 既有做法一致），
     使其进入 `git diff --binary` 产物，从而纳入 `patchHash`；
   - 纳入 `candidateFiles` 参与 `candidateTreeDigest`（executor 已将其放入 modifiedPaths，
     candidate.ts 现有 `candidateFiles` 合并逻辑可直接复用）；
   - `assertCandidateIntegrity` 的 `git status --porcelain` 白名单基于 modifiedPaths，
     无需改动。

## 语义约定（请 A 一并确认）

- `operation.before` = 目标媒体节点 AST 位置的源码切片（带引号的字符串字面量，如
  `"/images/hero.jpg"`），与 TEXT 操作的 before 校验同策略；执行器核对切片一致后才动手。
- `operation.after` = 执行器计算的替换后切片（如 `"/images/hero-v2.jpg"`）；
  执行器校验 `operation.after` 与计算结果一致，不一致即拒绝，保证 CandidatePatch 记录真实。
- 支持边界（如实记录）：
  - JSX/TSX `src` 属性字符串字面量替换，引号保留；
  - `variants` 中 mechanism `srcset`：在同一 JSX 开始标签设置/替换 `srcSet`；
  - mechanism `picture` / `css` / `container-rule` 与非 JSX 消费（CSS url() 等）显式拒绝；
  - 仅 shared scope；page-override 下 MEDIA 维持 A 既有拒绝。
- `focalPoint` / `containerHint` 暂存期不消费，留给四视口 Evidence 模块使用。

## 验证状态

- `media-asset-swap.test.ts`：12/12（src 替换、before 错位拒绝、缺字节源/哈希不符拒绝、
  srcset 追加与替换、unsupported mechanism 拒绝、after 不一致拒绝、语法检查防落盘、
  覆盖拒绝、篡改复核失败、路径越界拒绝）。
- 全量 `vitest run`：本机 21 个失败均为已知 Windows EPERM 临时目录清理错误（零断言失败），
  与基线一致；Linux CI 为准。
- 四视口图片加载与裁切几何 Evidence 模块随后以独立提交加入本分支。
