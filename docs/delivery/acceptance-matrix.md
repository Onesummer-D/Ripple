# 三案例统一验收矩阵

> 日期：2026-10-23（Run #18 最终修订 + 复审小改 + 2026-10-23 晚状态更新）。基线：A 主线 `feat/project-first-core-20261018`（文档起草 @ 2525092；Bolt 验收通过时 A @ `16e737c`；**最新公共基线 @ `45a2d7c`（已远端复核，含 AC-P2a/b 精简集成）**）。Run #18 证据已归档 `docs/delivery/evidence/run18/`（哈希索引见 INDEX.md）。
> 状态取值：PASS / RISK / UNKNOWN / NOT RUN。标【已合成】的通过仅为合成工程或 Fixture 证据，不代表真实案例验收。
> “实际运行结果”列只写真实运行过的内容；没有真实运行的写 NOT RUN 并说明阻断。
> **主案例真实验收已于 Run #18（2026-10-22，A @ 16e737c）整轮通过**：<https://github.com/Onesummer-D/Ripple/actions/runs/39808500782>。

## 案例一：青野文创 · 秋日灵感季（TEXT 主案例）

真实工程：`Onesummer-D/ripple-qingye-bolt @ f7e4998a`（4 页面：home / autumn / products / story；共享 Footer 组件 `src/components/Footer.tsx`；标题文案 "山野器物"）。

