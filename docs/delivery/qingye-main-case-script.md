# 青野主案例操作脚本（TEXT · 秋日灵感季）

> 日期：2026-10-22。目标：为比赛演示与复验提供一条可执行的 10 步路线，每一步注明所用真实界面、所需数据与验证证据。
> 演示目标工程：青野文创真实 React/Vite 工程 `Onesummer-D/ripple-qingye-bolt @ f7e4998a`（私有，4 页面：/ home、/autumn 秋日手作节、/products 器物全集、/story 品牌故事；共享 Footer 品牌文字「山野器物」位于 `src/components/Footer.tsx`）。

## 0. 执行环境说明（必须先读）

存在两条执行轨道，演示与验收不能混用：

- **轨道 A · 演示轨道**：A 的 Project-first 工作台（`npm run dev` 后 http://localhost:4173 ，`project-path` 指向青野工程克隆）或 F 的体验工作台演示入口（`experience.html`，演示数据全程 DEMO/SIMULATED 标注）。本机 Windows 可运行工作台 UI 与本地 Fixture；**Docker 隔离预演与四视口真实验证在本机不可用**（无 Linux Docker）。
- **轨道 B · 真实验收轨道**：GitHub Actions「Bolt real-project acceptance」（workflow_dispatch，固定 `BOLT_REPO_REF=f7e4998a`）。**已于 Run #18（2026-10-22，A @ 16e737c）整轮通过**：<https://github.com/Onesummer-D/Ripple/actions/runs/39808500782>（浏览器用例 1.4 分钟，整轮工作流约 2.7 分钟，唯一用例 passed）。历史 Runs #1–#17 结论均 failure，逐次归因修复；Run #15–#17 阶段级先行通过（验证/审批/应用）。下文逐步骤标注【演示可录】【真实已过 Run #18】两种状态。

每步标注【演示可录】（本地可真实录屏）与【真实已过 Run #18】（真实验收已通过，证据在 Run #18 工件中）两种状态。

## 1. 十步演示路线

### 步骤 1 · 打开真实青野工程
- 界面：工作台「工程路径」输入框（`project-path`）+「分析工程」按钮；或验收入口脚本 `scripts/media-qingye-acceptance.ts` / Bolt workflow。
- 数据：青野工程克隆（`git status` 干净、HEAD=f7e4998a）、`package-lock.json`（npm ci 可复现）。
- 证据：分析后「实际页面状态 = 4」；Footer 组件行显示消费 `/home`、`/story` 等。
- 状态：【演示可录】。真实 Bolt 分析前置步骤在 Run #10/#11 已成功。

### 步骤 2 · 选择共享 Footer 品牌文字（或网页标题）
- 界面：工作台「网页点选」开关（`toggle-project-element-selection`）→ 在预览 iframe 中点击 footer 品牌文字「山野器物」；点选桥返回来源（D，PR #18）。
- 数据：DOM→Source 映射 `jsx:src/components/Footer.tsx#<line>`；实例身份 certainty（stable-react-instance 为可证明，unknown 时 fail-closed）。
- 证据：选中摘要显示源码位置；`selected-jsx-source` 文本；实例级编辑权限为 **navigation-only**（仅定位，不授权精准编辑）。
- 状态：【演示可录】+【真实已过 Run #15–#17】——真实 Bolt 中点选 footer 品牌文字并定位到 `src/components/Footer.tsx` 的步骤已真实执行通过。

### 步骤 3 · 查看源码位置与影响页面
- 界面：选中摘要（源码路径、行号）；关系涟漪图沿 reads 边展开 Source 与消费实例；范围行显示 4 个页面的关系与确定性（source-proven / partial / unknown 三色胶囊，F 体验层文案统一）。
- 数据：SourceGraph 消费关系；`sourceProvenPageImpact`。
- 证据：结构 Evidence ID（Fixture 层为 E-REF-QINGYE-001；真实层待 B Evidence Pack 替换占位符）。
- 状态：【演示可录】（Fixture/演示层）。真实关系图在 Run #15–#17 中作为验证输入使用（scope-propagation 断言通过），独立可视化镜头仍属演示层。

### 步骤 4 · 生成文字修改候选
- 界面：意图输入（`intent-input`，例："Update the shared footer brand on every page…"）+ 目标文案输入（`after-input`，例："山野器物 · Ripple UI验收"）+「添加操作」→「生成候选」（`create-real-candidate`）。
- 数据：EditSession v1；隔离 Git worktree 中的真实源码 diff；patchHash、candidateTreeDigest。
- 证据：候选 diff 视图含新文案；候选 ID 与哈希网格。
- 状态：【演示可录】+【真实已过 Run #15–#17】——真实 Bolt 候选生成走通：候选 ID、patchHash/candidateTreeDigest 绑定、diff 含新文案的断言全部通过。

### 步骤 5 · 对照桌面、平板与两个手机视口
- 界面：工作台预演 iframe 视口切换 1440 / 768 / 375（+390）；F 体验层画布工具条（390 标注「验证中」）。
- 数据：四视口计划 1440×900、768×1024、375×812、390×844（VerificationRunner 固定计划；工作台本地页为 375/768/1440 真实布局 + Fixture 390）。
- 证据：各视口截图（Fixture 证据 `docs/acceptance/2026-10-15/evidence/page-preview-*.png` 为本地页面 QA）。
- 状态：【演示可录】（本地页）+【真实已过 Run #15–#17】——真实 Bolt 四视口验证终止状态 PASSED，七项断言全过，execution.json 与四视口截图已随失败 Run 的工件保存（SHA-256 与 artifactHash 绑定）。

