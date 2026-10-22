# Real Adapter 第一阶段报告（F 体验工作台 × 真实 A 后端）

> 2026-10-22 · 分支 `feat/integration-f-real-adapter-20261022` · 基线 `feat/project-first-core-20261018 @ 2525092`（PR #14 合入后）
> 目标：实现真正读取 A+D 工程状态的 Real Adapter，把已存在的真实数据映射到 F 工作台。本阶段只读映射 + 本地意向，不开放真实 Approval/Apply。

## 1. 交付内容

| 项 | 位置 | 状态 |
| --- | --- | --- |
| Real Adapter（真实响应 → ViewModel 映射，generation 过期守卫） | `src/app/experience/real-adapter.ts` | 可用 |
| Adapter 异步契约升级（可选 `openProject/refresh/dispose`，demo 零改动） | `src/app/experience/adapter.ts` | 可用 |
| ViewModel 真实扩展（`preview/projectIdentity/blockedReasons`） | `src/app/experience/view-model.ts` | 可用 |
| 真实模式入口（`?adapter=real[&project=…]`，默认仍为 demo） | `src/experience-main.tsx` | 可用 |
| 打开工程表单（未选择/分析失败/成功重试） | `experience-workbench.tsx` | 可用 |
| 真实画布（iframe 仅加载服务端核验的预演地址，隔离属性同 A；不可用如实显示） | `components/canvas-stage.tsx` | 可用 |
| 真实编辑目标条（隔离 iframe 不可跨文档点选，targets 以列表选中） | `components/canvas-stage.tsx` | 可用 |
| 真实工程标记（顶栏 chip + projectId 短码） | `components/top-bar.tsx` | 可用 |
| 单测 10 项（映射/缺失状态/异步契约） | `real-adapter.test.ts` | 10/10 过 |
| 工作台 real 流程单测 3 项 | `experience-flow.test.tsx` | 20/20 过（含 demo 17） |
| E2E 3 项（真实后端 analyze → 真实界面） | `e2e/experience.spec.ts` | 18/18 过（含 demo 15） |
| 浏览器验收 + 截图脚本 | `scripts/xp-real-acceptance.mjs` | 通过（9 项断言 + 控制台零错误） |
| 真实工程截图 | `docs/experience/xp-real-1~3-*.png` | 真实 Chromium 截取 |

未触碰任何 `src/core/*` 与 `src/app/ProjectWorkbench.tsx`；旧工作台与 Bolt 验收路径不受影响。

## 2. Adapter 接口变化（最小升级）

原有 6 个方法签名不变（`load` 本就异步；五个同步派生方法保留，demo 能力与测试原样）。
新增三个**可选**方法构成异步契约：

```ts
interface ExperienceAdapter {
  // …原有方法不变…
  openProject?(projectRoot: string): Promise<ExperienceViewModel> // 打开/切换工程：旧数据全部失效
  refresh?(model): Promise<ExperienceViewModel>                   // 重拉服务端状态，候选身份变化时重建 Evidence/Scope
  dispose?(): Promise<void> | void                                // 停止预演会话（POST project/preview/stop）、作废在途请求
}
```

异步语义（`adapter.ts` 头注释为准）：

- **过期响应丢弃**：每次 `load/openProject/refresh/dispose` 自增 generation，任何 `await` 之后校验，不匹配即抛 `StaleResponseError`，绝不把旧工程/旧候选投影进新模型（单测覆盖）。
- **工程切换失效**：`openProject` 先清空 analysis/history/preview/选择/草稿/范围意向，再重新 analyze。
- **候选切换失效**：`refresh` 全量重建；目标 sourceRef 不存在时自动清除选择与草稿（`buildModel` 内）。
- **错误与重试**：analyze 失败（工程不存在/权限不足/工作树不干净）把服务端错误原文透出 → 工作台 fatal 态显示「重试」；`openProject` 失败 → 表单内准确原因，可修正后重试。
- **资源清理**：工作台卸载时 `dispose()`；无预演会话时不发 stop 请求。
- **身份一致性**：`projectIdentity`（projectId/sourceDigest/gitCommit/graphId）与每条验证证据 detail 中的 `候选/运行/补丁/Scope 版本` 均来自同一 analyze/history 响应，不跨源拼接。

