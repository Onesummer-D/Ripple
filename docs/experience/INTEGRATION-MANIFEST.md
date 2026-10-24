# F → A 正式集成差异清单（第三批联合验收移交）

日期：2026-10-24
F 侧分支：`feat/a-f-joint-acceptance-20261023` @ `0cf15b5`
A 侧目标基线：`feat/project-first-core-20261018` @ `652b42c`（A 已完成 phase2/3 集成，尚未含联合验收修复）

## 一、F 独有变更（A 需集成 = 联合验收 delta）

以下均为联合验收分支相对 A 最新集成 HEAD 的增量，即 A 尚未拥有的部分：

### 体验层源码（src/app/experience/）

| 文件 | 增量 | 内容 |
| --- | --- | --- |
| `real-adapter.ts` | +193 | ① `refreshAfterLifecycleWrite()`：apply/rollback 后采用服务端响应内嵌分析，不再重复 analyze（requireClean 误报修复）；② `workflowFromHistory()`：刷新/重开后由历史痕迹（approval/applied/rollback）整体重建 workflow 投影；③ `postWithBusyRetry()`：reload 与旧页 dispose 在 A 预览锁瞬时相撞的有限退避重试（fail-closed）；④ `proposeContract()` 验证合同提案（A 安全路径门控：非根绝对路径整体不提交）；⑤ HistoryItem 增加 applied/rollback 字段（A 正式历史合同） |
| `view-model.ts` | +31 | `VerificationContractXp` 类型与 `model.verificationContract` 字段 |
| `adapter.ts` | +9 | `proposeContract`/`setContractMarker`/`setContractInteractions` 可选接口 |
| `components/scope-panel.tsx` | +96 | ① 回滚门控：服务端 `rollbackAvailable === false` 时禁用回滚按钮 + 阻断原因展示；② 「验证合同」区块：每页标记可编辑输入 + 交互声明表单 |
| `experience-workbench.tsx` | +2 | 合同回调接线 |
| `ripple-xp.css` | +11 | 验证合同区块样式 `.ripple-xp-contract*` |

### 测试

| 文件 | 增量 | 内容 |
| --- | --- | --- |
| `real-adapter-contract.test.ts` | 新增 192 | 验证合同提案/安全路径/提交接线 6 用例 |
| `real-adapter-phase2.test.ts` | +28 | mock 按 A 正式历史合同补 applied/rollback 痕迹 |
| `real-adapter.test.ts` | +60 | 锁冲突重试正负例、workflowFromHistory 终态重建回归 |
| `experience-flow.test.tsx` | +51 | 合同 UI 与回滚门控组件测试 |

### E2E 与文档

| 文件 | 说明 |
| --- | --- |
| `e2e/experience-passed-lifecycle.spec.ts` | 新增 234 行：联合验收 UI 成功路径（点选 → 合同 → 完整 Scope → 7/7 passed → 审批 → 应用/回滚逐字节 → 刷新核对），五步同一 candidateId |
| `docs/experience/JOINT-ACCEPTANCE-REPORT.md` | 验收报告 |
| `docs/experience/joint-acceptance/*.png` ×7 | 七阶段真实界面截图 |

## 二、A 已有、F 分支不具备（A 侧其他集成产物，F 不需行动）

以下差异方向为「A 有、F 分支无」，来自 A 在 F 冻结点后完成的 D MEDIA / codescandy / D3 集成，**不属于 F 变更**，集成时无需 F 侧处理：

- `src/core/media-acceptance-*`、`media-asset-staging/swap`、`media-viewport-evidence`（D MEDIA 模块，A 已自行精简集成）
- `scripts/d3-qiguang-rehearsal.ts`（D3 彩排脚本）
- `src/core/project-config-resolver.*`、`project.ts`、`project-data-routes`、`candidate.ts`、`candidate-preview-vite.config.mjs` 的 A 侧演进

## 三、F 未触碰 A 核心合同

F 的全部增量限于 `src/app/experience/`（体验层）、`e2e/experience-*`、`docs/experience/`。**未修改 A 核心的 SourceGraph、Scope、Approval、Verification、Runtime Identity 合同与七项断言**；未改 B 冻结门控脚本。

## 四、集成建议顺序（供 A 参考）

1. 以 merge 方式将 `feat/a-f-joint-acceptance-20261023` 合入 A 集成分支（或按上表 cherry-pick 体验层增量）。
2. 冲突热点预期：`real-adapter.ts`（A 若已动过 dispose/load）、`scope-panel.tsx`（UI PR #32 也在改，见兼容性审查）、`real-adapter-phase2.test.ts`。
3. 集成后在 A 的 SHA 上复跑 `e2e/experience-passed-lifecycle.spec.ts`（成功路径需 Docker 运行器，CI 实跑）。
