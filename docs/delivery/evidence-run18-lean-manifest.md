# Run #18 比赛精简素材清单与 PR #24 可合并性说明（2026-10-23 晚）

> 目的：为比赛提交建立「适合公开」的精简素材边界；**本轮不删除任何已提交文件、不改写 Git 历史、不合并 PR**。所有结论以 `evidence/run18/SHA256SUMS.txt`（239 文件全量哈希）为校验基准。

## 一、比赛提交保留集（公开无授权障碍，约 16.4 MB）

下列文件建议作为比赛材料的公开证据集保留（逐文件 SHA-256 以 `evidence/run18/INDEX.md` 与 `SHA256SUMS.txt` 为准）：

### 关键截图与执行记录（8 项，约 16.0 MB）

| 文件 | 字节 | 比赛用途 |
| --- | --- | --- |
| `bolt-workbench-analysis.png` | 2,652,285 | 镜 1 · PPT 第 4 页（工程分析） |
| `bolt-workbench-candidate.png` | 2,813,105 | 片段第 8–12 s · PPT 第 4 页（候选生成） |
| `bolt-workbench-1440.png` | 2,553,853 | 镜 5 · PPT 第 6 页（桌面视口） |
| `bolt-workbench-768.png` | 1,684,326 | 镜 5（平板视口） |
| `bolt-workbench-375.png` | 858,353 | 镜 5（手机视口） |
| `bolt-workbench-390.png` | 889,214 | 镜 5（手机视口；**仅青野 TEXT 证据**） |
| `bolt-workbench-applied-site.png` | 749,551 | 镜 6 · PPT 第 7 页（应用后站点） |
| `bolt-workbench-history-restored.png` | 4,617,762 | 镜 7 · PPT 第 7 页（回滚与历史恢复） |

### 结构化证据与说明（5 项，约 380 KB）

| 文件 | 字节 | 比赛用途 |
| --- | --- | --- |
| `bolt-workbench-execution.json` | 155,985 | 七断言/逐页导航/回滚断言的完整证明 |
| `browser-results.json` | 7,450 | 备查字幕（浏览器日志摘要） |
| `bolt-resource-load-audit.json` | 3,489 | 资源授权审计（221 快照登记、unavailable=0） |
| `INDEX.md` | 12 KB | 来源标识、完整性校验命令、使用边界 |
| `SHA256SUMS.txt` | 48 KB | 239 文件逐文件 SHA-256（自校验 0 不符） |

### 成品片段（本轮新增，约 75 MB）

| 文件 | 字节 | 说明 |
| --- | --- | --- |
| `../run18-evidence-showcase.avi` | 75.7 MB | 35 s · 1920×1080 · MJPEG/AVI（无 ffmpeg 环境纯 Python 生成）；全部画面取自上表 Run #18 归档截图，仅平移/缩放/淡入淡出/字幕标注；840/840 帧结构校验通过；剪辑软件可直接导入，定稿前建议转 H.264 |

### 诊断（可选保留，约 161 KB）

`diagnostics/verification-9396b660-…/`（progress.jsonl、resource-fetch-log.json、snapshot-timing.json）：运行过程留痕，无授权风险；体积可忽略，建议保留以支撑「失败逐次归因」叙事。

> 备注：8 张 PNG 含青野私有工程页面画面（品牌文案与「Ripple UI验收」标记页脚），公开性由负责人在 INDEX §终审-2 已知情，比赛用途视为可接受，最终对外口径仍由负责人确认。
> 哈希更正（本轮）：`4481028` 修改了 INDEX.md 但未同步 SHA256SUMS，导致 INDEX.md 一条不符；本轮已将 SHA256SUMS 的 INDEX.md 条目更正为已入库 blob 的实际 SHA-256（`05d98cfb…00c57bb`），更正后 **git 对象库 239/239 全部一致**（2026-10-23 复核）。Windows 工作区校验时若 core.autocrlf=true，文本类文件检出会为 CRLF，建议按 INDEX.md 内命令在 Linux/CI 或 `git -c core.autocrlf=false checkout` 环境下校验。

## 二、原始资源快照（单独列出，公开再分发受限）

| 位置 | 数量 | 体积 | 内容 | 授权结论 |
| --- | --- | --- | --- | --- |
| `resource-snapshots/verification-9396b660-…/` | 221 | 13 MB | 202×WOFF2 + 18×AVIF + 1×CSS | Google Fonts OFL：允许原样再分发（低风险）；**Pexels 18×AVIF：不允许原样再分发** |
| `source-resource-snapshots/` | 3 | 232 KB | 源码侧 AVIF（与上 3 个同源） | 同 Pexels 受限 |

**处理方式（本轮不执行删除）**：沿用 `evidence/run18/INDEX.md` §5 的方案 B 安全迁移计划——负责人私有归档 ZIP（SHA-256 `35668a23…ff2c44` 登记衔接）→ 独立校验 → 双副本确认 → **获批后**以普通 `git rm` 提交移出快照字节（接受 Git 历史体积保留）。快照可由固定配置（A @ 16e737c × 青野 f7e4998a）重跑复现。

## 三、PR #24 可合并性说明

1. **本轮状态：不合并**。理由：① 负责人私有备份未确认（方案 B 第 1–3 步未执行）；② 快照字节授权风险未处置；③ 协调方明确「未完成私有备份及负责人确认前，不合并 PR #24」。
2. **内容侧可合并性**：除快照目录外，全部文档与证据文件为自包含交付（docs/delivery/ 12 份文档 + run18 归档 + 录屏任务分发表 + 本轮 3 份新增：本清单、`video-materials-120s-final.md`、`run18-evidence-showcase.avi`），不触碰 A 核心源码，与 A 主线无代码冲突面。
3. **风险面**：Pexels 21 个 AVIF 原始字节在公开仓库的再分发构成主要授权风险；合并前至少应完成方案 B 的快照迁移，或在合并说明中显式登记该风险由负责人承担。
4. **基线口径**：文档内凡引用「最新公共基线 @ 45a2d7c」「F 真实 TEXT 候选完成」处，均为 2026-10-23 协调方通知口径，本机网络中断（GitHub/PyPI 均不可达）**未能远端复核**，推送前需以 GitHub 远端实际状态复核一遍。

## 四、待负责人事项

1. 拍板方案 B 并执行快照迁移（或书面接受风险维持现状）。
2. 提供青野私有仓 ZIP，启动镜 1/2 录屏（Windows 可录镜 1；镜 2 需 Docker 或改 FIXTURE）。
3. 截仓库页静态图（镜 8，隐藏个人信息）。
4. 复核本清单与文档中 45a2d7c 相关口径（网络恢复后）。
5. AVI 片段在剪辑机验证可导入后，定稿转 H.264 再入正式视频。
