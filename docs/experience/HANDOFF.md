# Ripple 产品体验工作台（F Agent）交接文档

> 2026-10-22 · 分支 `feat/f-product-experience-20261021` · 基线 `feat/project-first-core-20261018 @ 30d6809`（已合入 PR #13）

## 1. 本轮交付

| 项 | 位置 | 状态 |
| --- | --- | --- |
| 体验工作台框架（画布优先布局） | `src/app/experience/experience-workbench.tsx` | 可用 |
| ViewModel 契约 + 纯函数（范围汇总/审批门控） | `src/app/experience/view-model.ts` | 22 项单测过 |
| 适配器接口 | `src/app/experience/adapter.ts` | 定义完成 |
| 青野演示适配器（DEMO/SIMULATED 全程标记） | `src/app/experience/demo-adapter.ts` | 可用 |
| 视觉组件（顶栏/页面导航/画布/范围/证据/对照/胶片） | `src/app/experience/components/` | 可用 |
| 设计系统（ripple-xp- 命名空间） | `src/app/experience/ripple-xp.css` | 可用 |
| 独立演示入口 | `experience.html` + `src/experience-main.tsx`（已加入 vite 构建输入） | 可用 |
| 演示流测试（8 项连续操作）+ ViewModel 测试（含二轮新增：审批确定性门控、原文/草稿分离、切换元素清空草稿） | `src/app/experience/*.test.tsx?` | 22/22 过 |
| 浏览器 E2E（11 项：初始/选中编辑/来源未知/Scope 阻断/无选中无修改不得审批/三视口切换/模拟内容不进 real/历史切换/桌面与窄窗布局/截图/控制台错误 + 原文草稿分离专项） | `e2e/experience.spec.ts` | 11/11 过 |
| 界面截图 | `docs/experience/xp-1-initial.png` ~ `xp-4-history-mobile.png` | 真实 Chromium 截取 |
| 截图脚本（可复录） | `scripts/xp-screenshot.mjs` | 可用 |

未改 `src/app/ProjectWorkbench.tsx`、`src/main.tsx` 及全部核心文件（model/session/candidate/project/scope/source-annotation/verification-*）。旧系统测试零删减。

## 2. 界面状态表

| 状态 | 出现位置 | 表达 |
| --- | --- | --- |
| 来源已证实 / 部分证明 / 未知 | 页面导航、选中摘要、范围行 | 三色胶囊（绿/黄/灰），文案统一从 `CERTAINTY_LABEL` 出口 |
| 工程就绪 / 分析中 / 失败 / 不可用 | 顶栏 | 状态 chip |
| 候选：无/草稿/已生成/验证/审批/应用/回滚/失效 | 顶栏 | 状态 chip（演示数据下不会越过"候选已生成"——验证之后是真实能力） |
| 视口 1440/768/375 | 画布工具条 | 主入口按钮 |
| 视口 390 | 画布工具条 | 标注「验证中」，badge 明确 |
| 画布：加载中/失败/不可用/证据过期 | 画布区 | role=status 横幅 + 失败重试按钮（演示模式下由「演示状态」切换器驱动） |
| 证据：通过/风险/未知/未运行/已过期/运行失败 | 证据面板 | 六态胶囊 |
| 版本：候选/已应用/已回滚/已失效 | 版本胶片 | 生命周期胶囊 + 证据可用性 |
| DEMO | 顶栏常驻 chip；对照区与画布附注 | 演示数据不得进入真实 Approval/Apply |

## 3. 审批门控（体验层强制，不依赖后端）

`approvalGate()`：存在未决定页面 → 拒绝；unknown/partial 页面被包含进范围 → 拒绝（"不得提升为安全范围"）；**选中目标来源确定性不是 source-proven（partial/unknown）→ 拒绝**（二轮新增：`editable` 只代表演示编辑资格，不代表来源已证明）。演示按钮文案明确"演示审批（不写入真实工程）"。

二轮收束新增约束：

- real 模式（非演示数据）不提供可执行的审批入口，只显示「真实审批尚未接入（集成阶段接入）」，不存在点击后退回演示提示的假入口。
- 原文与草稿分离：画布始终渲染原始 `currentText`，候选值仅存入独立 `draftAfterText`；切换元素清空草稿并重置候选状态，Evidence 描述的原文与修改内容逐字准确。
- 对照组件 `RealShot` 按 imageUrl 重挂载，加载失败状态不跨 URL 滞留。