## 3. API 字段映射表

| ViewModel 字段 | 真实来源（API） | 映射规则 |
| --- | --- | --- |
| `projectName` | analyze `projectRoot` | 目录基名（如 `site`） |
| `projectStatus` | analyze 结果 | 成功 `ready`；无工程 `unavailable`；失败抛错（工作台 fatal + 重试） |
| `projectIdentity` | analyze `revision`/`graphId` | projectId/sourceDigest/gitCommit/graphId 原样 |
| `pages[]` | analyze `routes[]` | id/label/path(`page`)；未选中目标时 relation `unproven`/certainty `unknown`/scope `undecided`（绝不预置演示关系） |
| `elements[]` | analyze `targets[]` | label/value→currentText/location.path→sourcePath/`impact.certainty`→certainty/`impact.pageRefs`→impactPageRefs/`impact.unresolved`→unresolvedReasons；`editable = certainty==='source-proven' 且无 unresolved` |
| `preview` | POST `project/preview` | url/projectId/previewId/sourceDigest；iframe 唯一可信地址来源 |
| `canvasState` | 预演会话 | 有会话 `ready`；启动失败 `unavailable` + `blockedReasons` 原文（如 Docker 池为空） |
| `candidateStatus` | history[0]（本工程过滤后） | approval→approved；applied/rolled-back/stale 原样；discarded→none；active 按验证 passed/risks→verified，否则 candidate；无历史→none（本地草稿/选中不改写它） |
| `evidence[]` | analysis.unresolved/relationCounts + history[0].verification | 来源分析→`source-graph`（unresolved 非空→risk）；浏览器验证→`runtime-observation`，状态原样（not-run/failed-to-run/stale 不透出为 pass）；断言失败逐条摘要；browserErrorDetails 单列 risk；选中+草稿→`user-choice`。无 `ai-suggestion` 项（真实模式不臆造 AI 建议） |
| `versions[]` | GET `history`（`projectId` 过滤） | candidateId→id；`候选 <patchHash前8位>`→title；lifecycle active→candidate 其余原样；updatedAt 格式化；`pageRef: ''`（历史 API 不提供页面归属，不臆造）；证据可用 = passed/risks/有 artifactUrl |
| `viewports[]` | 固定四视口 + history[0].verification.evidence | 有该宽度截图→`available`；有运行无截图→`in-verification`；无运行→仅 390 `in-verification`（同 A 基线口径，待 E 驱动） |
| `compare.candidate` | verification.evidence（匹配当前视口宽度且有 artifactUrl） | `ready` + 真实 artifactUrl；否则 `unavailable` + 准确说明 |
| `compare.baseline` | —（API 未提供基线截图） | 恒 `unavailable` + 说明，绝不放演示替代图 |
| 页面关系投影 | `projectPageRelations()`（view-model 纯函数） | `elementPageRef` 仅当 `impact.certainty==='source-proven'` 且**唯一**消费页；多页/未证明传空（不推断）；`provenUnaffectedRefs` 仅接受 C 的真实数据（当前不传） |

## 4. 真实数据来源及缺失状态

| 数据 | 来源 | 缺失时的界面状态 |
| --- | --- | --- |
| 工程身份/页面/目标 | analyze | 未选择工程：顶栏「工程不可用」+ 打开工程表单 + 阻断原因；analyze 失败：错误原文 + 重试 |
| 真实画布 | project/preview（Docker 隔离） | 画布横幅「真实预览不可用：<服务端原因>」；无 Docker 本机/CI 行为一致；两态均有 E2E 覆盖 |
| 真实截图对照 | verification.evidence artifactUrl | 「尚无真实截图」×2 + 「两端视口不一致」如实提示 |
| 验证证据 | history→verification | 「浏览器验证（真实）· 尚未运行/运行失败/已过期」原样透出，detail 带候选/运行/补丁身份 |
| 历史版本 | GET history | 空列表如实展示（胶片无伪造条目）；验证状态随条目标注 |
| 运行时实例身份 | D 点选（预留挂点 `attachRuntimeIdentity`） | Evidence detail 明示「尚未采集，不臆造实例确定性」；`sourceRef 唯一 ≠ React 实例唯一` |

