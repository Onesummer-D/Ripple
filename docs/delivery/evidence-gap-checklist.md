# 缺失截图与待补证据清单

> 日期：2026-10-23（Run #18 通过后定稿）。所有「待采」项注明采集条件与责任方；采集后须更新 acceptance-matrix.md 与相关脚本/分镜。
> **Run #18（2026-10-22，A @ 16e737c）整轮 SUCCESS**：<https://github.com/Onesummer-D/Ripple/actions/runs/39808500782>。A 组证据已全部生成（工件 ripple-bolt-workbench-39808500782，27 MB，retention 30 天），现状为「已生成、待归档」，非缺失。

## A. 主案例（青野 TEXT · Bolt 真实验收）——已闭环

| # | 证据 | 现状 | 用于 |
| --- | --- | --- | --- |
| A1 | bolt-workbench-execution.json（v4 manifest，completed:true，七断言全 pass，16 条 scopeObservations，221 资源快照，blocked/unavailable 均空） | ✅ Run #18 工件已生成，SHA-256 绑定已核对，**待归档** | 分镜镜 6；矩阵 1.5；PPT 第 6 页 |
| A2 | 四视口 PNG（1440×900 / 768×1024 / 375×812 / 390×844，artifactHash 与文件 SHA-256 一致，已核对） | ✅ 同上 | 分镜镜 6；PPT 第 6 页 |
| A3 | bolt-workbench-analysis.png / candidate.png（分析、候选阶段工作台截图） | ✅ 同上 | 分镜镜 3/5；PPT 第 4 页 |
| A4 | bolt-workbench-applied-site.png（应用后三页导航，footer 新文案可见） | ✅ Run #18 断言通过后拍摄入工件 | 分镜镜 8；矩阵 1.9 |
| A5 | 回滚与历史恢复（history-restored.png；Footer.tsx 恢复原文、双端 HEAD/status 不变断言通过） | ✅ Run #18 工件已生成 | 分镜镜 9；矩阵 1.10/1.11 |
| A6 | 工作台验证面板 UI 截图（成功路径不自动截屏） | ⬜ **确实缺失**——需本地复跑补采（标注 FIXTURE 角标）或从录屏截取 | PPT 第 6 页过渡 |

**归档动作**：将 Run #18 工件解压归档（execution.json、五张 PNG、resource-load-audit.json、resource-snapshots、diagnostics），引用时标注「Run #18 @ 16e737c × 青野 f7e4998a，2026-10-22」。可选叙事素材：Runs #1–#17 阶段级失败日志（已存 _scratch/delivery-prep/run15/run16/run17/run18-logs.zip）。

**本地可立即补采**：
- A7 真实点选镜头（本地工作台录 footer 点选返回 Footer.tsx 来源；真实 Bolt 点选已过 Run #18，录屏用本地画面不冲突）——D / A，用于分镜镜 4。

## B. 栖光 MEDIA 案例

| # | 缺失证据 | 采集条件 | 责任方 | 用于 |
| --- | --- | --- | --- | --- |
| B1 | 栖光真实工程接入 MEDIA 管线的验收运行（四视口双端截图 + acceptance.json） | B/A 接入真实管线 + 负责人 dispatch | B / A | 矩阵 2.4 |
| B2 | E 视觉证据真实样本：双端截图的 risk/unknown 证据 JSON + 差异图 | E §7 接入顺序（1) baseline 同参截图 2) 采样器绑定 3) manifest visualComparisons）实施并合入 | E / A | 分镜镜 11；qiguang-materials §5 |
| B3 | 横→竖替换后三容器真实裁切/遮挡/溢出观测（E 几何规则输出） | 同 B2 | E | qiguang-materials §4 |
| B4 | 390×844 视口真实证据（替换 F 层「验证中」标注） | 同 B2 或 Run #18 级真实运行 | E | 矩阵 2.3 |
| 已有 | 本地 MEDIA 交互录屏、三容器裁切弹窗、C 概念海报（16:9/4:5，示意标注） | — | A / C | 分镜镜 10 过渡 |

## C. 第三方案例

| # | 缺失证据 | 采集条件 | 责任方 | 用于 |
| --- | --- | --- | --- | --- |
| C1 | A-P1a data router 识别合入后的重跑探针统计（route 节点 > 0、页面影响不再是 100 unknown） | A-P1a 合入 + 三方 SHA 固定 | A / B | thirdparty-compatibility §2 |
| C2 | ProfileHeader.tsx:72 "Overview" TEXT 全生命周期工件 | C1 之后按阻断矩阵推进 | B | 矩阵 3.4 |
| C3 | 英文 Issue #6 接口需求评论的发布回执 | 负责人代发 | 负责人 | thirdparty §6（当前 NOT POSTED） |
| 已有 | b700bbd 探针报告、阻断矩阵、复现测试、CI #315/#316 | — | B | 分镜镜 12 |

## D. 通用

| # | 缺失证据 | 采集条件 | 责任方 | 用于 |
| --- | --- | --- | --- | --- |
| D1 | 120 s 版与完整版最终录屏（按 video-outline-120s / video-storyboard-full 镜头表） | 主案例素材 A1–A5 归档后即可开录（镜 6/8/9 用 Run #18 真实证据）；栖光镜 10 仍为本地演示镜头 | 录屏执行人 | 比赛视频 |
| D2 | xp-1..4 之后的体验层新截图（若 F 层有改动） | 有视觉变化时重跑 scripts/xp-screenshot.mjs | F | PPT |
| D3 | E-REF/E-VIEW 占位符全局替换记录（C 纪律：替换前不进正式录屏） | B 真实 Evidence 接入后 | C / 集成方 | 录屏合规 |
| D4 | 参赛 PPT 成稿（按 competition-materials-draft 评委版 §十 页面建议） | D1 素材就绪后 | 材料负责人 | 提交 |

## 采集纪律

1. 截图/视频命名含日期、运行号（Run #N）与 SHA；JSON 证据保留原始哈希。
2. 每条新证据入库后更新：acceptance-matrix.md（状态/链接/复验人）、qingye-main-case-script.md §3 归档清单、本分清单（✅ 标注）。
3. 过渡素材与最终证据分开存档，禁止互相替代。