### 步骤 6 · 查看受影响页面及验证证据
- 界面：「验证候选」（`verify-candidate`）→ 验证状态与七项断言（target-change / scope-propagation / non-target-preserved / interaction / responsive-layout / source-mapping / browser-errors）；Evidence 详情可打开原生记录、下载 JSON；「这次预演说明了什么」逐条引用 Evidence ID。
- 数据：VerificationRun execution.json（runId、candidateId、patchHash、scopeVersion、四视口 scopeObservations、资源快照 SHA-256、blockedExternalResourceUrls=[]）。
- 证据：bolt-workbench-execution.json + 四视口 PNG（SHA-256 与 artifactHash 绑定）——**已在 Run #15–#17 的真实工件中保存**（验证阶段 PASSED 后才会进入后续步骤，工件因 if:always() 上传）。早期失败记录：Run #10 缺 mobile-390（预算）、Run #11 pids 超限、Run #12 每导航 ~10 s、Run #13 终止 RISKS，均已逐项修复（PR #17/#19/#20）。
- 状态：【真实已过 Run #15–#17】——终止状态 PASSED、七项断言全部 PASS；这是目前主案例最硬的真实证据。

### 步骤 7 · 确认修改范围
- 界面：范围决策（4 页 include/exclude，ScopeDecision）；来源卡「只改当前实例 / 同步同源实例」快捷切换；审批门控（F 层）：存在未决定页面或包含 unknown/partial 页面 → 拒绝。
- 数据：ScopeDecision v1 与候选绑定；scopeVersion。
- 证据：范围汇总与门控拒绝文案（单测/e2e 覆盖）。
- 状态：【演示可录】+【真实已过 Run #15–#17】——真实 4 页 include 决策随候选创建执行并通过。

### 步骤 8 · 审批及应用
- 界面：「批准候选」（`approve-candidate`，仅 PASSED 可点）→「应用候选」（`apply-candidate`）；应用预览（PR #15/#21）：以候选身份启动已应用版本预览，桌面导航三个页面验证 footer 标记保持可见。
- 数据：同一份 CandidatePatch 应用；应用前基线检查；应用后 Footer.tsx 含新文案、HEAD 不变。
- 证据：Run #18 工件（bolt-workbench-candidate.png 等）；应用后 `Footer.tsx` 含「山野器物 · Ripple UI验收」、HEAD 不变的断言真实通过。
- 状态：【真实已过 Run #18】——审批成功（候选进入「已批准」）、应用成功（同补丁、基线检查通过）。

### 步骤 9 · 查看应用结果
- 界面：应用预览 iframe（1280 桌面视口）逐页导航；工作台状态 chip「applied」。
- 数据：三页 H1 断言（秋日手作节/器物全集/从山野，到日常）+ footer 新文案可见。
- 证据：bolt-workbench-applied-site.png 已在 Run #18 工件中（为其中一次导航后的单张截图，完整证明以逐页断言为准，归档于 `evidence/run18/`）；三页导航与每页 footer 新文案保持可见的断言全部通过。
- 状态：【真实已过 Run #18】。

### 步骤 10 · 回滚与版本恢复
- 界面：「回滚候选」（`rollback-candidate`）→ 状态「rolled-back」；「版本历史」行「恢复记录」。
- 数据：Footer.tsx 恢复原文（`山野器物</span>` 且无 "Ripple UI验收"）；应用 worktree 与原工程 HEAD/status 逐字节不变；历史记录 lifecycle=rolled-back、patchHash 一致；恢复后候选 ID/patchHash/验证状态 PASSED 一致。
- 证据：bolt-workbench-history-restored.png 已在 Run #18 工件中。
- 状态：【真实已过 Run #18】。

## 2. 演示建议

全部 10 步均已有真实证据（Run #18 整轮通过 + 工件齐备）。录屏直接引用真实运行结果与真实界面即可，不再需要「待验收」过渡素材。保留两条纪律：

1. 凡数据来自 Fixture/演示适配器的镜头，画面角落保留 DEMO/FIXTURE 标识（F 工作台顶栏常驻 DEMO chip）。
2. 概念走位画面（C 的 kanva 状态稿）只作分镜参照，投屏时保留其「概念效果示意 · 非浏览器实测截图」标注。

## 3. 证据归档清单

- [x] 归档 Run #18 工件 ripple-bolt-workbench-39808500782 → **`docs/delivery/evidence/run18/`（2026-10-23，238 文件与远端逐字节一致）**：bolt-workbench-execution.json（v4 manifest，七断言 pass）、四视口 PNG（SHA-256 与 artifactHash 已核对一致）、analysis/candidate/applied-site/history-restored.png、bolt-resource-load-audit.json、browser-results.json、resource-snapshots（221 个）与 progress.jsonl 诊断；逐文件哈希与来源标识见 `evidence/run18/INDEX.md`。
- [x] 录屏/PPT 引用上述素材时标注来源：Run #18 @ 16e737c × 青野 f7e4998a，2026-10-22。
- [ ] 历史 Runs #1–#17 的失败日志保留在 _scratch，用于「失败驱动修复」叙事（可选，本地留存不入库）。
- [ ] A6 工作台验证面板 UI 截图：仍缺失，需本地补采（见 evidence-gap-checklist A6）。
