# 120 秒精华版 · 最终素材清单（2026-10-23 晚）

> 用途：交给剪辑同学直接开工。沿用 `video-voiceover-120s.md` 八镜结构与口播，不重新策划。
> 素材根目录：`docs/delivery/evidence/run18/`（Run #18 归档，238 文件，SHA256SUMS.txt 可逐文件校验）。
> 角标纪律：REAL＝Run #18 真实验收证据；DEMO＝F 演示界面（角标必须保留）；录屏缺口见每镜「待录」列。
> 直接可用的成品片段：本节末尾的 `run18-evidence-showcase.avi`（35 s · 1920×1080 · 本目录），覆盖镜 5/6/7 全部真实证据，可整段剪入。

## 逐镜素材核查表

| 镜 | 时间 | 时长建议 | 来源 | 可用文件（相对 `docs/delivery/evidence/run18/`） | 可直接剪辑？ | 待录/缺口 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 0:00–0:12 | 12 s | REAL | `bolt-workbench-analysis.png`（2.65 MB，分析完成态，可替代录屏做静帧+推近） | 部分（静帧动画可用） | 需录：工作台导入青野工程→点「分析工程」真实操作（Windows 可录，环境见 video-recording-setup.md §B，需青野私有 ZIP）；或用 analysis.png 静帧+字幕替代 |
| 2 | 0:12–0:28 | 16 s | REAL | 无 Run #18 点选截图（点选成功证据在 diagnostics progress.jsonl 日志中） | 不可 | 需录：真实 iframe 点选 footer「山野器物」（**需 Linux Docker**；无 Docker 则录 Fixture 点选画面标 FIXTURE 或改用叙述衔接，文案注明「点选已过 Run #15–#18 真实验收」） |
| 3 | 0:28–0:45 | 17 s | DEMO | 无（F 体验工作台演示数据） | 不可 | 需录：F 关系涟漪图展开（Windows 可录，§A 环境；DEMO 角标全程保留） |
| 4 | 0:45–1:00 | 15 s | DEMO | 无（演示流） | 不可 | 需录：范围决策 include/exclude + 门控拦截 unknown 页（§A；真实 4 页 include 决策已过 Run #18，画面仍标 DEMO） |
| 5 | 1:00–1:22 | 22 s | REAL | `bolt-workbench-execution.json`（155,985 B，七断言全 pass）＋ `bolt-workbench-{1440,768,375,390}.png`（四视口，SHA-256 与 artifactHash 逐一致） | **✅ 已就绪**（片段第 12–20 s 已合成四视口轮播+断言卡） | 可选补采 C-α（验证面板连续操作，Windows 可录） |
| 6 | 1:22–1:38 | 16 s | REAL | `bolt-workbench-applied-site.png`（应用后三页导航之一的截图）＋ execution.json 三页逐页 H1/footer 断言（完整证明） | **✅ 已就绪**（片段第 25–29 s；逐页断言字幕需剪辑按 execution.json 加） | 可选补采 C-β（三页连续导航，**需 Linux Docker**；无 Docker 维持截图+断言字幕版） |
| 7 | 1:38–1:50 | 12 s | REAL | `bolt-workbench-history-restored.png`（4.62 MB）＋ execution.json lifecycle=rolled-back + 双端 HEAD/status 不变断言 | **✅ 已就绪**（片段第 29–33 s） | 可选补采 C-γ（回滚+历史恢复连续操作，Windows 可录 Fixture 工程） |
| 8 | 1:50–2:00 | 10 s | REAL | GitHub 仓库页截图（待截：`github.com/Onesummer-D/Ripple`，注意隐藏登录态头像/邮箱） | 待截（1 张静态图） | 截 1 张仓库页即可 |

## Run #18 重点素材明细（镜 5/6/7 高潮段，全部可直接剪辑）

