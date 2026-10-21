# codescandy dash-ui 第三方泛化验收（Issue #6）

- 日期：2026-10-21（v2，按协调人独立审查修正根因归因并加固探针）
- 被测工程：github.com/codescandy/dash-ui-react-vitejs-typescript
- 冻结 SHA：`b700bbd55b31a62fe04d4cd8210fc37232f0c9f0`
- Ripple 侧基线：PR #9 分支（统计 JSON 内 rippleHead 为实测时的提交 SHA）
- 统计 JSON：[b-codescandy-acceptance-2026-10-21.json](./b-codescandy-acceptance-2026-10-21.json)（schemaVersion 1）
- 复现方式：
  `node --experimental-transform-types --loader ./scripts/ts-extension-loader.mjs scripts/thirdparty-acceptance.ts <codescandy 检出路径> --expect-sha b700bbd55b31a62fe04d4cd8210fc37232f0c9f0 [--out <dir>]`

## 冻结 SHA 来源说明（8223897 → b700bbd 变更原因）

- Issue #6 起草时的 `8223897` 经核验**在该仓库远端任何 ref 中均不可解析**
  （`git ls-remote` 按前缀匹配无结果），无法作为可复验基线。
- `b700bbd` 是该仓库 main 分支当前 HEAD（完整克隆，非 shallow），
  commit 日期 2024-11-22（"Changelog date changed"），与协调人给定基线一致，
  且此前多轮探针（2026-10-18/10-20/10-21）均使用同一 SHA，统计可复现。
- 许可证：MIT（仓库根 LICENSE，Copyright (c) 2024 Codescandy）。
- 技术栈：React 18.3 + Vite 5.4 + TypeScript 5.6 + react-router 6.27（data router）+ Sass；
  root `tsconfig.json` 仅含 references，`paths`（catch-all `* → ./src/*`）在 `tsconfig.app.json`。

## SourceGraph 统计摘要（v2 schema，详见 JSON）

| 指标 | 数值 |
| --- | --- |
| nodes / edges | 4924 / 5006 |
| media 节点 | 100 |
| asset-consumer 边（source-proven） | 61 |
| media 页面影响 proven | 0（全部 unknown） |
| token 节点 / uses-token 边 | 0 / 0 |
| route 节点 | 0 |
| unresolved | 2（`DropdownType`、`./styles/theme.scss`） |

关键结论：**61 条 source-proven 消费边 ≠ 61 条页面影响证明**。消费关系成立，但
`sourceProvenPageImpact` 因路由不可判定而全部 fail-closed 为 unknown。这是正确的
fail-closed 行为，不能通过删除 Candidate 门控解决。

## 能力边界（最小复现：src/core/b-thirdparty-capability-repro.test.ts，7 用例全过）

1. **react-router data router 路由识别缺口**：`App.tsx:48` 使用
   `createBrowserRouter([{ path: 'profile', Component: Profile }, ...])` + `<RouterProvider>`。
   当前路由识别只支持 `useState` + `state === 'literal'` 惯用法 → 0 route 节点。
   补充：路由 path 字符串字面量当前也不提取为 data 节点（图中仅 JSX 文本成为 data），
   即路由定义在源码中存在但在 SourceGraph 中完全不可见。
2. **tsconfig references 不追随**：root tsconfig 仅 references 时，非标准配置文件名中的
   `paths` 不参与解析。
3. **解析失败导入的归因（v2 修正，协调人 2026-10-21 独立审查确认）**：
   真实缺口在 `project.ts` ImportDeclaration 循环——`ts.resolveModuleName` 失败后，
   specifier 既不以 `.` 也不以 `@/` 开头的**项目内部别名/裸导入被 continue 静默跳过**，
   既无 `import:` 模块导入边也无 unresolved 记录。
   必须区分两类 `imports` 边（Relation 第四参是边 id，不是 source 字段）：
   - id `source:<componentId>`：组件来源边（component → 自身所在文件），**正常语义，不得删除**；
   - id `import:<file>:<offset>`：真实模块导入边（file → 目标文件）。
   v1 文档误把组件来源边当作"解析失败的自指 fallback"，v2 已修正。
   注意：不能把所有 npm 包导入一律标 unresolved（大量误报），需区分受支持外部包、
   项目内部别名、未知别名与真实解析失败。
4. **SCSS Token 未支持**：保持 unsupported，不伪装 PASS，本轮不要求实现。
5. **附带发现**：JSX 属性字符串字面量（如 `<PageHeading heading="Overview" />`）
   当前不提取为 data 节点，TEXT 目标选取必须以图中真实存在的节点为准。

## TEXT 真实编辑目标（已在真实 SourceGraph 上验证存在）

- **首选**：`literal:src/sub-components/profile/ProfileHeader.tsx#2691`
  — 值 `"Overview"`，`ProfileHeader.tsx:72`，profile 页导航 tab 文本；
  图中唯一 label 为 "Overview" 的 data 节点（源码中 standalone `>Overview<` 仅一处）。
- **备选**：`literal:src/sub-components/billing/CurrentPlan.tsx` 的
  `"Current Plan Overview"`（`CurrentPlan.tsx:114`，`<h4>` 静态文本）。

## 闭环步骤划分

B 侧可完成（现有公共接口）：冻结 SHA 核对、SourceGraph 统计、真实 TEXT 目标定位、
能力边界最小复现、能力探针加固（schemaVersion/SHA 校验/干净工作区/路径脱敏）。

被 A 公共接口阻断（最小前置依赖：react-router data router 路由识别）：
候选生成（candidate.ts 要求 sourceProvenPageImpact 无 unresolved，codescandy 上
任何候选在候选阶段即被拒）、执行验收（page-override/TEXT 执行器、VerificationRunner、
Receipt 属 A 核心）。B 侧不改 A 实现，只提交需求依据。

## 探针定位声明

`scripts/thirdparty-acceptance.ts` 是 **third-party capability probe（能力探针）**，
不是第三方全生命周期验收成功的证明：它不执行 CandidatePatch、浏览器预演、
VerificationReceipt、Approval、Apply、Rollback。报告 fail-closed：
检出不可读、SHA 不匹配、工作区不干净时拒绝生成貌似可信的报告；
committed JSON 不含本机绝对路径。探针自身有 smoke 测试
（src/core/b-thirdparty-acceptance-script.test.ts，4 用例）。

## 与青野（Qingye） MEDIA 验收的关系

青野第一阶段验收（Actions Run 39536064634 SUCCESS）覆盖 source-proven 分类图的 MEDIA
asset-swap；codescandy 阶段定位为"真实项目能力盘点与公共接口缺口复现完成"，
**Issue #6 第三方 TEXT 全生命周期尚未通过，不宣布整体验收完成**。
