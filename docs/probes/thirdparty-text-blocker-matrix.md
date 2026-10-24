# 第三方 TEXT 全生命周期阻断矩阵（Issue #6 / codescandy）— v3

- 日期：2026-10-24（v3，正式 Verification 版）
- v2 日期：2026-10-23（复验版，基线 A `feat/a-cd-rehearsal-20261023` @ `1485439`）
- v3 基线：A 最终集成候选 `feat/a-final-integration-20261023` @ `2f2e5a7`
  （含 AC-P2a/b 修复 + codescandy 通配别名存在性回退 `6f22551`）
- 第三方固定 SHA：`b700bbd55b31a62fe04d4cd8210fc37232f0c9f0`（dash-ui-react-vitejs-typescript，多次实测一致）
- 状态取值：PASS / RISK / UNKNOWN / UNSUPPORTED / NOT RUN / BLOCKED / INCOMPLETE
- 原则：第一项失败不级联——未运行的环节标记 NOT RUN/BLOCKED 并写明前置依赖；
  route 数量增加不等于项目接入成功；Verification incomplete/risk 不得升格为 PASS。

## v3 更新（正式 Verification 已运行，结论 incomplete）

- **AC-P2a/b 修复已验证落地**：`--expect accepted` 在 A 核心 2f2e5a7 上 pass=true，
  真实 CandidateRecord 创建成功（patchHash `a737fd2ac362…`，CI 与本地逐字节一致）。
- **`* → ./src/*` 通配别名阻断解除**：受限预览正常启动，四视口真实渲染。
- 正式 Verification 全链路走通并产出证据，但按证据语义 **classification=incomplete**：
  5/7 断言 unknown（根页比对 + 误报文案，AC-P4）+ 1 risk（Google Fonts 被 CSP 拦截）。
  证据：`docs/probes/evidence/codescandy-verification-20261024/` +
  报告 `b-codescandy-verification-20261024.md`。Approval/Apply/Rollback 保持 NOT RUN。

## v2 历史基线对比（SourceGraph，静态分析，未执行目标代码）

| 指标 | v1 旧基线（10-21，PR #9） | v2 新基线（10-23，含 PR #28 data-router 能力） |
| --- | --- | --- |
| 图节点 | 4924 | 4957（+33） |
| 图边 | 5006 | 5384（+378） |
| route 节点 | **0** | **37** |
| 媒体资产节点 | 100 | 100 |
| 媒体 asset-consumer 边（source-proven） | 61 | 61（同口径持平；另有 semantic-candidate 117，合计 178） |
| 媒体被消费覆盖（节点数） | — | 任意边即消费 100；**source-proven asset-consumer 消费 61**（两者不得混用） |
| 媒体页面影响 | 100/100 unknown | 0 source-proven / 60 partial / 40 unknown；`reads` 类边 100 条 source-proven（JSX src 属性，不计入 asset-consumer 指标） |
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
| 1 | 项目能力识别与来源证明 | UNSUPPORTED | **PASS（带限制）** | 37 route、媒体 asset-consumer 61 source-proven（与旧基线同口径持平）、Overview 目标页面影响定位到 `page:/pages/profile`；限制 4 项如实保留：composite-jsx-child（semantic-candidate）、errorElement 条件回退未建模、route-coverage 未决、theme.scss 导入未解析 |
| 2 | 受限预演启动并显示真实网站 | NOT RUN | **PARTIAL EVIDENCE** | Ripple 沙箱预演需要 Candidate（被 #4 门控拒绝）+ Docker 容器（本机无 Docker，仅 CI 可验）。旁证：codescandy 自有工具链 `npm run build` 成功（4632 模块），真实 Chromium 下 `/` 与 `/pages/profile` 均 200、零 page error、「Overview」可见——见 `docs/probes/evidence/codescandy-real-site/`。该旁证不等于 Ripple 受限沙箱已支持 |
| 3 | DOM→源码可靠定位 | NOT RUN | **NOT RUN** | 依赖 #2 Ripple 沙箱预演；源码侧唯一性已具备（图内目标唯一 + 源码双定位） |
| 4 | 一次简单 TEXT 候选创建 | BLOCKED | **PASS（v3，A 核心 2f2e5a7）** | AC-P2a/b 修复后 `--expect accepted` pass=true；CandidateRecord + patchHash `a737fd2ac362…` + marker + 精确编辑字节 + 树摘要全部核对通过；postChecks 全 true |
| 5 | 四视口验证与证据 | NOT RUN | **INCOMPLETE（如实记录）** | 正式 Verification 全链路运行（预览启动、四视口 rendered、截图+VerificationRun 产出、marker 在 /pages/profile 四视口精确命中）；7 断言 = 1 pass / 1 risk / 5 unknown；unknown 根因 = 基线比对固定根页 + 文案误报（AC-P4），risk = Google Fonts 被 CSP 拦截（48 条 console-error）。证据 `evidence/codescandy-verification-20261024/` |
| 6 | Approval / Apply / Rollback | NOT RUN | **NOT RUN** | incomplete 的 VerificationRun 不可审批；待 A 修复 AC-P4 后重跑至 pass 再推进，**不放宽门控** |

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

- **Windows 换行符与候选字节一致性门控（B-ENV-1，已有固定复现）**：机制已确定并稳定复现——
  codescandy 的 git blob 全为 LF；autocrlf=true 检出的 CRLF 工作树被 git 报为"干净"，
  Ripple 干净检查放行后按 CRLF 计算快照摘要；而候选 worktree 以 `-c core.autocrlf=false`
  建立（LF 字节），两侧摘要必然不一致 → 候选创建被拒（`mismatchDemonstrated: true`）。
  全记录见 `b-env1-eol-repro-20261023.md/.json`（core.autocrlf、blob、磁盘字节、
  图偏移 #2620↔#2691、候选偏移、双方摘要）。**不建议**把摘要改为归一化文本计算——
  ProjectRevision/CandidatePatch/补丁范围/工作树完整性必须尊重真实字节；
  检出策略或源码版本合同由 A 判断。证据与工件需记录 EOL 状态。
- 本机无 Docker：Ripple 容器预演链只能经 CI 验证；`_scratch` 旁证仅证明第三方工程本身可构建可渲染。

## 推进条件（v3 更新）

1. ~~AC-P2a/AC-P2b~~ ✅ 已由 A 交付并验证（2f2e5a7，#4 转 PASS）。
2. 下一轮前置：A 处理 **AC-P4**（基线比对页选择 + 原因文案拆分）与 **AC-P5**
   （重复 reads 边去重），见 `a-interface-requirements-issue6.md` v3；保持 fail-closed。
3. A 修复后同固定 SHA 重跑 `scripts/b-candidate-verify.mjs`（CI thirdparty-verification
   job 已钉 2f2e5a7），classification 转 passed 后才可推进 #6（Approval/Apply/Rollback）。
4. incomplete/risk 期间，任何"接入成功"表述都视为过早结论。

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