| # | 操作步骤 | 对应源码/页面 | 负责模块 | 期待结果 | 已有测试证据 | 实际运行结果 | 状态 | CI/截图链接 | 当前阻断 | 复验负责人 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1.1 | 打开真实青野工程并分析（AST SourceGraph） | 全工程 4 页 | A `project.ts` | 4 个实际页面状态、Footer 消费 /home /story 等关系可读 | 合成工程全量过；真实工程分析步骤在 Bolt Run #10 前置成功 | Run #10/#11 分析步骤成功（资源快照 221 个全成功） | PASS（分析步骤） | [Run #10](https://github.com/Onesummer-D/Ripple/actions/runs/39484983941) | 无 | A |
| 1.2 | 网页点选 Footer 品牌文字定位源码 | `Footer.tsx` 实例 | D 点选桥（PR #18） | 返回 `jsx:src/components/Footer.tsx#…` 与可证明实例身份 | 真实 Vite 身份 E2E 21 项 + stable-react-instance 断言保留 | 真实 Bolt 中点选 footer 品牌文字并定位到 Footer.tsx 成功（Run #15–#17 均执行通过） | PASS（真实 Run #15–#17） | [Run #15](https://github.com/Onesummer-D/Ripple/actions/runs/39724024971) / [CI 39650178433](https://github.com/Onesummer-D/Ripple/actions/runs/39650178433) | 实例级精准编辑仍 navigation-only（不授权精准编辑） | D / A |
| 1.3 | 外部资源授权与内容寻址快照 | Pexels 图、Google Fonts | A `verification-runner.ts` | 仅授权 URL 被快照（SHA-256） | 合成 + Run #10 真实快照 221 个/12.4MB/unavailable:0 | 真实快照成功（Run #10、#11 均 unavailableResources=0） | PASS | [Run #10](https://github.com/Onesummer-D/Ripple/actions/runs/39484983941) | 无 | A |
| 1.4 | 生成文字修改候选（intent → EditOperation → 隔离 worktree diff） | `Footer.tsx` 单文件 diff | A `candidate.ts` | 真实源码 diff + patchHash + tree digest | 合成全链路 + 工作台 UI 真实可用 | 真实 Bolt 候选生成走通（Run #15–#17：候选 ID、patchHash/treeDigest 绑定、diff 含新文案均断言通过） | PASS（真实 Run #15–#17） | [Run #15](https://github.com/Onesummer-D/Ripple/actions/runs/39724024971) | 无 | A |
| 1.5 | 四视口预演验证（1440×900 / 768×1024 / 375×812 / 390×844） | 4 页 × 4 视口 | A `candidate-verification-runner.mjs` 等 | target-change / scope-propagation / non-target-preserved / interaction / responsive-layout / source-mapping / browser-errors 七断言 | 合成工程全 PASS（Linux CI 30/30，1 跳过为私有专项） | 真实 Bolt 通过：Run #18 七项断言全部 pass、四视口与 16 条 scopeObservations 齐全、221 个资源快照、截图哈希绑定一致（Run #15–#17 阶段级先行通过；早期 #10 预算、#11 pids、#12 导航 ~10 s、#13 RISKS 已逐项修复） | PASS（真实 Run #18 @16e737c；亦过 #15–#17） | [Run #18](https://github.com/Onesummer-D/Ripple/actions/runs/39808500782) | 无（该阶段） | A |
| 1.6 | 范围决策（4 页 include / exclude） | ScopeDecision v1 | A `scope.ts` | 页级 Scope 与候选绑定 | 合成测试过 | 真实 Bolt 中 4 页 include 决策随候选创建执行并通过（Run #15–#17） | PASS（真实 Run #15–#17） | [Run #15](https://github.com/Onesummer-D/Ripple/actions/runs/39724024971) | 无（该阶段） | A |
| 1.7 | 审批（Approval 门控） | 候选 + Receipt | A | 仅 PASSED Receipt 可审批 | 合成测试过；负例（completed:false 拒绝）钉死 | 真实 Bolt 审批成功（Run #15–#17：候选状态进入「已批准」） | PASS（真实 Run #15–#17） | 同上 | 无（该阶段） | A |
| 1.8 | 应用同一份补丁到可丢弃 worktree | 同 patchHash | A `apply.ts` | 应用后 Footer.tsx 含新文案、HEAD 不变 | 合成测试过 | 真实 Bolt 应用成功：应用后 Footer.tsx 含「山野器物 · Ripple UI验收」、HEAD 不变（Run #15–#17 断言通过）；应用预览接口 Run #15 失败（spec.ts:1102，PR #21 修复），Run #16/#17 已能启动 | PASS（应用，真实 Run #15–#17） | 同上 | 应用预览导航见 1.9 | A |
| 1.9 | 应用后预览逐页导航确认 | 应用预览 iframe | A（PR #15/#16/#23 应用预览） | 桌面导航秋日手作节/商品专题/品牌故事三页，新 footer 保持可见 | 合成 e2e 过 | 真实 Bolt 通过：三页 H1 断言 + 每页 footer 新文案可见（Run #18 @16e737c）；bolt-workbench-applied-site.png 为三页导航中一次的截图，完整证明以逐页断言为准 | PASS（真实 Run #18） | [Run #18](https://github.com/Onesummer-D/Ripple/actions/runs/39808500782) | 无 | A |
| 1.10 | 回滚 + 原工程未改动证明 | Footer.tsx / git status | A `apply.ts` | rolled-back、原工程 HEAD 与 status 不变 | 合成测试过；MEDIA 线同构真实证明（Run 39536064634） | 真实 Bolt 通过：Footer.tsx 恢复原文、无 "Ripple UI验收"、应用 worktree 与原工程 HEAD/status 逐字节不变（Run #18） | PASS（真实 Run #18） | 同上 | 无 | A |
| 1.11 | 版本历史恢复 | `/__ripple/api/history` | A | 历史记录恢复后候选/哈希/验证状态一致 | 合成测试过 | 真实 Bolt 通过：历史 lifecycle=rolled-back、patchHash 一致；恢复后候选 ID/patchHash/验证状态 PASSED 一致，bolt-workbench-history-restored.png 已入工件（Run #18） | PASS（真实 Run #18） | 同上 | 无 | A |
| 1.12 | 体验层演示流（画布优先工作台） | `experience.html` | F（PR #14） | 打开→选标题→改文案→关系→范围→对照→证据→历史 17 步连续可操作 | 单测 40/40、e2e 15/15、xp-1..4 真实 Chromium 截图 | 演示数据 DEMO/SIMULATED 全程标注；真实审批未接入（设计如此） | PASS【已合成·演示】 | [CI #475/#478](https://github.com/Onesummer-D/Ripple/actions?query=workflow%3ARipple+CI)；`docs/experience/HANDOFF.md` | 接 real-adapter 需各 Agent 提供接口（F HANDOFF §4） | F / 集成方 |