| # | 素材 | 路径（`evidence/run18/` 下） | 字节 | SHA-256（前 16 位） | 用于 |
| --- | --- | --- | --- | --- | --- |
| 1 | 分析阶段截图 | `bolt-workbench-analysis.png` | 2,652,285 | 872d25b8d0e872b5 | 镜 1 静帧 |
| 2 | Candidate 创建截图 | `bolt-workbench-candidate.png` | 2,813,105 | a5e3d3b27f464a51 | 片段第 8–12 s |
| 3 | 视口 1440×900 | `bolt-workbench-1440.png` | 2,553,853 | 21f2bc73260d8ca5 | 镜 5 |
| 4 | 视口 768×1024 | `bolt-workbench-768.png` | 1,684,326 | 1a7c5c4645387cea | 镜 5 |
| 5 | 视口 375×812 | `bolt-workbench-375.png` | 858,353 | d4a1a9ce9013195d | 镜 5 |
| 6 | 视口 390×844 | `bolt-workbench-390.png` | 889,214 | fa72104166fb70c1 | 镜 5（**仅证明青野 TEXT 与公共验证器视口能力，不构成栖光证据**） |
| 7 | 七断言验证结果 | `bolt-workbench-execution.json` → assertions[7] 全 pass | 155,985 | a5fe841e951577f7 | 镜 5 断言卡 |
| 8 | 应用后网页截图 | `bolt-workbench-applied-site.png` | 749,551 | fcc479cd26db5d3c | 镜 6（三页导航完整证明为 execution.json 逐页断言，本图仅为其中一次） |
| 9 | 回滚与历史恢复 | `bolt-workbench-history-restored.png` | 4,617,762 | 430bb1fca6d55ffb | 镜 7 |
| 10 | 资源授权审计 | `bolt-resource-load-audit.json` | 3,489 | 1c8b02876ff521ad | 镜 5 备查字幕（221 快照、unavailable=0、blocked=[]） |
| 11 | 浏览器结果 | `browser-results.json` | 7,450 | b8827cc457aac8e7 | 备查字幕 |

七断言一览（供字幕逐条弹出，均 pass）：target-change / non-target-preserved / scope-propagation / interaction / responsive-layout / source-mapping / browser-errors。

## 成品片段

`run18-evidence-showcase.avi`（与本清单同目录）：
- 35 s · 1920×1080 · MJPEG/AVI（剪辑软件可直接导入，定稿前建议转 H.264）；
- 内容：开场卡（3 s）→ 工程分析（5 s）→ 候选生成（4 s）→ **四视口轮播+七断言卡（8 s，高潮）** → 应用后站点（4 s）→ 回滚与历史（4 s）→ 结尾卡（2 s）；
- 全部画面取自上表 Run #18 归档截图，仅做平移/缩放/淡入淡出/字幕标注，**无合成点击、无伪造导航**；
- 每段画面带 REAL 角标与「Run #18 @ 16e737c × 青野 f7e4998a」出处条。

## 录屏缺口汇总（交录屏同学）

| 缺口 | 镜 | 环境 | 产出文件命名 |
| --- | --- | --- | --- |
| 工作台导入+分析操作 | 1 | Windows（需青野私有 ZIP） | `rec-120s-s1-import.mp4` |
| 真实 iframe 点选 footer | 2 | **Linux Docker**；无 Docker 改 FIXTURE 画面 | `rec-120s-s2-pick.mp4` |
| F 关系涟漪图演示 | 3 | Windows（§A，DEMO 角标） | `rec-120s-s3-ripple-demo.mp4` |
| F 范围决策+门控演示 | 4 | Windows（§A，DEMO 角标） | `rec-120s-s4-scope-demo.mp4` |
| 仓库页静态截图 | 8 | 任意（隐藏个人信息） | `shot-8-repo.png` |
| 可选 C-α/β/γ 连续交互 | 5/6/7 | C-α/γ Windows；C-β Docker | `rec-120s-c{a,b,g}-*.mp4` |

> 镜 5/6/7 若用本清单成品片段，仅需按口播表微调节奏，无强制录屏需求。
