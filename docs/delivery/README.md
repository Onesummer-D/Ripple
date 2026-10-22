# Ripple 比赛交付文档（docs/delivery/）

> 日期：2026-10-23（Asia/Shanghai）
> 分支：`docs/competition-delivery-20261022`。**两条基线分开记**：①文档分支原始基线＝A 主线 `feat/project-first-core-20261018 @ 2525092`（本文档与 F 体验工作台所在，分叉点已核实）；②正式验收基线＝`16e737c16d95a26879d1aee813b85fb472fd8215`（Run #18 Bolt 验收时的 A 主线，含 PR #15/#16/#23 应用预览修复；**不在**本分支内，引用以远端与归档证据为准）。
> 性质：**纯文档交付 + Run #18 原始证据归档**（`evidence/run18/`，29 MB）。不修改 A 的任何核心源码、验证器或真实工程资产；文档以只读方式核对 GitHub 远端与本地工作区后编写。
> 状态纪律：所有功能按三种状态标注——【已验证】已由真实工程/真实浏览器证据验证；【已合成】已由合成测试证明但未完成真实案例验收；【未接入】尚未接入或仍在开发。后两种不得写成已完成。
> 修订历史：6a1a51d（初稿）→ 7bcc838（Run #15–#17 阶段级更正）→ 66fb241b（Run #18 整轮通过后最终事实修订 + 参赛材料评委语言重构）→ 本轮（最终复审：能力边界三层划分、证据对应关系、视频来源标注、栖光 390 范围更正、Run #18 证据归档、逐镜口播执行表）。

## 文档清单

| # | 文件 | 内容 | 对应任务书章节 |
| --- | --- | --- | --- |
| 01 | [acceptance-matrix.md](./acceptance-matrix.md) | 三案例统一验收矩阵（青野 TEXT 主案例 / 栖光 MEDIA / 第三方开源站） | 四 |
| 02 | [qingye-main-case-script.md](./qingye-main-case-script.md) | 青野主案例 10 步演示路线与操作脚本 | 三·案例一 |
| 03 | [qiguang-media-materials.md](./qiguang-media-materials.md) | 栖光媒体案例素材规格与验收清单 | 三·案例二 |
| 04 | [thirdparty-compatibility.md](./thirdparty-compatibility.md) | 第三方开源站兼容性清单（codescandy @ b700bbd） | 三·案例三 |
| 05 | [video-outline-120s.md](./video-outline-120s.md) | 120 秒精华版视频大纲 | 五 |
| 06 | [video-storyboard-full.md](./video-storyboard-full.md) | 3–4 分钟完整版分镜表（含旁白草稿与证据采集清单） | 五 |
| 07 | [competition-materials-draft.md](./competition-materials-draft.md) | 参赛材料内容初稿（作品概述 / 背景 / 需求 / 功能 / 架构 / 创新 / 技术路线 / 测试验证 / 应用价值 / 不足与计划 / PPT 页面建议） | 六 |
| 08 | [evidence-gap-checklist.md](./evidence-gap-checklist.md) | 缺失截图与待补证据清单 | 五·6 / 七·8 |
| 09 | [video-voiceover-120s.md](./video-voiceover-120s.md) | 120 秒版 8 镜逐镜口播词与录屏执行表 | 五 |
| 10 | [video-voiceover-full.md](./video-voiceover-full.md) | 3:30 完整版 13 镜逐镜口播词与录屏执行表 | 五 |
| 11 | [video-recording-setup.md](./video-recording-setup.md) | 录屏环境可执行清单（F DEMO / A 工作台 / 归档证据三类，含 ZIP 获取、Docker 边界与隐私要求） | 五 |
| 12 | [录屏任务分发表-A4.docx](./录屏任务分发表-A4.docx) / [录屏任务分发表-A4.pdf](./录屏任务分发表-A4.pdf) | 一页 A4 录屏任务分发表（每镜：执行人/操作/素材来源/必需可选/运行环境/完成状态） | 五 |
| — | [evidence/run18/](./evidence/run18/INDEX.md) | Run #18 原始证据归档（238 文件 + SHA256SUMS 全量校验 + 审核结论） | — |

## 当前真实验收状态摘要（截至 2026-10-23，Run #18 后，证据已归档）

