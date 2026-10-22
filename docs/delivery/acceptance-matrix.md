# 三案例统一验收矩阵

> 日期：2026-10-22。基线：A 主线 `feat/project-first-core-20261018 @ 2525092`（CI #478 success）。
> 状态取值：PASS / RISK / UNKNOWN / NOT RUN。标【已合成】的通过仅为合成工程或 Fixture 证据，不代表真实案例验收。
> “实际运行结果”列只写真实运行过的内容；没有真实运行的写 NOT RUN 并说明阻断。

## 案例一：青野文创 · 秋日灵感季（TEXT 主案例）

真实工程：`Onesummer-D/ripple-qingye-bolt @ f7e4998a`（4 页面：home / autumn / products / story；共享 Footer 组件 `src/components/Footer.tsx`；标题文案 "山野器物"）。

| # | 操作步骤 | 对应源码/页面 | 负责模块 | 期待结果 | 已有测试证据 | 实际运行结果 | 状态 | CI/截图链接 | 当前阻断 | 复验负责人 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1.1 | 打开真实青野工程并分析（AST SourceGraph） | 全工程 4 页 | A `project.ts` | 4 个实际页面状态、Footer 消费 /home /story 等关系可读 | 合成工程全量过；真实工程分析步骤在 Bolt Run #10 前置成功 | Run #10/#11 分析步骤成功（资源快照 221 个全成功） | PASS（分析步骤） | [Run #10](https://github.com/Onesummer-D/Ripple/actions/runs/39484983941) | 无 | A |
| 1.2 | 网页点选 Footer 品牌文字定位源码 | `Footer.tsx` 实例 | D 点选桥（PR #18） | 返回 `jsx:src/components/Footer.tsx#…` 与可证明实例身份 | 真实 Vite 身份 E2E 21 项 + stable-react-instance 断言保留 | 合成工作台与官方 CI 通过；真实 Bolt 点选步骤随 Run 失败未走完 | RISK | [CI 39650178433](https://github.com/Onesummer-D/Ripple/actions/runs/39650178433) | Bolt Run 未通过；实例级精准编辑仍 navigation-only | D / A |
| 1.3 | 外部资源授权与内容寻址快照 | Pexels 图、Google Fonts | A `verification-runner.ts` | 仅授权 URL 被快照（SHA-256） | 合成 + Run #10 真实快照 221 个/12.4MB/unavailable:0 | 真实快照成功（Run #10、#11 均 unavailableResources=0） | PASS | [Run #10](https://github.com/Onesummer-D/Ripple/actions/runs/39484983941) | 无 | A |
| 1.4 | 生成文字修改候选（intent → EditOperation → 隔离 worktree diff） | `Footer.tsx` 单文件 diff | A `candidate.ts` | 真实源码 diff + patchHash + tree digest | 合成全链路 + 工作台 UI 真实可用 | 真实 Bolt 工程中候选生成步骤在失败 Run 内未稳定走完 | NOT RUN（真实） | [Bolt runs](https://github.com/Onesummer-D/Ripple/actions/workflows/bolt-acceptance.yml) | Bolt Run #1–#17 全失败 | A |
| 1.5 | 四视口预演验证（1440×900 / 768×1024 / 375×812 / 390×844） | 4 页 × 4 视口 | A `candidate-verification-runner.mjs` 等 | target-change / scope-propagation / non-target-preserved / interaction / responsive-layout / source-mapping / browser-errors 七断言 | 合成工程全 PASS（Linux CI 30/30，1 跳过为私有专项）；Run #10 完成 desktop/tablet/mobile-375 | 真实四视口完整执行：Run #10 mobile-390 预算超时；Run #11 pids 超限；Run #12 每导航 ~10 s；Run #13 RISKS；Run #14–#17 失败 | NOT RUN | [Run #11](https://github.com/Onesummer-D/Ripple/actions/runs/39499078332) | 180 s 预算 vs 真实页面加载成本（已修 PR #17，待 Run #18 裁决）；Run #18 未触发 | A / 负责人 |
| 1.6 | 范围决策（4 页 include / exclude） | ScopeDecision v1 | A `scope.ts` | 页级 Scope 与候选绑定 | 合成测试过 | 真实工程 NOT RUN（随 Run 失败） | NOT RUN | 同上 | 同上 | A |
| 1.7 | 审批（Approval 门控） | 候选 + Receipt | A | 仅 PASSED Receipt 可审批 | 合成测试过；负例（completed:false 拒绝）钉死 | 真实无完整 Receipt | NOT RUN | 同上 | 同上 | A |
| 1.8 | 应用同一份补丁到可丢弃 worktree | 同 patchHash | A `apply.ts` | 应用后 Footer.tsx 含新文案、HEAD 不变 | 合成测试过；PR #15/#16 应用预览已合并 | 真实 NOT RUN | NOT RUN | [PR #21/#22](https://github.com/Onesummer-D/Ripple/pulls) | 同上 | A |
| 1.9 | 回滚 + 原工程未改动证明 | Footer.tsx / git status | A `apply.ts` | rolled-back、原工程 HEAD 与 status 不变 | 合成测试过；B 在 MEDIA 线有真实回滚证明范式 | 真实 TEXT 线 NOT RUN | NOT RUN | 同上 | 同上 | A |
| 1.10 | 版本历史恢复 | `/__ripple/api/history` | A | 历史记录恢复后候选/哈希/验证状态一致 | 合成测试过 | 真实 NOT RUN | NOT RUN | 同上 | 同上 | A |
| 1.11 | 体验层演示流（画布优先工作台） | `experience.html` | F（PR #14） | 打开→选标题→改文案→关系→范围→对照→证据→历史 17 步连续可操作 | 单测 40/40、e2e 15/15、xp-1..4 真实 Chromium 截图 | 演示数据 DEMO/SIMULATED 全程标注；真实审批未接入（设计如此） | PASS【已合成·演示】 | [CI #475/#478](https://github.com/Onesummer-D/Ripple/actions?query=workflow%3ARipple+CI)；`docs/experience/HANDOFF.md` | 接 real-adapter 需各 Agent 提供接口（F HANDOFF §4） | F / 集成方 |

**主案例结论**：真实 TEXT 全闭环（分析→点选→候选→四视口→审批→应用→回滚→历史）**尚未通过 Run #18**，矩阵中 1.4–1.10 在真实工程上全部为 NOT RUN；录屏与参赛文案涉及这些环节时必须标注“待验收”。

## 案例二：栖光艺术节 · 媒体替换（MEDIA 辅助案例）

Fixture 定义：`src/cases/fixtures.ts`（qiguang 4 个 slot：首页横幅 `/`、节目展墙 `/program`、购票卡 `/tickets` 共享同一海报源；`/archive` 独立）。工作台支持本地图片上传（IndexedDB）、三容器裁切对照、四视口（Fixture 证据视口 1440/768/375；390 标注“验证中”）。

| # | 操作步骤 | 对应源码/页面 | 负责模块 | 期待结果 | 已有测试证据 | 实际运行结果 | 状态 | CI/截图链接 | 当前阻断 | 复验负责人 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2.1 | 选中节目页 Slot 并上传/选图（PNG/JPEG/WebP/GIF） | `/program` qiguang-program-poster-slot | A 工作台 MEDIA 交互 | 生成 media:// 候选，IndexedDB 资源可复用 | 工作台实现 + Fixture 测试；本地页面 QA JSON | 工作台层可用（本地页面） | PASS【已合成·演示】 | `docs/acceptance/2026-10-15/evidence/` | 浏览器本地资源库不随代码包迁移 | A / F |
| 2.2 | 三容器裁切对照弹窗（容器 vs 完整原图，Escape 关闭） | 首页 Hero / 展墙 / 购票卡 | A 工作台 | 各容器裁切区域可见 | README 已声明实现；Fixture 层 | 本地页面可用 | PASS【已合成·演示】 | 同上 | 真实工程未验收 | A |
| 2.3 | 横版素材 → 竖版素材的布局差异展示 | 3 个共享消费位置 | C 概念设计 + A 演示 | 裁切/遮挡/溢出差异可见 | C 三容器展示稿（概念示意标注）；E 几何规则模块（new-clip-overflow 等） | E 视觉模块**未接入 VerificationRunner**，真实 run 无可比较输入 | UNKNOWN（真实） | `docs/design/c/`；`docs/architecture/visual-difference-evidence.md`（E 分支） | E 模块未合入 A、未接入执行器 | E / A |
| 2.4 | 真实工程 MEDIA asset-swap 验收 | 青野分类图（同管线） | B（PR #7/#8，Run 39536064634） | 四视口双端 7 断言 + Approval/Apply/Rollback + 原工程未改动 | 真实验收 PASS（青野，非栖光） | 青野分类图 asset-swap：PASS；动态商品图/复杂 variants：NOT RUN（静态不可证明） | PASS（青野单操作）/ NOT RUN（范围外） | [Run 39536064634](https://github.com/Onesummer-D/Ripple/actions/runs/39536064634) | 栖光工程本身未接入真实验收管线 | B / A |
| 2.5 | E Visual Evidence（像素 diff + 几何证据） | 双端截图 | E | risk/unknown 语义证据，从不 PASS | 合成 fixture 测试 + 真实 Chromium 单测（页面为合成） | 未接入真实运行；baseline 侧截图尚未采集 | NOT RUN（真实） | E 分支 `feat/agent-e-visual-evidence-20261021` | 接入顺序见 E 文档 §7（均未实施） | E |

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
| F 体验工作台（演示流 + 审批门控） | PASS【演示·DEMO 标注】 | PR #14 已合并；e2e 15/15 | 真实审批入口在 real 模式明确不开放 |
| 生命周期清理 fail-closed / 发布门（Run #12 修复） | PASS【已合成】 | PR #13 已合并；确定性负例 22+9+8 | 真实 Bolt 未复验 |
| E 视觉差异证据 | PASS【合成】/ NOT RUN【真实】 | E 分支 fixture 测试 | 未接入 VerificationRunner，未合入 A |

## 使用规则

1. 复验以真实 CI/工件为准；上表任何 NOT RUN 在 Run #18（Bolt）或对应真实验收运行通过前不得改写为 PASS。
2. 每完成一轮真实验收，更新“实际运行结果/状态/CI 链接/复验负责人”四列并记录日期与运行 SHA。
3. 主案例与辅助案例分开记录，不以合成 Fixture 代替真实网页验收。
