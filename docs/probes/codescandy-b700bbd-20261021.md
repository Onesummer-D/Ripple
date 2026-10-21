# codescandy dash-ui 第三方泛化验收（Issue #6）

- 日期：2026-10-21
- 被测工程：github.com/codescandy/dash-ui-react-vitejs-typescript
- 冻结 SHA：`b700bbd55b31a62fe04d4cd8210fc37232f0c9f0`（MIT License，检出有效）
- Ripple 侧 HEAD：`8c1ae2bb93dafcde6f0274a1542f764842a41974`（PR #9 分支）
- 统计 JSON：[b-codescandy-acceptance-2026-10-21.json](./b-codescandy-acceptance-2026-10-21.json)
- 复现方式：`node --experimental-transform-types --loader ./scripts/ts-extension-loader.mjs scripts/thirdparty-acceptance.ts <codescandy 检出路径> [outDir]`

## 技术栈（确认真实工程，非 fixture）

React 18.3 + Vite 5.4 + TypeScript 5.6 + react-router 6.27（data router）+ Sass。
root `tsconfig.json` 仅含 references（solution 风格），`paths` 声明在 `tsconfig.app.json`：
catch-all `* → ./src/*`。

## SourceGraph 统计摘要

| 指标 | 数值 |
| --- | --- |
| nodes / edges | 4924 / 5006 |
| media 节点 | 100 |
| asset-consumer 边（source-proven） | 61 |
| media 页面影响 proven | 0（61 条消费边对应的页面影响全部 unknown） |
| token 节点 / uses-token 边 | 0 / 0 |
| route 节点 | 0 |
| unresolved | 2（`DropdownType`、`./styles/theme.scss`） |

关键结论：**61 条 source-proven 消费边 ≠ 61 条页面影响证明**。消费关系成立，但
`sourceProvenPageImpact` 因路由不可判定而全部 fail-closed 为 unknown，与既有基线一致。

## 能力边界（最小复现见 src/core/b-thirdparty-capability-repro.test.ts，5 用例全过）

1. **react-router data router 路由识别缺口**：`App.tsx:48` 使用
   `createBrowserRouter([{ path: "profile", Component: Profile }, ...])` +
   `<RouterProvider>`，当前路由识别只支持 `useState` + `state === 'literal'` 惯用法，
   产出 0 个 route 节点 → 全部页面影响 unknown。
2. **tsconfig references 不追随**：root tsconfig 仅 references 时，非标准配置文件名
   （如 `tsconfig.web.json`）中的 `paths` 不参与解析。额外实测：解析失败的裸导入
   不产生 unresolved 记录，而是降级为**自指 imports 边**（component → 自身文件），
   具有误导性，需提交 A 修复为 fail-closed 记录。
3. **SCSS Token 未支持**：`$primary` 等 Sass 变量不产生 token 节点/uses-token 边，
   `.scss` 导入进 unresolved。保持 unsupported，不伪装 PASS。
4. **附带发现**：JSX 属性字符串字面量（如 `<PageHeading heading="Overview" />`）
   当前不提取为 data 节点，TEXT 目标选取必须以图中真实存在的节点为准。

## TEXT 真实编辑目标（已在真实 SourceGraph 上验证存在）

- **首选**：`literal:src/sub-components/profile/ProfileHeader.tsx#2691`
  — 值 `"Overview"`，`ProfileHeader.tsx:72`，profile 页导航 tab 文本；
  图中唯一 label 为 "Overview" 的 data 节点（源码中 standalone `>Overview<` 仅一处）。
- **备选**：`literal:src/sub-components/billing/CurrentPlan.tsx` 的
  `"Current Plan Overview"`（`CurrentPlan.tsx:114`，`<h4>` 静态文本）。

## 闭环步骤划分

可完成（B 侧 / 现有公共接口）：

- 冻结 SHA 检出与有效性核对、SourceGraph 统计产出（本文件与 JSON）。
- 真实 TEXT 目标定位与唯一性证明（图节点 + 源码双重定位）。
- 能力边界最小复现测试，锁定真实行为。

被 A 公共接口阻断（需 A 扩展，B 不擅自改核心）：

- **候选生成**：`candidate.ts` 硬性要求 `sourceProvenPageImpact` 无 unresolved，
  codescandy 上 0 route 节点 → 任何候选（含上述 TEXT 目标）在候选阶段即被拒。
  前置依赖：react-router data router 路由识别（`createBrowserRouter` 路由表解析）。
- **执行与验收**：page-override / TEXT literal 执行器、VerificationRunner、
  Receipt 均属 A 公共核心，B 侧只提交需求依据（复现测试）不改实现。
- 解析失败导入需 fail-closed 进入 unresolved（当前静默降级为自指边）。

## 与青野（Qingye） MEDIA 验收的关系

青野第一阶段验收（Actions Run 39536064634 SUCCESS）覆盖的是 asset-swap 类别的
source-proven 闭环；codescandy 阶段暴露的是 TEXT 类别与路由识别缺口，二者互不冲突。
本阶段不重复 MEDIA P0/P1 已审结论。
