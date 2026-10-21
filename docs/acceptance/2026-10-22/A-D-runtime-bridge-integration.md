# A+D Runtime Identity 点选桥集成与验收记录

- 日期：2026-10-22
- Draft 集成 PR：#16，源分支 `feat/agent-ad-runtime-bridge-20261022`
- 原 D 审计 PR：#15，保持 Draft，不改动
- 固定合入基线：A `30d68096f6426a6a6c6b292aef819eac064434a9`
- 来源：D `00e3057ce2cacc3b29abb4e6db9f8bebeb246dd9` 的 24 个文件；此次桥接额外更新的文件见下
- 不修改 Candidate、Scope、VerificationReceipt 的编辑和审批门禁；不运行 Bolt、不合并 A/main

## 1. 真实失败根因

GitHub Actions Run [39632922100](https://github.com/Onesummer-D/Ripple/actions/runs/39632922100) 保留的 Playwright trace 提供了点选前的 DOM 证据：

| 来源 | JSX 位置 | 原始实例 ID 特征 | DOM certainty |
|---|---|---|---|
| 原始页面首页 h1 | `jsx:src/pages/HomePage.tsx#112` | `/:jsx:src/main.tsx#128/.../jsx:src/App.tsx#539:jsx:src/pages/HomePage.tsx#112` | `stable-react-instance` |
| 局部覆盖候选首页 h1 | `jsx:src/pages/HomePage.tsx#177` | `/:_r_2_:jsx:src/pages/HomePage.tsx#177` | `unknown` |

注：两处位置差异来自候选 JSX 变换，不能直接用 offset 做跨版本身份比对。

候选生成器在 App JSX 根部插入受控 `<RipplePageForState>{原页面组件}</RipplePageForState>`。原 D 注解器将所有第三方组件包装都按不透明处理，因而拒绝包内页面组件的 React identity boundary。候选标题在**页面初次渲染时**便标为 `unknown`。旧点选桥又直接转发原始 DOM 值，进一步导致未校验版本、页面、重复 key 等风险。

本轮在 `source-annotation.ts` 中仅识别**相对路径精确指向工作区 `.ripple/overrides-runtime.js`、具名导入的 `RipplePageForState`** 作为已知 child-forwarding 包装。自定义同名组件、非该文件导入、未知 HOC 仍保持不透明，禁止将未知身份提升为稳定。候选应生成可追溯的 React 边界并恢复稳定身份。官方 Docker E2E 已在 [Run #39641408116](https://github.com/Onesummer-D/Ripple/actions/runs/39641408116) 复核，包含原有候选标题 `stable-react-instance` 断言，所有工作台身份测试通过。

### 1.1 第二项根因：HTML 模板字符串替换污染脚本

首次 A+D Docker 验收 [Run #39640298383](https://github.com/Onesummer-D/Ripple/actions/runs/39640298383) 共 26 项通过、2 项失败、1 项 Bolt 专项跳过；原 Project 预览无法完成点选，另一条验证产生 24 条 `pageerror`。

从该 Run 的 Playwright trace 直接提取 Vite 预演返回的 HTML，发现 `collectRuntimeIdentitySnapshot.toString()` 序列化代码中的 React Fiber 字段名含有特殊文本 `$'`。原 `transformIndexHtml` 使用 `html.replace('</body>', \`\${script}</body>\`)` 字符串替换，JavaScript 将 `$'` 扩展为被替换文本后面剩余的 HTML（`</html>`），将合法 JS 改成 `name.startsWith('__reactFiber</html>)`，触发 `missing ) after argument list`。

修复为 `html.replace('</body>', () => \`\${script}</body>\`)`，让序列化脚本逐字注入，不触发特殊替换模式。E2E 在真实预演 HTML 中断言 Fiber 字段原样保留，并保持原工作台点选及批准验证原断言，不允许删除/放宽。

### 1.2 正式正反例证据

- [Run #39641408116](https://github.com/Onesummer-D/Ripple/actions/runs/39641408116)（修复代码 commit `314153c68a05232f5fa7612016fd7d4d549a7c5f`）：锁定依赖安装、TypeScript、179 项身份/Project/API 单测、生产构建、Docker 准备与实际浏览器均成功。浏览器共 29 个用例，**28 passed / 1 skipped / 0 failed**；跳过的是需要私有 Bolt 的专项，没有运行 Bolt。
- [Run #39641419514](https://github.com/Onesummer-D/Ripple/actions/runs/39641419514)：独立 D 身份官方 TypeScript/Vitest/Vite/21 个真实身份 Chromium 用例全绿。
- **标准全仓 Ripple CI**：其外网资源真实探针与全量 Vitest 测试属于另一条工作流，需单独核对，不以专用 Docker 绿色冒充全仓完成。

## 2. 点选链路对照

| 环节 | 旧链路 | A+D 新链路 |
|---|---|---|
| JSX 子树 | 生成的 Provider 隔断可证明身份 | 仅透明穿过受信任生成 Provider |
| 点击目标 | 直接取 DOM 的 `data-ripple-instance` | 用随机关联标记选择实际 DOM 节点；finally 清除 |
| key | 原始 `:\~` 占位符可能重复 | 调用 `collectRuntimeIdentitySnapshot`；从 React Fiber key 链解析 |
| 重复计数 | 未检查 | 采集器在**整个 document**检查重复，返回 `sameSourceCount` |
| 协议 | `sourceRef`、实例与 certainty 原值 | 带 `ripple-runtime-identity/v1`、`record`、原因、版本、页面、候选信息的消息 |
| iframe 接收 | 检查 source / previewId / token | 原检查不变，追加 candidateId、patchHash 和 candidateTreeDigest 一致性 |
| 宿主 API | 按源码锚点定位 | 在当前候选 worktree 计算每文件 SHA256，与页面注册的 sourceVersion 比对；拒绝错页或错版本 |
| 确定性 UI | 浏览器自报 certainty 直接显示 | 展示宿主 `assessRuntimeIdentity`/严格解析的结果；无法证明则 `unknown` |
| 授权 | 旧链路没有实例级授权 | **仍不开放实例级 Scope/Override/审批**，只用于源码定位 |

当前候选 API 对收到的采集数据做严格字段和候选绑定检查，对错页、旧版本、过期候选树拒绝；缺失 Fiber、重复 ID、未知身份不得标为稳定，但可保留源码导航。注意：iframe 运行的是用户网页，不能将其任意自报的数据当作防伪签名；当前版本**没有**用这种数据授予任何编辑权限。未来实例级编辑需要可信浏览器端证明、Scope 决策和 Candidate/patch/tree 绑定闭环。

## 3. 修改范围

本轮 A+D 限定变更：
- `src/core/source-annotation.ts`：受信任 `RipplePageForState` 子树透明性。
- `src/core/candidate-preview-vite.config.mjs`：真实采集器、选择目标唯一关联、Fiber key/源码版本/页面/重复记录及协议消息。
- `src/app/ProjectWorkbench.tsx`：消息来源、nonce、previewId、候选补丁/树绑定；只显示宿主侧确定性结论。
- `src/core/local-project-api.ts`：候选 worktree SHA、来源图谱、页面与严格实例解析；降级只导航。
- `src/core/runtime-identity.test.ts`：合法/非法 Provider 的 AST 注入回归。
- `e2e/project-workbench.spec.ts`：真实候选标题注入与采集正例、页面/候选/源码版本负例、unknown 降级。
- 此文档：复现证据和审查界限。

原 D 151+ 身份测试与 21 项真实 Vite E2E 保留，正式 CI 的通过数量和失败项以每次 Head SHA 对应 Actions 工件为准。

## 4. 与 C PR #11 的接口交集

C 与 D 都修改 `src/core/project.ts`，但变更逻辑分别集中在 C 的静态 Route/SourceGraph 消费关系、D 的 Runtime Identity 版本校验和严格解析。D 本次基于最新 A 的代码集成，**没有**导入 C PR #11。未来独立合并 C 时需要检查 `inspectDataRouter`、`analyzeProject`、`resolveJsxSourceElement`、router 的页面证明及同一候选的运行时 sourceRef 版本绑定。C 的新 data-router 支持不应被直接当作 D 的实例权限证明。

## 5. 测试与风险门槛

必须依次确认：`npm ci`、`npm run typecheck`、`npm test -- --run --no-file-parallelism`、`npm run build`、`npx playwright test e2e/source-identity.spec.ts`、`npm run test:browser`。所有运行都来自锁定依赖的真实 GitHub CI；**Docker 完整 E2E 与独立 D 身份专项必须分别记录**。

- P0：任何未绑定候选、源码版本、页面或唯一选择记录的结果，**绝不能**授权实例级操作。
- P1：旧 `project-workbench.spec.ts:272` 断言必须保持，真实候选标题由原来 unknown 恢复为稳定才可通过；旧 D 的身份单元/浏览器测试不得变弱；C+D 后续另做联合验收。
- P2：Fiber 是 React 内部字段，缺失就 fail-closed；SPA 同窗口异路由及复杂 HMR 场景仍有覆盖率/证明局限。

专用真实 Docker 工作台验收已通过；标准全仓 CI（包含真实外网资源探针）的完成状态仍应在 PR 检查中单列审查。当前代码实现只支持可信导航定位，**运行时单实例编辑授权仍未开放**。A+D Draft PR #16 不合并，交独立 Agent 审核后由负责人统一决定集成。