| 案例 | 真实验收状态 |
| --- | --- |
| 青野 TEXT（Bolt real-project acceptance） | **整轮通过（Run #18，2026-10-22，A @ 16e737c）**：工程分析→资源快照→点选→候选生成→四视口验证（七断言全 pass）→范围决策→审批→应用→应用后三页导航→回滚（原工程未改动证明）→历史恢复，全链路真实走通并留证（execution.json v4、四视口 PNG 哈希绑定、applied-site/history-restored 截图均在工件 `ripple-bolt-workbench-39808500782` 中）。历史：Runs #1–#17 结论均 failure，逐次归因修复（资源快照→pids→导航成本→导航契约→应用预览挂载），Run #15–#17 阶段级先行通过验证/审批/应用。 |
| 青野 MEDIA（Qingye real-project MEDIA acceptance） | Run `39536064634`（2026-10-21）**SUCCESS**：四视口双端验证、7 项断言、Approval/Apply/Rollback、原工程未改动检查通过。仅限「青野分类图 source-proven MEDIA asset-swap」单操作。 |
| 栖光 MEDIA | 工作台 Fixture/演示层可用（本地图片上传、三容器裁切对照）；**真实工程 MEDIA 验收未在栖光工程上运行**，E 视觉差异模块未接入 VerificationRunner。 |
| 第三方（codescandy dashui @ b700bbd） | 能力盘点与缺口复现完成（4924 节点/5006 边；61 条 source-proven 消费边；100 条页面影响全 unknown；route 0、token 0）；TEXT 全生命周期 NOT RUN；Issue #6 不关闭。 |

## 关键证据链接（全部已实际核对）

- **Bolt Run #18 @ 16e737c（整轮 SUCCESS，主案例真实闭环通过）**：<https://github.com/Onesummer-D/Ripple/actions/runs/39808500782>；**原始证据已归档**：`evidence/run18/`（238 文件与远端逐字节一致，ZIP SHA-256 `35668a23…ff2c44`，逐文件哈希索引见 `evidence/run18/INDEX.md`；远端工件 retention 30 天，到期后以此目录为准）
- 公开性说明：主项目开源、验收记录链接公开可查；真实验收工程 `ripple-qingye-bolt` 为**私有仓**；CI 工件有保存期限，长期副本以上述归档目录为准
- Bolt 真实工程验收（历史 Runs #1–#17 结论均 failure，逐次归因修复）：<https://github.com/Onesummer-D/Ripple/actions/workflows/bolt-acceptance.yml>
- Bolt Run #15 @ a4ac547（验证/审批/应用阶段通过）：<https://github.com/Onesummer-D/Ripple/actions/runs/39724024971>
- Bolt Run #16 @ 83ddff5（应用预览启动通过、导航超时）：<https://github.com/Onesummer-D/Ripple/actions/runs/39761298824>
- Bolt Run #17 @ 736a029（导航点击超时）：<https://github.com/Onesummer-D/Ripple/actions/runs/39774721394>
- 普通 CI（Ripple CI）：<https://github.com/Onesummer-D/Ripple/actions?query=workflow%3ARipple+CI>（A 主线 2525092 对应 CI #478 success）
- 青野 MEDIA 验收 Run：<https://github.com/Onesummer-D/Ripple/actions/runs/39536064634>
- A+D Runtime Identity 集成 CI：<https://github.com/Onesummer-D/Ripple/actions/runs/39650178433>（Vitest 408/408、Playwright 30/30）
- PR #17 受限预构建实验 CI：<https://github.com/Onesummer-D/Ripple/actions/runs/39667915489>（426/426、30 passed/1 skipped）
- Bolt Run #10（资源快照成功、预算超时）：<https://github.com/Onesummer-D/Ripple/actions/runs/39484983941>
- Bolt Run #11（pids 超限失败）：<https://github.com/Onesummer-D/Ripple/actions/runs/39499078332>
- 青野真实工程固定版本：`Onesummer-D/ripple-qingye-bolt @ f7e4998a5c77ab4aeb3232dbc31e61196e9051a6`（私有仓，凭据由负责人配置）
- 第三方探针冻结版本：codescandy（dashui）@ `b700bbd55b31a62fe04d4cd8210fc37232f0c9f0`，MIT