**主案例结论**：**真实 TEXT 全闭环已于 Run #18（2026-10-22，A @ `16e737c`，青野 @ f7e4998a）整轮通过**，从工程分析到历史恢复全链路在真实工程、真实浏览器中走通并留证：

- 浏览器验收用例耗时 1.4 分钟（整轮工作流约 2.7 分钟），唯一用例 `runs the Bolt shared TEXT workflow` passed（<https://github.com/Onesummer-D/Ripple/actions/runs/39808500782>）。
- 执行记录 `bolt-workbench-execution.json`（v4 manifest，completed:true）：七项断言（target-change / non-target-preserved / scope-propagation / interaction / responsive-layout / source-mapping / browser-errors）**全部 pass**；四视口 1440×900 / 768×1024 / 375×812 / 390×844；16 条 scopeObservations（4 页 × 4 视口）；221 个资源快照、unavailable=0、blockedExternalResourceUrls=[]；四视口截图 SHA-256 与 artifactHash 逐一致（已核对）。
- 工件 `ripple-bolt-workbench-39808500782`（retention 30 天）含：execution.json、四视口 PNG、bolt-workbench-analysis/candidate/applied-site/history-restored.png、resource-load-audit.json、resource-snapshots 与 progress.jsonl 诊断；**2026-10-23 已完整解压归档**至 `docs/delivery/evidence/run18/`（238 个文件与远端逐字节一致，ZIP SHA-256 与逐文件哈希见 `evidence/run18/INDEX.md`）。
- 审批通过的真实证明是工作台状态断言（候选进入「已批准」）；回滚的证明是 Footer 源码恢复 + 应用 worktree 与原工程 HEAD/status 逐字节不变断言；历史恢复是恢复选中历史候选及其验证状态展示，均见 INDEX.md「使用边界」。
- 历史过程如实保留：Runs #1–#17 结论均 failure，逐次归因（资源快照→pids 超限→导航 ~10 s→导航契约→应用预览挂载），每次修复带确定性负例；Run #15–#17 阶段级通过（验证/审批/应用已过），Run #18 在 PR #23 修复后整轮通过。

录屏与参赛文案现可引用 Run #18 真实证据，不再需要「待验收」标注；仅 E 视觉模块接入、第三方全生命周期等仍按各自状态标注。

## 案例二：栖光艺术节 · 媒体替换（MEDIA 辅助案例）

Fixture 定义：`src/cases/fixtures.ts`（qiguang 4 个 slot：首页横幅 `/`、节目展墙 `/program`、购票卡 `/tickets` 共享同一海报源；`/archive` 独立）。工作台支持本地图片上传（IndexedDB）、三容器裁切对照、四视口（Fixture 证据视口 1440/768/375；390 标注“验证中”）。

