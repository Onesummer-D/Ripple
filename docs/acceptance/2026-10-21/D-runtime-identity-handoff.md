# Ripple Agent D：Runtime Identity 恢复与独立验收交接

日期：2026-10-21
状态：Draft PR #15，禁止合并，未经负责人授权不得触发 Bolt。

## 一、恢复基线与证据
- 仓库：`Onesummer-D/Ripple`
- 固定 A 提交：`10a808bb4845a0a947688080a7e97394095517a9`
- 固定基线 Git Tree SHA：`c8bfd701bc71bdda85abebe2978ed714952ab9d0`
- D 原始补丁 SHA-256：`7a531d689e7b0849f1b8614959d0146fb5e34b370ddd8b34e588738608071542`
- D 最终源码 ZIP SHA-256：`61b9fdef4a36b525ea2ae10de46c9f19df7cba3ae2dc9ad741f506e093bb2dea`
- D 原始补丁重放 Git Tree SHA：`63f23d0e4fb40c24db4f258581a58235494385c1`
- 原始恢复提交：`7ac751e9b905e163daa17ebb1642e225c28a773d`（全部 22 个 Blob SHA 与 Patch 一致）
- 独立 D 分支：`feat/agent-d-runtime-identity-20261021`
- 固定 PR 基线分支：`audit/agent-d-base-10a808b`
- Draft PR：https://github.com/Onesummer-D/Ripple/pull/15

ZIP 内 14 处含中文的文件或目录名被存储为 `#Uxxxx` 编码；在重建基础源码树时恢复原始 Unicode 路径后，Git Tree SHA 与 GitHub 上固定 A 提交完全一致。随后从该源码树应用原 Patch，并与解压的最终 ZIP 逐文件对比，一致。GitHub 上传的 22 个原始改动文件亦逐一核验 SHA，无内容差异。

## 二、原始改动边界
- 核心源码：`src/core/source-annotation.ts`、`src/core/runtime-identity.ts`、`src/core/model.ts`、`src/core/project.ts`。
- 测试：`src/core/project.test.ts`、`src/core/runtime-identity.test.ts`、`e2e/source-identity.spec.ts`。
- 浏览器夹具：`e2e/source-identity-fixture/` 下 15 个新增文件。
- 以上总计 22 个原始文件。
- `src/core/candidate-preview-vite.config.mjs`、Candidate、Scope、Verification、验证器相关授权入口未作 D 代码改动。

## 三、正式 CI 与本地环境
上一任开发者在替代 Vite/Vitest 环境报告身份相关 151 项、浏览器 21 项通过；替代环境无法覆盖真实 Vite 的 watcher、configureServer、模块缓存及 React 插件行为，故不构成正式验收。

本次本地环境无法安装 registry 官方依赖：`npm ci` 未完成，类型检查、Vitest、构建和 Playwright 无法作为有效 D 产品验收。

GitHub Actions Run `39631790863`（原始 D 交付提交）：
- `npm ci`：PASS
- 预览夹具安装：PASS
- Playwright Chromium 安装：PASS
- `npm run typecheck`：FAIL，`TS6142: e2e/source-identity-fixture/cells.ts` 转引 `Cell.tsx`，而 `tsconfig.node.json` 未启用 JSX
- 单测、构建、Docker、浏览器检查：因此 SKIPPED

针对性修复：将无 JSX 的 barrel 文件 `cells.ts` 更名为 `cells.tsx`；`e2e/source-identity.spec.ts` 的夹具文件清单更新至新路径；同步更新 `Cell.tsx` 注释。未更改身份算法、授权规则或 CI 配置。修复后 commit `a48fbac53225858e6ecaf65f5040c03ead6b4e64`。

正式 CI 后续运行的通过/失败情况，应以 PR #15 的 Actions 和日志为准，不从之前替代环境推断。

## 四、与 C PR #11 的交集
文件交集仅 `src/core/project.ts`；其他原始 D 改动文件无交集。
C 在 `project.ts` 的改动：
1. 引入 `inspectDataRouter`；
2. 完善 `ComponentInfo` 默认导出及 import/export 组件符号解析；
3. 增加静态 Route JSX 配置过滤；
4. 在 `analyzeProject` 中形成 data-router 来源图谱、路由到组件的渲染边；
5. 调整别名未解析与 JSX 文本消费的保守证据标记。

