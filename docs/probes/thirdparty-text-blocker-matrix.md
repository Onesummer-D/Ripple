# 第三方 TEXT 全生命周期阻断矩阵（Issue #6 / codescandy）— v2

- 日期：2026-10-23（v2，复验版）
- v1 日期：2026-10-21（基线：Ripple PR #9 分支）
- v2 基线：Ripple `feat/b-thirdparty-reprobe-20261023`（基于 A 稳定集成基线 `feat/a-cd-rehearsal-20261023` @ `1485439`）
- 第三方固定 SHA：`b700bbd55b31a62fe04d4cd8210fc37232f0c9f0`（dash-ui-react-vitejs-typescript，两次实测一致）
- 状态取值：PASS / RISK / UNKNOWN / UNSUPPORTED / NOT RUN / BLOCKED
- 原则：第一项失败不级联——未运行的环节标记 NOT RUN/BLOCKED 并写明前置依赖；
  route 数量增加不等于项目接入成功。

## 新旧基线实测对比（SourceGraph，静态分析，未执行目标代码）

| 指标 | v1 旧基线（10-21，PR #9） | v2 新基线（10-23，含 PR #28 data-router 能力） |
| --- | --- | --- |
| 图节点 | 4924 | 4957（+33） |
| 图边 | 5006 | 5384（+378） |
| route 节点 | **0** | **37** |
| 媒体资产节点 | 100 | 100 |
| 媒体 source-proven 消费证明 | 61 | **161** |
| 媒体页面影响 | 100/100 unknown | 目标页 `/pages/profile` 已可 source-proven 定位 |
| TEXT data 节点 | 2283 | 2283 |
| TEXT source-proven reads 边 | —（页面影响全 unknown） | 3593 |
| token 节点 | 0 | 0（SCSS 体系，见任务三） |
| unresolved | 2（Dropdowns 不可解析组件、theme.scss） | 3（theme.scss、条件路由回退消费者、route-coverage） |
| 悬空 source-proven 边 | — | 0 |

来源：`docs/probes/b-codescandy-reprobe-2026-10-23.json`、`b-codescandy-reprobe-stats-20261023.json`；
复跑入口 `npm run acceptance:codescandy -- <检出路径>` + `scripts/b-thirdparty-reprobe-stats.mjs`。

**结论先行**：PR #28 的 data-router 能力真实有效（37 路由、`/pages/profile` source-proven、
Profile → ProfileHeader → Overview 三段链路全部 source-proven），但 **codescandy TEXT
通用接入仍 BLOCKED**——候选门控实测拒绝（exit=2 / CandidateError），不得因 route 增加判为成功。

## v2 阻断矩阵

| # | 环节 | v1 状态 | v2 状态 | 依据 / 前置依赖 |
| --- | --- | --- | --- | --- |
| 1 | 项目能力识别与来源证明 | UNSUPPORTED | **PASS（带限制）** | 37 route、161 媒体证明、Overview 目标页面影响定位到 `page:/pages/profile`；限制 4 项如实保留：composite-jsx-child（semantic-candidate）、errorElement 条件回退未建模、route-coverage 未决、theme.scss 导入未解析 |
| 2 | 受限预演启动并显示真实网站 | NOT RUN | **PARTIAL EVIDENCE** | Ripple 沙箱预演需要 Candidate（被 #4 门控拒绝）+ Docker 容器（本机无 Docker，仅 CI 可验）。旁证：codescandy 自有工具链 `npm run build` 成功（4632 模块），真实 Chromium 下 `/` 与 `/pages/profile` 均 200、零 page error、「Overview」可见——见 `docs/probes/evidence/codescandy-real-site/`。该旁证不等于 Ripple 受限沙箱已支持 |
| 3 | DOM→源码可靠定位 | NOT RUN | **NOT RUN** | 依赖 #2 Ripple 沙箱预演；源码侧唯一性已具备（图内目标唯一 + 源码双定位） |
| 4 | 一次简单 TEXT 候选创建 | BLOCKED | **BLOCKED（实测复现）** | `scripts/b-thirdparty-candidate-gate.mjs` 实测 `createCandidate` 抛 CandidateError：`无法证明目标的完整页面影响：composite-jsx-child…；工程存在尚未证明的 data-router 消费者…`。fail-closed 行为正确，**不得放宽** |
| 5 | 四视口验证与证据 | NOT RUN | **NOT RUN** | 依赖 #2/#3/#4 |
| 6 | Approval / Apply / Rollback | NOT RUN | **NOT RUN** | 依赖 #3–#5 |

