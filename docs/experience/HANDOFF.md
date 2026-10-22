# Ripple 产品体验工作台（F Agent）交接文档

> 2026-10-22（三轮·最终状态一致性整改）· 分支 `feat/f-product-experience-20261021` · 已同步 A 基线 `feat/project-first-core-20261018 @ 83ddff5e`（普通 merge，保留 F 历史）

## 0. 三轮整改记录（最终一致性，2026-10-22）

任务书四项确定性整改，全部完成：

| 任务 | 缺陷 | 修复 | 关键回归 |
| --- | --- | --- | --- |
| P1-1 目标切换页面影响同步 | `selectElement()` 只清草稿/部分 Evidence，不重建 `pages[]` 投影，副标题仍显示商品专题同源、旧 Scope 继承 | 新增纯函数 `projectPageRelations()`（view-model.ts）：以当前 `CanvasElementXp` 重算 relation/relationCertainty/默认 Scope；缺页不升级为"已证明无关"（仅显式 `provenUnaffectedRefs` 才表达 unrelated）；重复点击已选目标不算切换 | 单测 6 项 + 演示流「标题→副标题→标题」+ partial/unknown 不提升负例 |
| P1-2 对照绑定当前目标 | 对照区把原文硬编码为「秋日茶器市集」，候选空时回显旧标题 | `compare-strip.tsx`：Baseline=当前目标 `currentText`，Candidate=同一目标 `draftAfterText`；无目标/无草稿显示「尚未选中要修改的位置」「尚未生成候选」；焦点说明随 `compare.focusArea` 同步；RealShot 逻辑原样保留 | 单测/演示流/e2e 各 1 组空态与副标题对照用例 |
| P2-3 演示审批反馈失效 | 独立 `feedback` 状态跨目标/草稿/Scope 修订残留 | 新增纯函数 `approvalFeedbackStale()`；统一入口 `apply()` 中任何目标/草稿/页面变化立即清反馈，旧确认不跨修订复用 | 单测 4 项 + 演示流/e2e「审批→改 Scope/草稿/目标→反馈消失、门控重阻断」 |
| P2-4 编译缓存变更 | `tsconfig.node.tsbuildinfo` 仍在 PR diff（新增 e2e/experience.spec.ts 索引） | 已从 A 基线恢复字节一致；机制见第 6 节 | PR Changed Files 中该文件已移除（见第 6 节） |

同步方式：普通 merge（`--no-ff`）合入 A `83ddff5e`；A 新提交与 F 修改文件零交集，无冲突、未改任何 core 文件。

## 1. 本轮交付

| 项 | 位置 | 状态 |
| --- | --- | --- |
| 体验工作台框架（画布优先布局） | `src/app/experience/experience-workbench.tsx` | 可用 |
| ViewModel 契约 + 纯函数（范围汇总/审批门控/关系投影/反馈失效） | `src/app/experience/view-model.ts` | 20 项单测过 |
| 适配器接口 | `src/app/experience/adapter.ts` | 定义完成 |
| 青野演示适配器（DEMO/SIMULATED 全程标记） | `src/app/experience/demo-adapter.ts` | 可用 |
| 视觉组件（顶栏/页面导航/画布/范围/证据/对照/胶片） | `src/app/experience/components/` | 可用 |
| 设计系统（ripple-xp- 命名空间） | `src/app/experience/ripple-xp.css` | 可用 |
| 独立演示入口 | `experience.html` + `src/experience-main.tsx`（已加入 vite 构建输入） | 可用 |
| 演示流测试（13 项连续操作，含三轮新增 4 项）+ ViewModel 测试（20 项） | `src/app/experience/*.test.tsx?` | 37/37 过 |
| 浏览器 E2E（15 项：原有 11 项 + 三轮新增 4 项） | `e2e/experience.spec.ts` | 15/15 过 |
| 界面截图 | `docs/experience/xp-1-initial.png` ~ `xp-4-history-mobile.png` | 真实 Chromium 截取 |
| 截图脚本（可复录） | `scripts/xp-screenshot.mjs` | 可用 |

未改 `src/app/ProjectWorkbench.tsx`、`src/main.tsx` 及全部核心文件（model/session/candidate/project/scope/source-annotation/verification-*）。旧系统测试零删减、零跳过、零放宽。

