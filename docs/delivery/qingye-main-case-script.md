# 青野主案例操作脚本（TEXT · 秋日灵感季）

> 日期：2026-10-22。目标：为比赛演示与复验提供一条可执行的 10 步路线，每一步注明所用真实界面、所需数据与验证证据。
> 演示目标工程：青野文创真实 React/Vite 工程 `Onesummer-D/ripple-qingye-bolt @ f7e4998a`（私有，4 页面：/ home、/autumn 秋日手作节、/products 器物全集、/story 品牌故事；共享 Footer 品牌文字「山野器物」位于 `src/components/Footer.tsx`）。

## 0. 执行环境说明（必须先读）

存在两条执行轨道，演示与验收不能混用：

- **轨道 A · 演示轨道**：A 的 Project-first 工作台（`npm run dev` 后 http://localhost:4173 ，`project-path` 指向青野工程克隆）或 F 的体验工作台演示入口（`experience.html`，演示数据全程 DEMO/SIMULATED 标注）。本机 Windows 可运行工作台 UI 与本地 Fixture；**Docker 隔离预演与四视口真实验证在本机不可用**（无 Linux Docker）。
- **轨道 B · 真实验收轨道**：GitHub Actions「Bolt real-project acceptance」（workflow_dispatch，固定 `BOLT_REPO_REF=f7e4998a`）。截至 2026-10-22，整轮 workflow 结论 Runs #1–#17 均 failure，但**阶段级结果不同**（协调人已据 Run #15–#17 日志核实）：真实工程上「分析→快照→点选→候选生成→四视口验证七断言 PASSED→范围决策→审批→应用」已经走通（Run #15 @ a4ac547、#16 @ 83ddff5、#17 @ 736a029）；尚未走通的是「应用后三页桌面导航」（Run #16/#17 在导航点击处失败，PR #23 修复中）以及「回滚、历史恢复」（NOT RUN）。下文逐步骤标注【演示可录】【真实已过 Run #15–#17】【待验收】三种状态。

两种标记贯穿全文：【演示可录】= 现在就能真实录屏；【待验收】= 真实工程尚未通过，录屏时须配旁白说明或改用 DEMO 标注画面。

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
- 证据：应用后 `Footer.tsx` 含「山野器物 · Ripple UI验收」、HEAD 不变的断言在 Run #15–#17 全部真实通过；bolt-workbench-applied-site.png 因后续导航未走通**尚未拍到**。
- 状态：【真实已过 Run #15–#17】——审批成功（候选进入「已批准」）、应用成功（同补丁、基线检查通过）。应用预览接口 Run #15 曾失败（spec.ts:1102，PR #21 修复），Run #16/#17 已能启动。

### 步骤 9 · 查看应用结果
- 界面：应用预览 iframe（1280 桌面视口）逐页导航；工作台状态 chip「applied」。
- 数据：三页 H1 断言（秋日手作节/器物全集/从山野，到日常）+ footer 新文案可见。
- 证据：Run #16/#17 中应用预览已启动且新 footer 文案可见（断言通过）；但桌面导航点击未走通——Run #16 @83ddff5（spec.ts:1122，900 s 超时）、Run #17 @736a029（spec.ts:1131，15 s 超时）。
- 状态：【待验收】——预览启动与 footer 可见【真实已过】，三页导航【真实 FAIL，PR #23 修复中】。

### 步骤 10 · 回滚与版本恢复
- 界面：「回滚候选」（`rollback-candidate`）→ 状态「rolled-back」；「版本历史」行「恢复记录」。
- 数据：Footer.tsx 恢复原文（`山野器物</span>` 且无 "Ripple UI验收"）；原工程 HEAD/status 逐字节不变；历史记录 lifecycle=rolled-back、patchHash 一致。
- 证据：bolt-workbench-history-restored.png（预期）。
- 状态：【待验收 · NOT RUN（真实）】——Run #15–#17 的测试均在步骤 9 导航处退出，回滚与历史恢复断言未执行到。（MEDIA 线在青野真实验收 Run 39536064634 已有同构回滚证明，可作佐证并标注来源。）

## 2. 演示建议（如何在不虚构的前提下讲完整故事）

1. 步骤 1–8 已有真实证据支撑（Run #15–#17 工件）：录屏可直接引用真实运行结果，旁白口径为「真实工程验证已通过验证、审批与应用阶段」。
2. 步骤 9 的导航后半段与步骤 10 真实证据仍缺（PR #23 修复后需下一次 Run 走通），二选一：
   - 用 F 体验工作台演示流走完（审批按钮文案「演示审批（不写入真实工程）」原样出镜， DEMO 角标保留）；
   - 或直接展示 Bolt 工作流页面 + Run #15–#17 的阶段级诊断（验证/审批/应用已过、导航超时失败行），把「最后一公里」作为诚实叙事的一部分（推荐：评委重视工程严谨性）。
3. 任何概念走位画面（C 的 kanva 状态稿）只作分镜参照，投屏时保留其「概念效果示意 · 非浏览器实测截图」标注。

## 3. 复验清单

**已可从 Run #15–#17 工件归档的证据**（bolt-workbench-execution.json、四视口 PNG、resource-snapshots 已在失败 Run 的工件中保存，if:always() 上传）：

- [ ] 下载并归档 Run #15–#17 工件；核对 execution.json 中 SHA-256 与 artifactHash 绑定、七断言全 PASS、四视口 scopeObservations 齐全、blockedExternalResourceUrls=[]。
- [ ] 截取验证 PASSED 面板与四视口截图作为录屏/ PPT 素材（标注来源 Run 编号与 SHA）。

**待下一次 Run（PR #23 合并并走通后）执行**：

- [ ] 确认应用后三页桌面导航通过并拍到 bolt-workbench-applied-site.png。
- [ ] 确认 Rollback 断言：Footer.tsx 恢复原文、原工程 HEAD/status 不变。
- [ ] 确认历史恢复后 bolt-workbench-history-restored.png 齐全。
- [ ] 更新 acceptance-matrix.md 1.9–1.11 与本文步骤 9/10 状态。
- [ ] 更新 acceptance-matrix.md 案例一 1.4–1.10 状态与 CI 链接；同步更新本脚本步骤 6/8/9/10 标记。
- [ ] 录屏补拍真实证据镜头（见 video-storyboard-full.md 镜头 6/9/11）。