D 在同一文件的改动：
1. 收紧 `createRuntimeSourceMap`：拒绝重复、未知/未映射身份和降级原因；
2. 扩展 `resolveRuntimeElement`：版本、页面、`navigation-only`/`strict`；
3. 新增 `resolveRuntimeInstance` 强校验入口。

**结论**：这是文件层面的接口交集，当前观察到的主要改动位于不同函数区域；不据此保证无 Git 合并冲突或语义冲突。下一阶段合并必须执行 C+D 联合类型检查及静态 Route → SourceGraph → runtime sourceRef 的浏览器回归，不能单凭双方单独通过 CI。

## 五、点选桥待集成协议（未实施）
现状：`src/core/candidate-preview-vite.config.mjs` 的 selectionBridge 在点击时直接读取 `data-ripple-instance` 与 `data-ripple-identity-certainty`，并以 `ripple:element-selected` postMessage 发送。带 key 的 host DOM 原始 ID 以 `:~` 结束，同一列表可重复。**这个消息不能用作唯一实例精准编辑授权。**

### 5.1 建议采集步骤
1. 点选桥在可信选中 DOM 元素上临时写入一个仅本轮使用的唯一关联属性，调用已存在的 `collectRuntimeIdentitySnapshot({ root: 关联属性选择器, label: 关联属性名 })`，在 `finally` 中移除临时关联属性。
2. 采集器在整个 `document` 计算 ID 重复性和同源码个数；只返回目标子树记录。桥必须确认关联记录唯一，并校验 `sourceRef` 与刚刚点击的节点一致。
3. 从 `snapshot.records[唯一目标]` 读取由 React Fiber key 链补全的 `runtimeInstanceId`，以及 `certainty`、`reasons`、`sourceVersion`、`sameSourceCount`；从 `snapshot.page` 读取页面上下文。
4. 用当前候选的 nonce、previewId、candidateId、patchHash、candidateTreeDigest（由可信宿主提供）绑定消息；宿主核对 `event.source`、当前 iframe、nonce、候选、页面和版本。不接受页面脚本自报的授权结论。
5. 宿主侧通过 `selectableRuntimeObservations` → `createRuntimeSourceMap` → `assessRuntimeIdentity` / `resolveRuntimeInstance` 与目标源码文件 `fileDigest` 重新证明；版本摘要必须取当前候选 worktree。
6. 即使身份 `instanceIdentityProven` 为 true，仍须通过 Scope included/excluded/protected、用户明确选择“仅此实例”、Candidate 与 Patch/Tree hash 检查，才可讨论实例级编辑授权。当前 D PR 未实现该功能。

### 5.2 建议 postMessage 附加字段
原 `type:'ripple:element-selected'`、`token`、`previewId` 保留；建议附加以下字段：

```ts
{
  protocol: 'ripple-runtime-identity/v1',
  candidateId, patchHash, candidateTreeDigest,
  sourceRef, runtimeInstanceId, identityCertainty,
  reasons, sourceVersion,
  pageContext: { pathname, search, hash },
  sameSourceCount, domNode,
  tagName, text
}
```

这是**下一阶段的协议提案**，并非当前已有对外接口；不能把新增的页面自报字段直接当作授权依据。

### 5.3 拒绝与降级
- `runtimeInstanceId` 为空或重复；`sourceRef` 不存在或与当前 SourceGraph 不匹配；
- 原始 `:~` 未被采集器解析、Fiber 缺失、`react-keys-unavailable`、`route-namespace-stale`；
- 版本不可用、歧义或不匹配，页面上下文缺失/不匹配；
- certainty 为 `position-dependent`、`unknown`、`unmapped`；
- 当前 Candidate/Scope/patch/tree/预览 nonce 不匹配；
- 采集关联记录缺失或多于一条；来源未验证；
- `sameSourceCount > 1` 时在界面显示“同源共享 N 处”，不得自动改写为局部覆盖授权。

