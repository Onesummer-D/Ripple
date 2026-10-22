# 青野主案例操作脚本（TEXT · 秋日灵感季）

> 日期：2026-10-22。目标：为比赛演示与复验提供一条可执行的 10 步路线，每一步注明所用真实界面、所需数据与验证证据。
> 演示目标工程：青野文创真实 React/Vite 工程 `Onesummer-D/ripple-qingye-bolt @ f7e4998a`（私有，4 页面：/ home、/autumn 秋日手作节、/products 器物全集、/story 品牌故事；共享 Footer 品牌文字「山野器物」位于 `src/components/Footer.tsx`）。

## 0. 执行环境说明（必须先读）

存在两条执行轨道，演示与验收不能混用：

- **轨道 A · 演示轨道**：A 的 Project-first 工作台（`npm run dev` 后 http://localhost:4173 ，`project-path` 指向青野工程克隆）或 F 的体验工作台演示入口（`experience.html`，演示数据全程 DEMO/SIMULATED 标注）。本机 Windows 可运行工作台 UI 与本地 Fixture；**Docker 隔离预演与四视口真实验证在本机不可用**（无 Linux Docker）。
- **轨道 B · 真实验收轨道**：GitHub Actions「Bolt real-project acceptance」（workflow_dispatch，固定 `BOLT_REPO_REF=f7e4998a`）。截至 2026-10-22，Runs #1–#17 全部失败，Run #18 未触发。凡依赖真实验证通过的步骤，在 Run #18（或其后首个通过运行）之前一律标记 **待验收**。

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
- 状态：【演示可录】。真实 Bolt 点选环节随 Run 失败未走完 → 待验收。

### 步骤 3 · 查看源码位置与影响页面
- 界面：选中摘要（源码路径、行号）；关系涟漪图沿 reads 边展开 Source 与消费实例；范围行显示 4 个页面的关系与确定性（source-proven / partial / unknown 三色胶囊，F 体验层文案统一）。
- 数据：SourceGraph 消费关系；`sourceProvenPageImpact`。
- 证据：结构 Evidence ID（Fixture 层为 E-REF-QINGYE-001；真实层待 B Evidence Pack 替换占位符）。
- 状态：【演示可录】（Fixture/演示层）。真实关系图待验收。

### 步骤 4 · 生成文字修改候选
- 界面：意图输入（`intent-input`，例："Update the shared footer brand on every page…"）+ 目标文案输入（`after-input`，例："山野器物 · Ripple UI验收"）+「添加操作」→「生成候选」（`create-real-candidate`）。
- 数据：EditSession v1；隔离 Git worktree 中的真实源码 diff；patchHash、candidateTreeDigest。
- 证据：候选 diff 视图含新文案；候选 ID 与哈希网格。
- 状态：【演示可录】（合成/工作台层）。真实工程候选生成随 Run 失败 → 待验收。

### 步骤 5 · 对照桌面、平板与两个手机视口
- 界面：工作台预演 iframe 视口切换 1440 / 768 / 375（+390）；F 体验层画布工具条（390 标注「验证中」）。
- 数据：四视口计划 1440×900、768×1024、375×812、390×844（VerificationRunner 固定计划；工作台本地页为 375/768/1440 真实布局 + Fixture 390）。
- 证据：各视口截图（Fixture 证据 `docs/acceptance/2026-10-15/evidence/page-preview-*.png` 为本地页面 QA）。
- 状态：【演示可录】（本地页）。真实四视口运行待验收。

### 步骤 6 · 查看受影响页面及验证证据
- 界面：「验证候选」（`verify-candidate`）→ 验证状态与七项断言（target-change / scope-propagation / non-target-preserved / interaction / responsive-layout / source-mapping / browser-errors）；Evidence 详情可打开原生记录、下载 JSON；「这次预演说明了什么」逐条引用 Evidence ID。
- 数据：VerificationRun execution.json（runId、candidateId、patchHash、scopeVersion、四视口 scopeObservations、资源快照 SHA-256、blockedExternalResourceUrls=[]）。
- 证据：真实运行需完整 Receipt（bolt-workbench-execution.json + 四视口 PNG，SHA-256 与 artifactHash 绑定）；Run #10 缺 mobile-390、Run #11 pids 超限、Run #13 终止 RISKS、Run #14–#17 失败。
- 状态：【待验收 · 关键】——没有一次真实运行产出完整 PASSED Receipt；这是主案例目前最大的缺口。