## 4. 适配器接口清单（缺口 → 需各 Agent 提供）

`ExperienceAdapter.load/selectElement/setDraftText/setPageScope/setViewport/setPage` 返回 `ExperienceViewModel`。真实实现映射来源：

| ViewModel 字段 | 需要谁提供 | 现状 |
| --- | --- | --- |
| `pages[].relation/relationCertainty` | B：SourceGraph 消费关系 + `sourceProvenPageImpact` | B 已有（PR #4），需接 `/__ripple/api` 的 analysis.targets |
| `elements[].sourceRef/sourcePath/certainty/impactPageRefs` | B 来源分析 + D：DOM→Source 点选（sourceRef、identityCertainty） | D 的点选已在 A 工作台可用，需以同样接口暴露给体验层 |
| `draftAfterText → 候选` | A：EditSession/Scope 创建 CandidatePatch | A 的 `localProjectApiPlugin` 已有全链路 |
| `compare` 真实截图 | E：Visual Evidence（四视口截图 artifactUrl + artifactHash） | E 负责；体验层只读 |
| `evidence[]` | A：VerificationRun assertions/evidence + `attestBrowserExecution` 结果 | A 已有；NOT_RUN/FAILED_TO_RUN/STALE 必须原样透出 |
| `versions[]` | A：历史 API（`GET /__ripple/api/history`） | A 已有，字段可直接映射 |
| `canvasState` | A：预演实例状态（预览加载/失败/不可用）与证据新鲜度 | 待 A 暴露 |

## 5. 体验说明

- 演示流按任务书第五节：打开 → 选中活动标题 → 输入新标题 → 关联页面（左侧与范围行同步）→ 范围决策 → 前后对照 → 证据/风险/未知 → 版本历史。全部交互可连续执行，无死按钮。
- 真实画布为视觉中心；首屏无"CandidatePatch/哈希"等术语（源码路径仅在选中摘要与渐进展开处出现）。
- `prefers-reduced-motion` 已全局降级；键盘可达（画布元素 role=button + Enter/Space）。
- 窄窗口（<1100px / <760px）重排为可操作的单列/双列。

## 6. 测试与限制

- `npm run typecheck`：通过（app + node，同步 A 基线后重验）。
- `npm test -- --run --no-file-parallelism`：体验层 22/22 过；全量本机 Windows 29 项失败全部位于 `src/core/*`（project / local-project-api / preview-resource-policy / verification-execution），与 A 在 DEV_HANDOFF 记录的本机环境限制一致（临时 Git 目录权限、loopback relay、需 Linux Chromium），与本轮改动无关——本轮未触碰任何 core 文件，Linux CI 为权威。
- `npm run build`：通过（`dist/experience.html` 与 `dist/index.html` 双入口）。
- `npx playwright test e2e/experience.spec.ts`：11/11 过（本机 Chromium headless shell）。
- 全量 Playwright `npx playwright test`：17 过 / 5 跳过 / 1 失败——唯一失败为 `project-workbench.spec.ts` 的 Bolt 真实工程专项（本机 Windows 临时目录 EPERM + 缺 BOLT 私有凭据，环境限制非代码回归，Linux CI 为权威）。
- `npm run test:browser`：NOT RUN（本机无 Linux Docker Playwright 镜像）。
- 录屏：未录制；可用 `scripts/xp-screenshot.mjs` 同款流程录制。
- 截图已按二轮修复后行为重截（画布原文稳定、对照区呈现草稿），文件 `xp-1-initial.png` ~ `xp-4-history-mobile.png`。
- `tsconfig.node.tsbuildinfo` 已还原为基线版本，不再出现在 PR diff 中。

## 7. 下一轮建议

1. 集成方按第 4 节接 `localProjectApiPlugin`，把 demo-adapter 换成 real-adapter（建议留在 `src/app/experience/real-adapter.ts`，由合并阶段统一挂载）。
2. 390 视口验证状态由 E 的真实证据驱动后移除"验证中"演示标注。
3. 真实挂载入口（替换 `src/main.tsx` 或并存导航）需负责人决定，体验层已准备好最小集成方案：在 `index.html` 增加 `/experience.html` 链接或在主工作台内嵌 `<ExperienceWorkbench adapter={realAdapter}/>`。