## 2. 界面状态表

| 状态 | 出现位置 | 表达 |
| --- | --- | --- |
| 来源已证实 / 部分证明 / 未知 | 页面导航、选中摘要、范围行 | 三色胶囊（绿/黄/灰），文案统一从 `CERTAINTY_LABEL` 出口 |
| 对照区：尚未选中 / 尚未生成候选 | 前后对照（演示侧） | 明确状态文案；Baseline 恒为当前目标原文，Candidate 恒为当前目标草稿，不回显旧目标内容 |
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

- `npm run typecheck`：通过（app + node，merge A 83ddff5e 后重验）。
- 体验层定向：`view-model.test.ts` 20/20 + `experience-flow.test.tsx` 17/17 = 37/37 过。
- 全量本机 Windows `npx vitest run`：422 过 / 2 跳过；4 个失败文件全部位于 `src/core/*`（runtime-identity 34、project 21、preview-resource-policy 2、preview-csp hook 超时），失败原因均为已记录的本机环境限制（临时目录 EPERM——工作区中文路径在临时目录 mangling、loopback relay、需 Linux Chromium/live egress），与本轮改动无关——本轮未触碰任何 core 文件，Linux CI 为权威。体验层与全部 app 层测试零失败。
- `npm run build`：通过（`dist/experience.html` 与 `dist/index.html` 双入口）。
- `npx playwright test e2e/experience.spec.ts`：15/15 过（本机 Chromium headless shell，含新增 4 项）。
- 全量 Playwright `npx playwright test`：未重跑全量（本机环境限制同前轮）；新增用例均在 `e2e/experience.spec.ts` 内并通过。Bolt 真实工程专项仍需 Linux CI 权威结论。
- `npm run test:browser`：NOT RUN（本机无 Linux Docker Playwright 镜像）。
- 录屏：未录制；可用 `scripts/xp-screenshot.mjs` 同款流程录制。
- 截图：`xp-1-initial.png` ~ `xp-4-history-mobile.png` 仍为二轮修复后行为截取；三轮为状态一致性整改，无视觉变化，未重截。
- `tsconfig.node.tsbuildinfo`：**已核实并恢复**。产生机制：该文件被纳入版本库，`npm run build` 的 `tsc -b` 会按当前工作区文件集合重写它；F 分支新增了 `e2e/experience.spec.ts`，每次本地 build 后该文件都会把新 spec 写入 root 索引而变脏（旧交接声称已还原，但未在 build 之后复核，导致残留进 PR）。处置：每次本地 build/typecheck 后、提交前，执行 `git checkout origin/feat/project-first-core-20261018 -- tsconfig.node.tsbuildinfo` 恢复为 A 基线字节（本轮已恢复并 diff 核对一致）；不改 tsconfig、不删测试、不关闭增量编译。CI 上 build 不产生提交，无此问题。

## 7. 下一轮建议与遗留分级

1. 集成方按第 4 节接 `localProjectApiPlugin`，把 demo-adapter 换成 real-adapter（建议留在 `src/app/experience/real-adapter.ts`，由合并阶段统一挂载）。
2. 390 视口验证状态由 E 的真实证据驱动后移除"验证中"演示标注。
3. 真实挂载入口（替换 `src/main.tsx` 或并存导航）需负责人决定，体验层已准备好最小集成方案：在 `index.html` 增加 `/experience.html` 链接或在主工作台内嵌 `<ExperienceWorkbench adapter={realAdapter}/>`。

遗留分级（截至三轮整改后）：

- P0：无（四项确定性整改全部关闭，无已知状态串扰路径）。
- P1：`projectPageRelations()` 的 `provenUnaffectedRefs` 通道等待 B 的真实来源分析提供"已证明无影响"页面清单；未接入前缺页一律保持未证明（安全侧默认，不会误导）。
- P2：① 演示审批反馈为纯前端状态，接真实 Approval 后应由 Receipt 生命周期替代；② `tsconfig.node.tsbuildinfo` 被版本库跟踪导致 build 后易变脏，建议负责人在 A 侧评估是否将其移出版本控制（超出 F 修改范围，未擅自处理）；③ 本机 Windows 全量 core 测试的环境限制（临时目录权限/loopback/Docker）仍需 Linux CI 作权威结论。