| # | 操作步骤 | 对应源码/页面 | 负责模块 | 期待结果 | 已有测试证据 | 实际运行结果 | 状态 | CI/截图链接 | 当前阻断 | 复验负责人 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2.1 | 选中节目页 Slot 并上传/选图（PNG/JPEG/WebP/GIF） | `/program` qiguang-program-poster-slot | A 工作台 MEDIA 交互 | 生成 media:// 候选，IndexedDB 资源可复用 | 工作台实现 + Fixture 测试；本地页面 QA JSON | 工作台层可用（本地页面） | PASS【已合成·演示】 | `docs/acceptance/2026-10-15/evidence/` | 浏览器本地资源库不随代码包迁移 | A / F |
| 2.2 | 三容器裁切对照弹窗（容器 vs 完整原图，Escape 关闭） | 首页 Hero / 展墙 / 购票卡 | A 工作台 | 各容器裁切区域可见 | README 已声明实现；Fixture 层 | 本地页面可用 | PASS【已合成·演示】 | 同上 | 真实工程未验收 | A |
| 2.3 | 横版素材 → 竖版素材的布局差异展示 | 3 个共享消费位置 | C 概念设计 + A 演示 | 裁切/遮挡/溢出差异可见 | C 三容器展示稿（概念示意标注）；E 几何规则模块（new-clip-overflow 等）；E 阶段一只读接线已合入 A 主线（PR #30） | E 接线已并入 A；但栖光 MEDIA 真实管线未接入，横竖版替换差异**尚无真实双端截图输入** | UNKNOWN（真实） | `docs/design/c/`；`docs/architecture/visual-evidence-f-consumption.md` | 栖光真实管线接入 + 双端截图采集（B1/B4） | E / A |
| 2.4 | 真实工程 MEDIA asset-swap 验收 | 青野分类图（同管线） | B（PR #7/#8，Run 39536064634） | 四视口双端 7 断言 + Approval/Apply/Rollback + 原工程未改动 | 真实验收 PASS（青野，非栖光） | 青野分类图 asset-swap：PASS；动态商品图/复杂 variants：NOT RUN（静态不可证明） | PASS（青野单操作）/ NOT RUN（范围外） | [Run 39536064634](https://github.com/Onesummer-D/Ripple/actions/runs/39536064634) | 栖光工程本身未接入真实验收管线 | B / A |
| 2.5 | E Visual Evidence（像素 diff + 几何证据） | 双端截图 | E | risk/unknown 语义证据，从不 PASS | 合成 fixture 测试 + 真实 Chromium 单测（页面为合成）+ 真实接线 e2e（Docker 全链路，PR #30） | 阶段一只读接线已合入 A 主线；尚无真实 run 在含接线基线上执行（Run #18 早于接线合入）；栖光 MEDIA 双端截图与 risk/unknown 样本未采集 | NOT RUN（真实） | A 合并提交 71dc6c7；E 分支 `feat/e-visual-wiring-20261023` | 栖光真实管线接入后采集（B2/B3）；严格实例证明阶段二待 C+D 合同冻结 | E |

**栖光结论**：演示层（Fixture/工作台）可录；真实 MEDIA 证据目前只有青野分类图一条线（且为单操作）；栖光自身的横竖版替换视觉验收依赖 E 模块接入，当前 UNKNOWN，不得宣传为已完成。

## 案例三：第三方开源站（codescandy / dashui @ b700bbd，适配能力验证）

探针统计（`docs/probes/` on PR #9 分支，2026-10-21 实测）：4924 节点 / 5006 边；media 100；asset-consumer 61 条 source-proven；页面影响 100 条全部 unknown；route 0；token 0；unresolved 2。

| # | 操作步骤 | 对应能力 | 负责模块 | 期待结果 | 已有测试证据 | 实际运行结果 | 状态 | CI/截图链接 | 当前阻断 | 复验负责人 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 3.1 | 固定 commit 获取与探针运行 | 仓库 checkout + `thirdparty-acceptance.ts` | B（PR #9） | 统计 JSON 可复现（--expect-sha 门控） | 复现测试 7/7 + smoke 6/6；CI #315/#316 success | b700bbd 实测统计产出 | PASS（探针） | PR #9；阻断矩阵 `docs/probes/thirdparty-text-blocker-matrix.md` | 无（调查阶段） | B |
| 3.2 | SourceGraph 消费关系 | `project.ts` AST 分析 | A/C | imports vs 实际 reads 区分，消费边可证明 | 61 条 source-proven asset-consumer（媒体） | TEXT reads 图存在；路由不可判定 → 页面影响 100 条全 unknown | RISK | 同上 | react-router data router 识别为 0（A-P1a） | A / C |
| 3.3 | CSS Token / 品牌样式修改 | Token 图 | A（执行器未完成） | token 节点与消费位置 | codescandy 实测 token 0 | SCSS → 0 token、`.scss` 进 unresolved | UNSUPPORTED / NOT RUN | 同上 | CSS Token 执行器 A 未完成；SCSS 不支持 | A |
| 3.4 | TEXT 修改全生命周期（ProfileHeader.tsx:72 "Overview"） | Candidate→Preview→Evidence→Receipt→Approval→Apply→Rollback | A + B | 与青野同标准的真实闭环 | 目标已双重定位（literal:src/sub-components/profile/ProfileHeader.tsx#2691） | 阻断矩阵：#4–#7 NOT RUN、#2/#3 BLOCKED | NOT RUN | 同上 | A-P1a 路由识别合入 + 三方 SHA 固定；公共浏览器预演稳定性（CI #311/#313 双跑） | B / A |
| 3.5 | 运行时身份/点选 | D 桥 | D | navigation-only 定位 | A+D 已在 A 主线（PR #18） | 第三方工程上未运行 | NOT RUN | [CI 39650178433](https://github.com/Onesummer-D/Ripple/actions/runs/39650178433) | 依赖 3.4 前置 | D |
| 3.6 | 已知关系统计输出 | 探针报告 | B | 已证实 vs 未知分列 | 61 证实 / 100 未知 / route 0 / token 0 / unresolved 2 | 已产出（schemaVersion 1） | PASS（统计） | `docs/probes/codescandy-b700bbd-20261021.md` | 无 | B |

