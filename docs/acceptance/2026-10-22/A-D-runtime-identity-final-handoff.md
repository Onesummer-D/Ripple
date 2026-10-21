# Ripple A+D Runtime Identity 点选桥 · 最终集成验收交接

日期：2026-10-22  
状态：**已完成独立源码审查；允许纳入 A 的导航定位功能集成范围。PR #18 保持 Draft，等待负责人合并；D 独立开发正式结束。**

## 1. 唯一集成入口与来源

| 事项 | 固定证据 |
| --- | --- |
| **唯一正式 A+D 集成入口** | [PR #18](https://github.com/Onesummer-D/Ripple/pull/18)（Draft，禁止自动合并） |
| PR #18 Base | `feat/project-first-core-20261018` |
| A 验收基线 | `30d68096f6426a6a6c6b292aef819eac064434a9` |
| PR #18 已验收代码 HEAD | `a79f0cff5ab0a7103887af522cc35d64cd99b993` |
| D 代码源 | [PR #15](https://github.com/Onesummer-D/Ripple/pull/15)，`00e3057ce2cacc3b29abb4e6db9f8bebeb246dd9` |
| 正式全仓 CI | [Run #39650178433](https://github.com/Onesummer-D/Ripple/actions/runs/39650178433)，结论 `success`，绑定上述已验收代码 SHA |

**历史 PR 不要重复合并：**
- **PR #15**：D 原始 Patch/ZIP 恢复、固定基线审计及官方身份专项验证的**历史审查成果**。
- **PR #16**：早期 A+D 桥接的**中间集成审查成果**，含前期诊断与阶段测试；不得与 PR #18 同时合入 A。
- **PR #18**：收束 D 原始实现、可信 Provider 修复、真实点选桥、宿主绑定、正式回归和独立审查的**唯一正式集成入口**。
- **C PR #11** 和 **B PR #17** 均属不同工作线，本轮没有 cherry-pick、合并或修改它们的代码。

**注意 CI 与文档提交的归属**：本 Handoff 是在代码验收通过后追加的**纯文档提交**，因此该文档提交产生的新 HEAD 与 `a79f0cff` 不同。上述 408/408 与 30/30 测试对应的是 `a79f0cff`，新 HEAD 的 Actions 状态必须单独核对，不能误写为已自动完成。

## 2. 真实失败根因与修复范围

旧 Docker Workbench 测试点击候选首页 `<h1>`（`jsx:src/pages/HomePage.tsx#177`）时预期 `stable-react-instance`，实际 `unknown`。原始 DOM、`collectRuntimeIdentitySnapshot()` 都显示 `unknown`，不是采集器或宿主单独引入的降级。Fiber 父链与真实 Vite 转换产物表明：A 候选生成器插入的 `RipplePageForState` 阻断 D 注解器证明 `<HomePage/>` 的组件边界。

**已解决**：`src/core/source-annotation.ts` 仅在组件具名导入解析到候选生成的 `.ripple/overrides-runtime.js`、目标为非符号链接普通文件且实际内容 SHA-256 为标准值 `910b34dbb01740e72a4bc04fbb33b142049a63502dcbeb8c65201bb75e793815`，且名称不被遮蔽时，认可这一 `RipplePageForState` 为可证明的透明子元素 Provider。其他不透明自定义组件仍 fail-closed。

桥接早期真实失败的另一原因：HTML 的字符串形式 `replace` 将采集器源码中的 `__reactFiber$'` 误当成替换序列并破坏 JS，触发 `missing ) after argument list`。现由 `candidate-selection-bridge-html.ts` 使用函数式替换，附有防回归单测。

## 3. 点选链路：前后对照

| 环节 | 旧链路 | PR #18 最终链路 |
| --- | --- | --- |
| React 组件边界 | 受控 Provider 内页面身份 `unknown` | 严格验证的生成 Provider 内保持可证明边界 |
| 目标关联 | 直接读取被点击元素的 DOM 属性 | 一次性 DOM 关联标记，`finally` 清除，采集器精确匹配 |
| 列表实例 | 可能带未解析 `:~`，无重复检测 | `collectRuntimeIdentitySnapshot` 补全 React Fiber key，检查整个文档重复与同源数量 |
| 传输 | 原始 `data-ripple-instance`、certainty 直接转发 | `ripple-runtime-identity/v1`，包含 resolved ID、reasons、sourceVersion、页面上下文、sameSourceCount |
| 接收 | iframe 及选中标识校验有限 | 宿主核对 source、previewId、nonce、异步 generation，拒绝旧预览及旧选择 |
| 来源版本 | 自报字符串易与候选失配 | 可信 API 从当前项目/候选 worktree 计算源码 SHA-256，核对 candidateId、patchHash、candidateTreeDigest、sourceRef 和文件版本 |
| 身份显示 | 直接显示 iframe 提供的 certainty | `assessPickerDisplayIdentity` 校验，无法证明则 `unknown` |
| 编辑权限 | 无实例级编辑授权 | **仍只有 `navigation-only`，不开放 Scope/Override/审批** |

网页脚本可以伪造同一 iframe realm 的消息；`postMessage` 及前端显示不能当作独立可信的编辑授权。最终代码没有修改 Candidate、ScopeDecision、VerificationReceipt、Apply、Rollback 的授权门槛。

## 4. 官方验收与证据

**[GitHub Actions Run #39650178433](https://github.com/Onesummer-D/Ripple/actions/runs/39650178433)：`completed / success`，代码 SHA `a79f0cff`。**

- `npm ci` 与锁定 React/Vite 预演依赖：通过；
- `npm run typecheck`：通过；
- Vitest：**38 个测试文件，408/408 通过**；
- `npm run build`：通过；
- Chromium/Docker：环境及隔离候选预演检查通过；
- `npm run test:browser`：**30/30 通过，另有 1 项专用 Bolt 测试跳过，0 失败**；未触发 Bolt；
- 原真实候选标题 `stable-react-instance` 断言：**原样保留并通过**；
- 原 21 项真实 Vite 身份 E2E：全部通过；无放宽原断言。

真实 `<h1>` 采集诊断：raw certainty 与 collector certainty 均为 `stable-react-instance`；sourceVersion 存在；`sameSourceCount=1`；`reasons=[]`；实例路径包含已证明的 main/App/页面边界。

新增/保留回归包括：受信任 Provider 及伪造/改写/别名/遮蔽负例、HTML 特殊替换字符负例、11 项 iframe/previewId/nonce/源码版本/页面/重复实例/unknown/navigation-only 拒绝边界，以及真实工作台端到端测试。

## 5. 与 C、B 的接口集成待办

### C PR #11（由负责人后续安排；本轮不合并）

双方均修改 `src/core/project.ts`。C 重点是 `inspectDataRouter`、静态 React Router/Data Router 来源关系、组件 import/export/barrel 解析与 SourceGraph 消费证明；D 重点是 `createRuntimeSourceMap`、`resolveRuntimeElement`、`resolveRuntimeInstance` 的严格版本、页面和实例检查。原审查见 C 的改动文本区段可在 D 版本匹配，但**没有 C+D 同分支正式类型检查/真实浏览器回归**。

后续应独立验证：Router → SourceGraph route/sourceRef → runtime identity → candidate/版本/页面 fail-closed；不能借 C 的静态来源证明直接开放 D 的实例编辑权限。

### B PR #17（必须提醒 B）

B 的 `src/core/candidate-preview-vite.config.mjs` 与 D PR #18 **有直接文件级交集**。B 在此文件引入 `previewCspForRequest`、`requestCsp()` 及按请求区分的字体 CSP 逻辑；D 在同文件引入 `collectRuntimeIdentitySnapshot`、`insertCandidateSelectionBridge`、基于临时 DOM 关联的选择器与 `ripple-runtime-identity/v1` 消息。

B 后续同步 A 时必须**手工保留双方逻辑**，不能直接覆盖文件、恢复旧的 DOM 属性点选方案或退回字符串形式 HTML 注入。推荐合并后检查：
1. B 的 request-scoped CSP（仅授权字体依赖场景放行）及其相关测试；
2. D 的采集器、Fiber key、版本/页面上下文、host 拒绝校验和防 `$'` 注入单测；
3. 官方 typecheck、Vitest、build、真实 Docker/Playwright；保留原 `stable-react-instance` 断言；
4. Candidate/Scope/VerificationReceipt 仍按原授权规则执行。

## 6. P0/P1/P2 与移交结论

- **P0：无新增阻塞**。现实候选页面的可证明实例身份已恢复，定位过程 fail-closed。**实例级精准编辑、单实例 Scope Override 仍无授权，维持关闭。**
- **P1：当前固定 A 基线上的 A+D 导航定位集成已经通过源码独立审查与正式 CI，没有已知的新增确定性 P1**；C+D 以及 B+D 合并后，需分别重新完成联合验收。
- **P2：继续跟踪 React Fiber 内部字段、复杂 HMR/workspace、React Compiler 与极端运行时边界；本轮不扩展实现。**

**结论：PR #18 是唯一后续正式 A+D 集成入口。历史 PR #15/#16 不得重复合并。交回负责人统一安排；D 不再新增代码，不自行合并 A/main/C/B，不触发 Bolt。**