不满足严格实例身份时可以根据原有契约考虑 `navigation-only`，但不能宣布“仅此实例编辑可用”。

## 六、集成分级
- **P0（阻止实例编辑开放）**：选择桥没有使用解析后的实例 ID，原始 DOM `:~` 可能重复。没有当前候选、版本、页面与用户 Scope 授权的端到端闭环。
- **P1（阻止独立正式集成）**：必须完成官方完整 CI、真实 Vite/browser 恢复回归，与 C PR #11 的联合接口验证。恢复阶段已由 TypeScript CI 发现并修复夹具扩展名错误。
- **P2（保留风险）**：依赖 React 内部 Fiber 字段、动态路由与 HMR/Fast Refresh 的 fail-closed 覆盖率代价、React Compiler 未验证、复杂 workspace 及符号链接下的误降级与转换性能复测。

**当前判定：D 代码恢复可审查；运行时实例级精准编辑不可宣布可用；禁止合并，等负责人统一集成。**

## 七、建议后续验收命令
```bash
npm ci
npm run typecheck
npm test -- --run --no-file-parallelism
npm run build
npx playwright test e2e/source-identity.spec.ts
npm run test:browser
```
注：完整 `test:browser` 包括需要 Docker 的工程 E2E。CI 与手动 Bolt Acceptance 是不同流程；本次未触发 Bolt。

## 八、最终 CI 复核结果与合并阻塞（补充）

正式 D 专项工作流： https://github.com/Onesummer-D/Ripple/actions/runs/39632922105
- 官方锁定依赖 `npm ci`：成功
- `npm run typecheck`：成功
- 官方 Vitest 身份与工程回归：2 个文件，171/171 通过
- `npm run build`：成功
- 真实 Vite + @vitejs/plugin-react + Chromium `e2e/source-identity.spec.ts`：21/21 通过
- 专项工作流最终状态：SUCCESS

标准完整 Docker 浏览器 CI：
- https://github.com/Onesummer-D/Ripple/actions/runs/39632333211 —— 29 通过 / 1 失败 / 1 跳过，FAILED
- https://github.com/Onesummer-D/Ripple/actions/runs/39632922100 —— 同一失败可复现，29 通过 / 1 失败 / 1 跳过，FAILED
- https://github.com/Onesummer-D/Ripple/actions/runs/39632644370 —— runner 收到 shutdown signal 而取消，不能作为代码通过/失败的依据

**可复现 P1 阻塞**：`e2e/project-workbench.spec.ts:272`，真实候选预演点击 `HomePage.tsx` 的标题后，测试期望 UI 中的 `stable-react-instance`，却实际收到 `unknown`。候选文件、DOM 和 JSX sourceRef 均能定位，界面清楚写明「不允许按唯一实例精准修改」，所以未发生放宽授权的安全问题；但产品原有的“稳定实例”回归预期未达成，完整集成 CI 不通过。原因可能涉及新增身份契约与原始 DOM 属性点选桥的连接，以及候选覆盖代码的 React 组件边界；本轮无足够证据区分，不得武断归因。不放宽原测试，不擅自修改点选桥或授权规则。

**C PR #11 接口交叉补充**：已将 C 在 `src/core/project.ts` 的 12 段文本变更逐段映射到当前 D 文件，12/12 均能按原上下文匹配，无直接文本块冲突。但仍未有同分支的 C+D 官方 TypeScript / Playwright 联合验证，所以语义兼容性属于 P1 待验收事项。

**最终分级**
- P0：现有点选桥不调用 D 的实例采集器，实例级精准编辑功能不能开放；等待 A/D 统一接入。
- P1：真实候选预演工作台稳定实例判定回归失败；必须由 A/D 对照原始 DOM、React Identity Context、候选页面覆盖和采集器结果诊断，并新增真实候选负例；C+D 联合验证也未完成。当前不允许独立合并。
- P2：React Fiber 内部字段、未验证 React Compiler 和特殊 workspace/HMR 情形仍属后续兼容性评估。

**最终决定：原始代码恢复完整，官方身份专项验收成功，完整集成验收失败。PR #15 继续保持 Draft，停止新增开发；不合并 A/main，不启动 Bolt。待负责人统一安排。**
