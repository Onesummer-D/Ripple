# 第三方案例兼容性清单（codescandy / dashui @ b700bbd）

> 日期：2026-10-22。性质：验证 Ripple 对非自有工程的适配能力。**调查阶段已收束；Issue #6 不关闭，第三方泛化不宣布完成。**
> 固定版本：codescandy（dashui）@ `b700bbd55b31a62fe04d4cd8210fc37232f0c9f0`（远端 main HEAD 完整克隆、MIT、commit 2024-11-22）。早前候选 SHA 8223897 在本次可访问的远端环境无法检出，不作证据。
> 探针位置：`scripts/thirdparty-acceptance.ts` + `docs/probes/`（PR #9 分支 `feat/thirdparty-dash-ui-20261019`，Draft、有冲突、不合并不强推）。

## 1. 项目获取、依赖与运行说明

| 项 | 内容 |
| --- | --- |
| 获取 | `git clone` 完整克隆，冻结 SHA `b700bbd`；探针以 `--expect-sha b700bbd…` 精确校验（大小写不敏感 40 位 hex），检出失败/SHA 不匹配/工作区脏 → 拒绝生成报告 |
| 探针运行 | `node --experimental-transform-types --loader ./scripts/ts-extension-loader.mjs scripts/thirdparty-acceptance.ts <projectRoot> [outDir]` |
| 依赖 | 探针本身零新增运行时依赖；被测工程不参与 Ripple 预演（预演支持范围见 §3） |
| 报告 | 输出 SourceGraph 统计与能力边界 JSON（schemaVersion 1）；committed JSON 不含本机绝对路径 |
| 测试 | 复现测试 7/7、探针 smoke 6/6；PR #9 交接 CI #315、#316（run 39572127334）success |

## 2. SourceGraph 支持情况（b700bbd 实测统计）

| 指标 | 实测值 | 说明 |
| --- | --- | --- |
| 节点 | 4 924 | — |
| 边 | 5 006 | — |
| media 节点 | 100 | — |
| asset-consumer（source-proven） | 61 条 | 消费关系成立 |
| 页面影响 | 100 条 **全部 unknown** | 路由不可判定 → 无法证明页面影响 |
| route 节点 | **0** | react-router data router（createBrowserRouter）识别缺失（A-P1a） |
| token 节点 | **0** | SCSS 变量不进图，`.scss` 导入进 unresolved |
| unresolved | 2 | — |

TEXT 真实目标已双重定位：首选 `literal:src/sub-components/profile/ProfileHeader.tsx#2691`（值 "Overview"，ProfileHeader.tsx:72，图中唯一）；备选 `Current Plan Overview`（CurrentPlan.tsx:114）。附带发现：JSX 属性字符串字面量当前不提取为 data 节点。

## 3. CSS Token / 品牌样式修改的可用范围

- **当前可用**：无（token 0 节点，实测）。工作台第三方案例为明确标注的 Token **Fixture 演示**（`src/cases/fixtures.ts` third-party：3 个共享 accent slot），真实工程 Token 修改未接入。
- **明确不支持（不得包装成支持）**：SCSS 变量/SCSS Token（`.scss` 进 unresolved）；CSS Token 执行器 A 未完成（DEV_HANDOFF §4 列明）。
- **tsconfig 边界**：root tsconfig 仅 `references` 时 alias 不生效；解析失败的内部别名/裸导入被 project.ts 循环静默跳过（无 import 边、无 unresolved 记录）——比「自指边」假设更弱的缺口，已实测修正并登记为 A-P1b 需求。

## 4. 已证实关系与未知关系统计

| 类别 | 数量 | 状态 |
| --- | --- | --- |
| source-proven 消费边（asset-consumer） | 61 | 已证实 |
| 页面影响 | 100 | **全部 unknown**（route 不可判定） |
| 路由关系 | 0 | 不支持（data router） |
| Token 关系 | 0 | 不支持（SCSS） |
| unresolved | 2 | 已知 |

注意：61 条消费边 ≠ 61 条页面影响证明（协调人审查结论）。

## 5. 运行限制、失败记录与兼容性边界

1. **TEXT 全生命周期 NOT RUN**：Candidate（要求 sourceProvenPageImpact 无 unresolved）→ Preview → Evidence → Receipt → Approval → Apply → Rollback 被 A 公共接口阻断；最小前置 = A-P1a data router 路由识别合入 + 三方 SHA 固定。阻断矩阵（`docs/probes/thirdparty-text-blocker-matrix.md`）：#1 UNSUPPORTED、#2/#3 BLOCKED、#4–#7 NOT RUN、#8 PASS（统计产出）、#9/#10 UNSUPPORTED。
2. **公共浏览器预演稳定性**：同树 CI #311 fail / #313 pass（ERR_NETWORK_CHANGED，e2e/page-override-lifecycle.spec.ts:308），已登记为 A 公共问题，未声称已解决。
3. **预演支持范围**（架构级，DEV_HANDOFF §2）：仅受限 React/React DOM + Vite 风格 SPA 固定预演适配器；不执行目标项目 lifecycle script、项目 Vite 配置、SSR、任意自定义服务；Windows 原生 Node 直接运行 Docker 预演 unsupported（推荐 WSL2 + Docker Desktop，本机未实测）。
4. **运行时身份**：D 点选桥已合入 A（navigation-only）；在第三方工程上未运行。
5. **恢复条件**（B 待命，摘自 B_OVERNIGHT_HANDOFF v11）：A-P1a 路由识别合入 + 受限预演能力可用 + 三方 SHA 固定 → 冻结 SHA 重跑探针 → 负例升正向契约 → ProfileHeader.tsx:72 "Overview" 全生命周期 → 完整工件与验收报告。

## 6. 参赛表述红线

- 不得称「第三方工程已支持/已验收」；准确表述为「真实项目能力盘点与公共接口缺口复现完成」。
- 不得称「SCSS/动态路由完整支持」；均为不支持/未知。
- 英文 Issue #6 接口需求评论截至 v11 标记 NOT POSTED（由负责人代发），不得宣称已发布。