### 步骤 7 · 确认修改范围
- 界面：范围决策（4 页 include/exclude，ScopeDecision）；来源卡「只改当前实例 / 同步同源实例」快捷切换；审批门控（F 层）：存在未决定页面或包含 unknown/partial 页面 → 拒绝。
- 数据：ScopeDecision v1 与候选绑定；scopeVersion。
- 证据：范围汇总与门控拒绝文案（单测/e2e 覆盖）。
- 状态：【演示可录】。真实范围随 Run 失败 → 待验收。

### 步骤 8 · 审批及应用
- 界面：「批准候选」（`approve-candidate`，仅 PASSED 可点）→「应用候选」（`apply-candidate`）；应用预览（PR #15/#21）：以候选身份启动已应用版本预览，桌面导航三个页面验证 footer 标记保持可见。
- 数据：同一份 CandidatePatch 应用；应用前基线检查；应用后 Footer.tsx 含新文案、HEAD 不变。
- 证据：bolt-workbench-applied-site.png（预期）；历史 API。
- 状态：【待验收】——真实 Approval→Apply 闭环 NOT RUN（无完整 Receipt，门控正确拒绝）。

### 步骤 9 · 查看应用结果
- 界面：应用预览 iframe（1280 桌面视口）逐页导航；工作台状态 chip「applied」。
- 数据：三页 H1 断言（秋日手作节/器物全集/从山野，到日常）+ footer 新文案可见。
- 状态：【待验收】（合成层已有 e2e；真实层未运行）。

### 步骤 10 · 回滚与版本恢复
- 界面：「回滚候选」（`rollback-candidate`）→ 状态「rolled-back」；「版本历史」行「恢复记录」。
- 数据：Footer.tsx 恢复原文（`山野器物</span>` 且无 "Ripple UI验收"）；原工程 HEAD/status 逐字节不变；历史记录 lifecycle=rolled-back、patchHash 一致。
- 证据：bolt-workbench-history-restored.png（预期）。
- 状态：【待验收】（MEDIA 线在青野真实验收 Run 39536064634 已有同构回滚证明；TEXT 线真实未运行）。

## 2. 演示建议（如何在不虚构的前提下讲完整故事）

1. 步骤 1–5、7 用工作台真实界面录【演示可录】部分；凡数据来自 Fixture/演示适配器，画面角落保留 DEMO/FIXTURE 标识（F 工作台顶栏常驻 DEMO chip）。
2. 步骤 6、8–10 真实证据缺失时，二选一：
   - 用 F 体验工作台演示流走完（审批按钮文案「演示审批（不写入真实工程）」原样出镜）；
   - 或直接展示 Bolt acceptance 工作流页面 + 失败 Run 的诊断（failed-to-run.json / progress.jsonl），把「尚未通过」作为诚实叙事的一部分（推荐：比赛评委重视工程严谨性）。
3. 任何概念走位画面（C 的 kanva 状态稿）只作分镜参照，投屏时保留其「概念效果示意 · 非浏览器实测截图」标注。

## 3. 复验清单（Run #18 通过后立即执行）

- [ ] 下载 Run #18 工件：bolt-workbench-execution.json、四视口 PNG、resource-snapshots、progress.jsonl；核对 SHA-256 与 artifactHash 绑定。
- [ ] 确认七项断言全 PASS、四视口 scopeObservations 齐全（4 页 × 4 视口）、blockedExternalResourceUrls=[]。
- [ ] 确认 Approval→Apply 同补丁、应用后逐页导航、Rollback、历史恢复截图齐全。
- [ ] 更新 acceptance-matrix.md 案例一 1.4–1.10 状态与 CI 链接；同步更新本脚本步骤 6/8/9/10 标记。
- [ ] 录屏补拍真实证据镜头（见 video-storyboard-full.md 镜头 6/9/11）。
