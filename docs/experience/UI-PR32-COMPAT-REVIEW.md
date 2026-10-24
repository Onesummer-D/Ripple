# F × UI Agent PR #32 组件级兼容性审查

日期：2026-10-24
审查对象：PR #32 `feat/ui-workbench-visual-20261023`（体验工作台视觉重构，8 提交，base = main）
审查基准：`feat/a-f-joint-acceptance-20261023` @ `9786475`（含 F phase2/3 + 第三批联合验收修复，A 集成线 `652b42c` 已含 phase2/3）

## 一、总体结论

**PR #32 的视觉重构方向与工作台层兼容，但与第三批真实生命周期 UI 不兼容——按现状合入将整体回退 F phase2/3 功能。** 根因是 PR #32 从旧 `main`（`dc32c5f`）切出，其体验层源码不含任何第三批概念（`rollbackAvailable` / `verificationContract` / `approveCandidate` / `applyCandidate` / `rollbackCandidate` 在其实现文件中均为 0 命中）。

## 二、testid 契约对比

### 兼容 ✅

`experience-workbench.tsx`：PR #32 保留全部 9 个共享 testid（`load-error`、`open-project-*`、`approve-feedback`、`blocked-reason`、`dismiss-feedback`），仅新增 `work-deck` 布局容器。工作台层无冲突。

`scope-panel.tsx` 共享部分：`scope-panel`、`candidate-box`、`create-candidate`、`draft-text-input`、`run-verification`、`verification-status`、`verification-shots`、`visual-evidences`、`candidate-error`、`candidate-preview-toggle`、`approval-area`、`demo-approve`、`real-approval-pending` 均保留。

### 不兼容 ❌（scope-panel 缺失 14 个 testid，对应功能整体缺失）

| 缺失 testid | 对应已验收功能 |
| --- | --- |
| `approve-candidate` / `approve-blocked-reason` | 真实审批按钮 + 门控阻断原因（4/7 incomplete 禁止审批） |
| `apply-candidate` / `apply-cancel` | 两步确认应用 |
| `rollback-candidate` / `rollback-cancel` / `rollback-blocked-reason` | 两步确认回滚 + 服务端 `rollbackAvailable === false` 门控（第三批补充修复） |
| `lifecycle-status` / `lifecycle-actions` | 生命周期状态投影（已审批/已应用/已回滚，全部服务端权威） |
| `verification-contract` / `contract-interaction-*` | 验证合同区块：每页标记编辑 + 交互声明（7/7 passed 的必要条件） |
| `verification-assertions` | 七项断言逐项结果展示 |
| `scope-summary` | 范围决策摘要 |

## 三、功能性缺口

1. **审批门控回退**：PR #32 无审批按钮与「最新验证 passed 才开放审批」门控；`real-approval-pending` 语义仍是旧的两态。
2. **生命周期按钮全部缺失**：应用/回滚两步确认、`rollbackAvailable === false` 禁用门控均不存在。
3. **验证合同 UI 缺失**：无合同区块与交互声明表单——按现状合入后，真实工程候选将回到 7/7 恒 incomplete 的状态（联合验收根因修复 #2 会被回退）。
4. **adapter 接口不同步**：PR #32 的 `adapter.ts` / `real-adapter.ts` / `view-model.ts` 均为第三批前版本，缺少 `proposeContract` / `setContractMarker` / `setContractInteractions` 与 `verificationContract` 模型字段。

## 四、合并建议（交 UI Agent 与 A）

1. **必须先 rebase**：PR #32 需以 A 集成线（含 F phase2/3 + 联合验收修复，建议 rebase 到 A 合并联合验收 delta 之后的 SHA）为基重做视觉重构；以旧 `main` 为基无法直接合并。
2. **testid 契约冻结**：上表 14 个 testid 为联合验收 e2e（`e2e/experience-passed-lifecycle.spec.ts`）与组件测试的依赖，视觉重构必须原样保留（可改样式、不可改标识与门控语义）。
3. **冲突热点**：`scope-panel.tsx`（结构重排 + 功能缺口的叠加）、`ripple-xp.css`（双方均大改）、`canvas-stage.tsx`、`page-rail.tsx`（新增组件与我们的点选桥接线需共存）。
4. 建议 UI Agent rebase 后先跑 `npx vitest run src/app/experience` 与 `e2e/experience-real-flow.spec.ts -g 负例`，再请 F 复审一次。

## 五、可吸收的优点

PR #32 的减法版式、证据单行扫描、状态权重统一等视觉方向与 F 不冲突；`work-deck` 布局容器、底部标签页（证据/对照/历史）的交互结构可在我们 rebase 吸收后保留。视觉改善值得保留，功能回退必须避免。