## 第一个真实阻断点（v2）

**#4 TEXT 候选创建被 fail-closed 拒绝**，根因是 #1 中两个 A/C+D 公共来源证明问题：

1. **composite `<Link>` JSX 子代 DOM 传播未证明**（PR #28 遗留）。
   现场：`ProfileHeader.tsx` L71-73 `<Link className="nav-link active" to="#">Overview</Link>`。
   字面量 `literal:…ProfileHeader.tsx#2620`（LF 检出；CRLF 检出偏移为 #2691）经
   `component:…ProfileHeader.tsx#131` 的 `reads` 边确定性为 **semantic-candidate**——
   静态分析无法证明 react-router `Link` 会把子代传到 host DOM。运行时实际可见（截图），
   但图证明不允许把语义候选当 source-proven。
2. **data-router 回退/条件消费者未建模**（PR #28 遗留）。
   现场：`App.tsx` L53 根路由 `errorElement: <NotFound />`；unresolved 记录
   `data-router src/App.tsx#2358: conditional route fallback consumer is not modeled`
   与 `route-coverage`。→ `sourceProvenPageImpact` 无法确认页面影响全集，工程级 unresolved
   使任何候选被拒。

下游 #5/#6 未运行，如实标记，不级联。

## 环境观察项（登记，未自行修改 A 核心）

- **Windows 换行符与候选字节一致性门控**：CRLF 检出的首次 `createCandidate` 曾在
  worktree 字节一致性检查被拒（`拒绝对错位源码范围应用补丁`）；LF 归一化后诊断脚本
  确认 503 个受跟踪文件两侧 digest 完全一致（`016aee03…`），门控不再触发。
  另注意：**同一源码目标的图内偏移随 EOL 变化**（Overview 字面量 #2691 ↔ #2620），
  证据与工件需记录 EOL 状态。若 A 需要，B 可提供 Windows CRLF 下的最小复现（登记号 B-ENV-1）。
- 本机无 Docker：Ripple 容器预演链只能经 CI 验证；`_scratch` 旁证仅证明第三方工程本身可构建可渲染。

## 推进条件（进入下一阶段前必须满足）

1. A/C+D 处理 AC-P2a（composite JSX 子代传播证明）与 AC-P2b（errorElement/条件回退建模），
   见 `docs/probes/a-interface-requirements-issue6.md` v2；保持 fail-closed，不放宽门控。
2. 修复后固定三方 SHA 重跑：`acceptance:codescandy` + `b-thirdparty-reprobe-stats.mjs` +
   `b-thirdparty-candidate-gate.mjs` 三件全绿（gate 脚本以"拒绝"为预期通过条件）才可推进 #3。
3. #4 转 PASS 前，任何"接入成功"表述都视为过早结论。

## 任务三结论（SCSS × CSS Token）

- codescandy 品牌色是 SCSS 变量（`src/styles/theme/_variables.scss` `$primary: #624bff !default`），
  30 个 `.scss` 文件；Ripple 的 token 节点只覆盖 **`.css` 文件的 CSS 自定义属性**
  （`--x: v` 定义 + `var(--x)` 消费）与 tailwind/theme 配置中的 `colors` 色板。
  **SCSS 变量≠CSS Token，不得冒充**；codescandy 图内 token 节点 0。
- **TEXT 通用接入可行性**：可行且与 SCSS 无关——阻断只来自上述两个来源证明问题；
  修复后 codescandy 可作为 TEXT 通用接入案例。
- **是否值得增加 SCSS 支持**：**不值得**（现有工作量下）。SCSS 变量是编译期概念，
  支持它需要 SCSS 变量图（import/!default 覆盖链）+ 编译步骤进入预览/Apply 执行器，
  成本高而比赛收益低；保持 UNSUPPORTED。
- **品牌色替换比赛案例**：**需要**另一套采用 CSS 自定义属性的真实 React/Vite 工程。
  Ripple 已有该能力的单测合同（`project.test.ts` 中 `--brand-accent` 用例），
  但缺真实工程案例；建议另选工程，不把 codescandy 当 Token 案例使用。
