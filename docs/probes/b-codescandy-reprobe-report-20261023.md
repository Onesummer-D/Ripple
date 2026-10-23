# Issue #6 第三方复验报告：codescandy @ A 最新集成基线（2026-10-23）

## 基线与固定点

| 项 | 值 |
| --- | --- |
| Ripple 基线 | `origin/feat/a-cd-rehearsal-20261023` @ `1485439`（含 PR #28 @ `1dbaa53` 合并 + A 预演修订） |
| B 复验分支 | `feat/b-thirdparty-reprobe-20261023`（独立新分支，未合并历史 B 分支） |
| 第三方固定 SHA | `b700bbd55b31a62fe04d4cd8210fc37232f0c9f0`（所有脚本启动时强制校验） |
| 检出位置（本机） | `…/Ripple涟漪/_scratch/codescandy-dashui`（LF 归一化工作树，HEAD 不变） |
| 性质 | Draft；未合并 A/main；未触发 Bolt 真实验收 |

## 任务一结论：复跑对比

复跑入口（均可在 CI/本机重跑）：

```bash
npm run acceptance:codescandy -- <codescandy 检出路径> [输出 JSON]
node --experimental-transform-types --loader ./scripts/ts-extension-loader.mjs scripts/b-thirdparty-reprobe-stats.mjs <检出路径>
```

实测（完整数据 `docs/probes/b-codescandy-reprobe-2026-10-23.json`、`b-codescandy-reprobe-stats-20261023.json`）：

- 图 4957 节点 / 5384 边 / **37 route**（旧 4924/5006/**0**）
- 媒体 100 资产节点；**asset-consumer 边 178（source-proven 61 / semantic-candidate 117）——source-proven 61 与旧基线 61 完全同口径持平**（v1 报告误将 reads 边计入，已修正）；节点口径：任意边即消费 100，**source-proven 消费 61**；另有指向媒体节点的 `reads` 边 100 条 source-proven（JSX src 属性，不计入 asset-consumer 指标）
- 媒体页面影响：0 source-proven / 60 partial / 40 unknown（旧版 100/100 unknown）
- TEXT 2283 data 节点 / 3593 条 source-proven reads 边
- token 0；悬空 source-proven 边 0；unresolved 3（theme.scss、条件路由回退、route-coverage）
- 探针 verdict：**exit=2 BLOCKED**（候选门控未满足，报告完整）
- C+D 专项探针结论在本基线复现一致。

**Profile → ProfileHeader → Overview 来源链核实**：三段链路（route→Profile→ProfileHeader→
字面量）全部 source-proven，`pageRefs = [page:/pages/profile]`；但目标 impact 为
**partial**，两条 unresolved 正是 PR #28 遗留：
composite `<Link>` JSX 子代 DOM 传播未证明（`ProfileHeader.tsx` L71-73）与
errorElement/条件回退未建模（`App.tsx` L53）。

**判定**：route 数量增加是真实能力增益，但整个第三方项目接入**不成功**——
TEXT 候选被 fail-closed 拒绝（实测见任务二）。

## 任务二结论：按序验证，第一个真实阻断点

| 顺序 | 项 | 结果 |
| --- | --- | --- |
| 1 | 能力识别与来源证明 | PASS（带 4 项如实限制） |
| 2 | 受限预演启动显示真实网站 | PARTIAL EVIDENCE（沙箱预演依赖候选+Docker；旁证：真实 Chromium 双路由 200 零报错，证据 `docs/probes/evidence/codescandy-real-site/`，服务器已停止） |
| 3 | DOM→源码定位 | NOT RUN（依赖沙箱预演） |
| 4 | 简单 TEXT 候选创建 | **BLOCKED = 第一个真实阻断点**：`createCandidate` 实测抛 CandidateError，拒绝信息完整引用 composite-jsx-child 与 data-router 覆盖缺口 |
| 5 | 四视口验证 | NOT RUN |
| 6 | Approval/Apply/Rollback | NOT RUN |

修复从第一处失败开始：两个根因均为 A/C+D 公共问题，B 已提交最小反例与接口需求
（AC-P2a / AC-P2b，见 `a-interface-requirements-issue6.md` v2），未改 A 公共核心、
未放宽任何门控。

## 任务三结论：SCSS × CSS Token

codescandy 品牌色为 SCSS 变量（`$primary: #624bff !default`，30 个 `.scss`）；
Ripple token 仅支持 `.css` 的 CSS 自定义属性与 tailwind/theme `colors` 色板。
**SCSS 变量≠CSS Token**。分别报告：

1. **codescandy TEXT 通用接入：可行**——阻断与样式体系无关，待 AC-P2a/AC-P2b 修复后可推进。
2. **增加 SCSS 支持：不值得**——编译期变量需新解析器+编译执行器，成本高收益低；保持 UNSUPPORTED。
3. **品牌色替换案例：需要另选**采用 CSS 自定义属性的真实 React/Vite 工程；
   codescandy 不得充当 Token 案例。

## 复跑脚本与 CI

- `scripts/b-thirdparty-reprobe-stats.mjs` — 媒体/TEXT/路由/token 统计探针（媒体口径 = asset-consumer 边）
- `scripts/b-thirdparty-candidate-gate.mjs` — 候选门控合同测试（v4）：传入检出**严格只读**，
  全部候选操作在脚本自有固定 SHA clone（mkdtemp）上运行；严格断言 CandidateError + 当前预期拒绝原因 +
  无残留工件/工作树检查；`--selftest` 注入无关错误负例防假绿，且负例断言平台稳定
  （inside-project 位置拒绝为确定性核心 CandidateError；caller-repo 外部路径提案由 harness 前置
  拒绝 `unsafe-proposal`，**不调用核心**、目录零创建，与核心合同错误明确区分）；`--expect accepted` 供 AC-P2a/AC-P2b 修复后切换，
  成功路径会核对补丁字节/patchHash/marker/候选精确编辑字节后才清理
- `scripts/b-candidate-accepted-fixture.mjs` — **候选成功正例**：脚本自有最小 data-router 工程
  （Component 路由、无 errorElement、无 scss）上执行真实 createCandidate，验证补丁字节、patchHash、
  marker、候选工作树精确编辑字节与树摘要，finally 清理且零 worktree/工件残留；绿色拒绝 CI 不代表编辑成功，
  本正例补齐成功合同证据
- `scripts/b-env1-eol-repro.mjs` — B-ENV-1 固定复现（CRLF/LF 双态字节与偏移记录）
- `scripts/b-debug-wt-digest.mjs` — worktree 字节一致性诊断工具
- `scripts/b-debug-media-edges.mjs` — 媒体消费边诊断（按边 kind × certainty 分组，核对 asset-consumer 口径）
- `.github/workflows/agent-b-thirdparty-reprobe.yml` — B 独立 CI：拉取固定 SHA 检出 →
  统计探针 + 门控实证 + 正例夹具 + 探针工件上传（含 candidate-gate.json 与
  candidate-accepted-fixture.json；不触发 Bolt）

## 红线确认

未合并 A/main；未触发昂贵 Bolt 验收；未把 semantic-candidate 标 source-proven；
未放宽 SourceGraph/Scope/沙箱；未修改 A 公共核心。
