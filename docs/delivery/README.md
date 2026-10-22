# Ripple 比赛交付文档（docs/delivery/）

> 日期：2026-10-22（Asia/Shanghai）
> 分支：`docs/competition-delivery-20261022`（基于 A 主线 `feat/project-first-core-20261018 @ 2525092`）
> 性质：**纯文档交付**。不修改 A 的任何核心源码、验证器或真实工程资产；全部内容以只读方式核对 GitHub 远端、本地工作区与已提交交接文档后编写。
> 状态纪律：所有功能按三种状态标注——【已验证】已由真实工程/真实浏览器证据验证；【已合成】已由合成测试证明但未完成真实案例验收；【未接入】尚未接入或仍在开发。后两种不得写成已完成。

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

## 当前真实验收状态摘要（截至 2026-10-22 晚）

| 案例 | 真实验收状态 |
| --- | --- |
| 青野 TEXT（Bolt real-project acceptance） | Runs #1–#17 **全部失败**，Run #18 未触发；最近一次为 2026-10-22 的 Run #17（3m 8s，failure）。无完整可审批 Receipt，Approval→Apply→Rollback→History Restore 真实闭环 **NOT RUN**。 |
| 青野 MEDIA（Qingye real-project MEDIA acceptance） | Run `39536064634`（2026-10-21）**SUCCESS**：四视口双端验证、7 项断言、Approval/Apply/Rollback、原工程未改动检查通过。仅限「青野分类图 source-proven MEDIA asset-swap」单操作。 |
| 栖光 MEDIA | 工作台 Fixture/演示层可用（本地图片上传、三容器裁切对照）；**真实工程 MEDIA 验收未在栖光工程上运行**，E 视觉差异模块未接入 VerificationRunner。 |
| 第三方（codescandy dashui @ b700bbd） | 能力盘点与缺口复现完成（4924 节点/5006 边；61 条 source-proven 消费边；100 条页面影响全 unknown；route 0、token 0）；TEXT 全生命周期 NOT RUN；Issue #6 不关闭。 |

## 关键证据链接（全部已实际核对）

- 普通 CI（Ripple CI）：<https://github.com/Onesummer-D/Ripple/actions?query=workflow%3ARipple+CI>（A 主线 2525092 对应 CI #478 success；PR #23 分支在跑）
- Bolt 真实工程验收（Runs #1–#17 全失败）：<https://github.com/Onesummer-D/Ripple/actions/workflows/bolt-acceptance.yml>
- 青野 MEDIA 验收 Run：<https://github.com/Onesummer-D/Ripple/actions/runs/39536064634>
- A+D Runtime Identity 集成 CI：<https://github.com/Onesummer-D/Ripple/actions/runs/39650178433>（Vitest 408/408、Playwright 30/30）
- PR #17 受限预构建实验 CI：<https://github.com/Onesummer-D/Ripple/actions/runs/39667915489>（426/426、30 passed/1 skipped）
- Bolt Run #10（资源快照成功、预算超时）：<https://github.com/Onesummer-D/Ripple/actions/runs/39484983941>
- Bolt Run #11（pids 超限失败）：<https://github.com/Onesummer-D/Ripple/actions/runs/39499078332>
- 青野真实工程固定版本：`Onesummer-D/ripple-qingye-bolt @ f7e4998a5c77ab4aeb3232dbc31e61196e9051a6`（私有仓，凭据由负责人配置）
- 第三方探针冻结版本：codescandy（dashui）@ `b700bbd55b31a62fe04d4cd8210fc37232f0c9f0`，MIT