**第三方结论**：能力盘点完成、Issue #6 不关闭；SCSS 与 data router 明确写为不支持/未知，不得包装成完整支持。

## 横向公共能力（与三案例共用）

| 能力 | 状态 | 证据 | 说明 |
| --- | --- | --- | --- |
| 合成工程全链路 CI（typecheck/Vitest/build/Docker Playwright） | PASS | CI #478（A @ 2525092）；Run 39650178433 408/408；Run 39667915489 426/426 | 只证明合成工程，不证明真实 Bolt 闭环 |
| Docker 隔离预演（受限 Vite 适配、loopback relay、CSP、资源快照） | PASS【已合成】 | 上述 CI + PR #17 预构建实验 | Windows 原生不支持，需 Linux Docker |
| D 运行时身份（stable-react-instance 恢复、navigation-only） | PASS | PR #18 已合并；CI 39650178433 | 实例级编辑授权仍关闭 |
| C+D SourceGraph × Runtime Identity | 已并入 A 主线 | PR #28（集成 HEAD 43f2ea2）；A 合并后验收 742/742 Vitest | AC-P2a/b 精简集成进行中（route.lazy 页面组件导出证明修复 98029cb）；strictInstanceProofAvailable 的唯一升级依据（instanceIdentityProven === true）仍待 C+D 合同冻结 |
| F 体验工作台（演示流 + 审批门控） | PASS【演示·DEMO 标注】 | PR #14 已合并；e2e 15/15 | 真实审批入口在 real 模式明确不开放 |
| F 真实 TEXT 候选 + 四视口展示 | 已完成（2026-10-23 协调方口径，待远端复核） | 分支 feat/f-real-text-phase2-20261023 | 消费 E 的 visualEvidences[].view 只读投影；演示界面与真实验收证据来源分开标注 |
| 生命周期清理 fail-closed / 发布门（Run #12 修复） | PASS【合成 + 真实复验】 | PR #13 已合并；确定性负例 22+9+8；Run #15–#17 真实四视口验证完整产出 execution.json | 真实复验范围 = 验证阶段；预算压力已缓解（PR #17 预构建，DCL 稳态 ~2.3 s→~0.41 s） |
| E 视觉差异证据 | PASS【合成】/ 接线已合入 A【真实 run 待跑】 | E 分支 fixture 测试；阶段一只读接线 PR #30（fdd9ee0 → A 合并提交 71dc6c7，专项 CI 与合并后 CI 均 success） | 接线已并入 A 主线：VerificationRun 挂载 visualEvidences 只读 view（含双端配对证据，strictInstanceProofAvailable 恒 false）；Run #18 早于接线合入，尚无真实 run 在含接线基线上执行；栖光 MEDIA 真实样本待采集 |

## 使用规则

1. 复验以真实 CI/工件为准；上表任何 NOT RUN 在对应真实验收运行通过前不得改写为 PASS。**workflow 结论 failure ≠ 各阶段 NOT RUN**：必须按日志定位失败行，将失败点之前已通过的阶段如实标 PASS（Run #15–#17 即为例证）。
2. 每完成一轮真实验收，更新“实际运行结果/状态/CI 链接/复验负责人”四列并记录日期、运行编号与提交 SHA。
3. 主案例与辅助案例分开记录，不以合成 Fixture 代替真实网页验收。