## 5. 可用与尚未开放的用户操作

可用（第一阶段）：

1. `experience.html?adapter=real` 打开真实模式，`&project=` 直接打开工程，或表单输入本机 React/Vite 目录「分析并打开」。
2. 查看真实工程状态、页面列表（未证明关系如实标注）、已分析编辑目标（确定性胶囊）。
3. 查看真实画布（Docker 可用时）或准确的不可用原因；加载状态明确。
4. 选中目标 → 查看真实源码路径/来源确定性/影响页；输入本地草稿（候选生命周期不被改写）；做本地范围意向。
5. 查看真实历史（补丁身份、生命周期、验证状态、证据可用性）。
6. 所有不可操作项均有准确阻断原因（审批未接入、预览不可用、来源未知只能查看等）。

尚未开放（按任务书禁止事项，UI 不提供假入口）：

- 真实候选创建（draftAfterText/Scope 不 POST `/candidate`）、真实 Approval/Apply/Rollback、Scope Override。
- 画布内点选（D 选择桥接待接入，挂点已留）；精准实例修改（无来源证明一律不允许）。
- 跨页面关系增强（C 的 `provenUnaffectedRefs`/`pageRelations` 数据合同挂点已留：`attachSourceRelations`）。

## 6. 回归结果（本机 Windows，CI 为权威）

- `npm run typecheck`：通过。
- 体验层定向：`real-adapter.test.ts` 10/10 + `experience-flow.test.tsx` 20/20 + `view-model.test.ts` 23/23 = 53/53 过。
- `npx playwright test e2e/experience.spec.ts`：18/18 过（含 3 项真实后端用例）。
- `npm run build`：通过（`tsconfig.node.tsbuildinfo` 已按 HANDOFF 机制恢复 A 基线字节）。
- `node scripts/xp-real-acceptance.mjs`：9 项断言通过，控制台零意外错误，截图 3 张。
- 全量 `npx vitest run`：438 过 / 2 跳过；失败集中于 5 个 `src/core/*` 文件（runtime-identity 34、project 21、project-data-routes 43、preview-optimize-deps 1、preview-resource-policy 2），失败原因均为已记录的本机环境限制（Windows 临时目录 EPERM，含中文路径 mangling）。本轮未触碰任何 core 文件，`git status` 可证；Linux CI 为权威结论。
- `npm run test:browser`（Docker 全量）：本机无 Docker，未跑（与 HANDOFF 相同限制）。
- 旧工作台 `src/app/ProjectWorkbench.tsx`、`src/main.tsx` 零改动，Bolt 验收路径不受影响。

## 7. C+D 集成后的后续接入清单

1. **C（source-graph 消费关系增强）合入后**：把 B/C 已证明的页面关系填入 `attachSourceRelations({ provenUnaffectedRefs, pageRelations })`——`provenUnaffectedRefs` 是唯一允许页面升级为 `unrelated/source-proven/exclude` 的通道；未证明页继续保持 unknown。体验层投影逻辑（`projectPageRelations`）无需再改。
2. **D（DOM→Source 点选）接入**：画布内点选走 A 同款选择桥（`runtime-selection-bridge` 的 `isCurrentPickerEnvelope`/`assessPickerDisplayIdentity` + POST `project/source-selection`），结果注入 `attachRuntimeIdentity()`；`identityCertainty` 不达 `stable-keyed-instance`/`stable-react-instance` 时维持「不允许精准实例修改」的展示口径。
3. **真实候选生成**：把本地 draftAfterText + 范围意向映射为 A 的 `EditOperation/ScopeDecision` POST `/candidate`（需要负责人确认体验层发起候选的产品口径；当前 API 能力已在 A 侧完整存在）。
4. **真实审批**：保持「体验层无 Approval/Apply」原则，审批入口继续指向 A 工作台，或按负责人决定接入 `/candidate/approve`（需 Receipt 生命周期展示，替换演示反馈）。
5. **E 视觉证据**：390 视口「验证中」标注与 `compare.baseline` 在 E 提供四视口基线截图 artifact 后接入（当前均如实不可用）。
6. **预演资源授权**：`previewResources` 授权管理 UI（当前只读展示未做）。
