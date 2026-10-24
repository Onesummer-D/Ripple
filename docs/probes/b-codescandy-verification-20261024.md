# codescandy 正式 Candidate Verification（2026-10-24，A 集成核心 2f2e5a7）

> 证据目录：`docs/probes/evidence/codescandy-verification-20261024/`
> （verification-report.json / verification-run.json / candidate-record.json /
> `candidate-76cb63c6….patch` / evidence/ 四视口截图 + execution.json + progress.jsonl）
> CI：B 工作流 run 40096639252（accepted-on-a-core ✅ / thirdparty-reprobe ✅ /
> thirdparty-verification 工具链 ✅，classification=**incomplete**，如实记录不升格）
> 复跑：`scripts/b-candidate-verify.mjs`（Linux+Docker）；绑定根因最小复现：
> `scripts/b-verify-binding-probe.mjs`（无需 Docker）。

## 结论先行

1. **`* → ./src/*` 通配别名阻断已解除**：A 集成 `2f2e5a7`（含 `6f22551` 有界存在性回退）
   下，受限预览**正常启动**，codescandy 真实渲染（四视口全部 `rendered`），
   此前 `core-capability/environment-blocked`（预览启动即拒）不再出现。
   npm 包导入与本地路径回退在预览中均工作（页面完整渲染，无模块解析失败）。
2. **完整链路首次走通**：SourceGraph → PageImpact（source-proven，pageRefs=['page:/pages/profile']）
   → 完整 Scope → 真实 CandidateRecord（patchHash `a737fd2ac362…`，与本地门控字节一致）
   → 正式 Preview（Docker Vite）→ 隔离 Playwright 四视口（1440×900 / 768×1024 / 375×812 / 390×844）
   → 真实截图与 VerificationRun 产出。
3. **本次 Verification 结论 = incomplete（不升格）**：七项断言
   `responsive-layout=pass`，`browser-errors=risk`（48 条 console-error，
   全部为 Google Fonts 被 CSP 拦截——隔离环境未授权外部资源，符合设计），
   其余 5 项（target-change / non-target-preserved / scope-propagation /
   interaction / source-mapping）= **unknown**。
4. **unknown 的精确根因（已定位到行，附最小复现）**：
   - 执行器的基线 DOM 比对**固定跑在根页面 `/`**（`verification-execution.mjs`
     `verifyViewport`：两侧都导航 `/` 后 `snapshotOutsideTargets`），而本候选的
     `pageExpectations` 只覆盖 `page:/pages/profile` → `spec.text` 取空串 →
     返回原因文案 `"Source binding for op-overview-text is not unique."`
     （`verification-execution.mjs:561` 把 `sourceRefs.length!==1` 与 `!spec.text.trim()`
     合并为同一句文案，**空期望被误报成"绑定不唯一"**）。
   - B 侧最小复现证明 `sourceBindings()` 在两侧都返回**唯一**引用
     （`jsx:ProfileHeader.tsx#2522`，经包含元素回退），即绑定本身没有问题：
     问题在"比对页选择 + 原因文案"。→ 提交 A（AC-P4）。
   - 附带图卫生问题：Overview 字面量有 **2 条完全相同的 reads 边**
     （`component#131 → literal#2620`，均 source-proven），AC-P2a 落地引入的
     重复边，应去重（→ AC-P5，未影响本次绑定判定）。
5. **变更已真实生效（旁证）**：scopeObservations 显示 `/pages/profile` 四视口
   `candidateMarkerVisible=true`、marker 精确命中 1 次、baseline 0 次——
   TEXT 补丁在真实浏览器中按预期渲染。
6. **不变性与安全**：cleanup 四项全 true（previewStopped / candidateRemoved /
   networkPoolStopped / tempRootRemoved）；postChecks 四项全 true（源仓库
   摘要 / 工作树列表 / 固定 SHA / clean）；分析基座为无依赖 clone（依赖仅在
   候选创建后以 symlink 加入预览运行时，不进快照）。

## 不变性 / 一致性明细

| 项 | 值 |
| --- | --- |
| A 核心 | `2f2e5a7`（声明=实际，AC-P2a/b 祖先链 f804c7e 在位） |
| codescandy | `b700bbd…c9f0`（固定，前后一致） |
| 分析基座摘要 | `016aee03ac1a…`（LF，与历史门控一致） |
| patchHash | `a737fd2ac3626a1f…`（CI 与本地门控**逐字节一致**） |
| candidateTreeDigest | `ae56e1e2adf7…`（CI 与本地一致） |
| modifiedPaths | `src/sub-components/profile/ProfileHeader.tsx` |

## 交付与后续

- P0 目标"从 ACCEPTED 候选推进至真实浏览器验证"已达成（验证**正式运行**并产出
  证据），但按证据语义结论为 incomplete；**Approval/Apply/Rollback 仍为 NOT RUN**
  （incomplete 的 VerificationRun 不可审批，门控不得放宽）。
- 需要 A 处理：AC-P4（根页比对语义 + 原因文案）、AC-P5（重复 reads 边去重）。
  见 `a-interface-requirements-issue6.md` v3 增补。
- 下一轮（A 修复后）：同固定 SHA 重跑 `b-candidate-verify.mjs`，预期 target-change /
  scope-propagation / source-mapping 转 pass 后，进入 Approval/Apply/Rollback。
