# 缺失截图与待补证据清单

> 日期：2026-10-22。所有「待采」项注明采集条件与责任方；采集后须更新 acceptance-matrix.md 与相关脚本/分镜。

## A. 主案例（青野 TEXT · Bolt 真实验收）——优先级最高

| # | 缺失证据 | 采集条件 | 责任方 | 用于 |
| --- | --- | --- | --- | --- |
| A1 | Run #18 真实执行记录 bolt-workbench-execution.json + 四视口 PNG（SHA-256 与 artifactHash 绑定） | Bolt workflow 首次 PASSED 运行（Run #18 起） | 负责人触发 / A 分析 | 分镜镜 6；矩阵 1.5 |
| A2 | 七断言全 PASS 的断言面板截图（真实工程） | 同 A1 | A | 分镜镜 6；PPT 第 6 页 |
| A3 | Approval→Apply 后 bolt-workbench-applied-site.png（应用预览逐页导航，footer 新文案可见） | 同 A1 | A | 分镜镜 8；矩阵 1.8 |
| A4 | bolt-workbench-history-restored.png（历史恢复后验证状态 PASSED） | 同 A1 | A | 分镜镜 9；矩阵 1.10 |
| A5 | 回滚后原工程未改动证明（git HEAD/status 对照画面或日志摘录） | 同 A1 | A | 分镜镜 9；答辩 |
| A6 | 真实点选镜头（Bolt 工程内 footer 点选返回 Footer.tsx 来源） | 同 A1 或本地可跑通 Docker 的环境 | D / A | 分镜镜 4；矩阵 1.2 |

**Run #18 未通过前的过渡素材**（不得冒充最终证据）：
- T1 本地工作台/F 演示流的对应镜头（DEMO/FIXTURE 角标保留）——已可采。
- T2 Bolt Actions 页面 Runs #1–#17 列表 + failed-to-run.json 诊断滚动——已可采，用于「失败驱动修复」叙事。
- T3 MEDIA 线真实验收 Run 39536064634 工件（acceptance.json、四视口截图、回滚后摘要）——已存在，仅作同构佐证并标注来源。

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
| D1 | 120 s 版与完整版最终录屏（按 video-outline-120s / video-storyboard-full 镜头表） | A1–A6 或过渡素材齐备后 | 录屏执行人 | 比赛视频 |
| D2 | xp-1..4 之后的体验层新截图（若 F 层有改动） | 有视觉变化时重跑 scripts/xp-screenshot.mjs | F | PPT |
| D3 | E-REF/E-VIEW 占位符全局替换记录（C 纪律：替换前不进正式录屏） | B 真实 Evidence 接入后 | C / 集成方 | 录屏合规 |
| D4 | 参赛 PPT 成稿（按 competition-materials-draft §11 页面建议） | D1 素材就绪后 | 材料负责人 | 提交 |

## 采集纪律

1. 截图/视频命名含日期、运行号（Run #N）与 SHA；JSON 证据保留原始哈希。
2. 每条新证据入库后更新：acceptance-matrix.md（状态/链接/复验人）、qingye-main-case-script.md §3 复验清单、本分清单（✅ 标注）。
3. 过渡素材与最终证据分开存档，禁止互相替代。
