# codescandy 后续 Verification 复验清单（BLOCKED → 等待 A 修复）

> 前置状态：A 集成核心 `2f2e5a7` 上，codescandy @ `b700bbd…c9f0` 的正式
> Verification 已完整运行（四视口 rendered、截图、VerificationRun 产出、
> marker 精确命中），classification=**incomplete**（如实记录，未升格）。
> 本清单规定 A 处理 AC-P4/AC-P5 后，B 用**同一固定 SHA** 复验时必须逐项
> 核对的内容。红线：七项断言全部满足正式门控前，不尝试审批成功、不预设
> PASS、不放宽任何门控。

## 复验基线（不可漂移）

| 项 | 固定值 |
| --- | --- |
| 第三方 SHA | `b700bbd55b31a62fe04d4cd8210fc37232f0c9f0` |
| 候选操作 | `op-overview-text`（ProfileHeader Overview 字面量） |
| 受影响页 | `page:/pages/profile`（唯一） |
| 复验入口 | `scripts/b-candidate-verify.mjs --core-sha <A新SHA>`（Linux+Docker） |
| 证据目录 | `docs/probes/evidence/codescandy-verification-<日期>/` |

## 逐项核对清单

### A. AC-P4 修复效果（当前 5 项 unknown 的主因）

- [ ] **比对页语义**：基线 DOM 比对不再固定根页 `/`；对受影响页
  `/pages/profile` 进行 `snapshotOutsideTargets`，或在没有 `/` 期望时
  显式跳过并给出 `page-expectation-missing:<pageRef>` 原因。
- [ ] **原因文案拆分**：`sourceRefs.length!==1` 与 `!spec.text.trim()`
  分别报告（不再合并为 "Source binding ... is not unique"）。
- [ ] **回归正例**：页面级 Scope 候选（影响页非根页）的七项断言中
  target-change / non-target-preserved / scope-propagation /
  source-mapping 至少由 unknown → pass/fail 的**确定性判定**
  （fail 也是有效结论，如实记录）。
- [ ] B 复现脚本验证：`scripts/b-verify-binding-probe.mjs` 在 A 新核心上
  重跑，确认绑定两侧唯一性结论不变（防止修复改变绑定语义）。

### B. AC-P5 图卫生

- [ ] Overview 字面量重复 reads 边去重（`duplicateIdenticalEdges`
  返回 0）。
- [ ] 去重不改变绑定判定：`sourceBindings` 仍返回
  `jsx:src/sub-components/profile/ProfileHeader.tsx#2522`。

### C. 其余 unknown 项（不预设随 AC-P4 自动修复）

- [ ] **interaction=unknown**：验证合同需含真实交互（点击/悬停），
  本轮候选若无可交互断言则记录为"不适用+原因"，不得默认通过。
- [ ] **browser-errors=risk**：48 条 console-error 全部为 Google Fonts
  被 CSP 拦截。**按正式授权或本地化方案解决，不直接忽略**：
  优先方案为预览 CSP 放行/fonts 本地化（自托管字体或 vite 插件内联），
  解决后该项应达 pass；若 A 选择"隔离环境默认拦截外部资源"的设计不变，
  则需提供门控认可的正式豁免路径并在 VerificationRun 中标注豁免依据。
- [ ] **responsive-layout**：已 pass，复验确认不回退。
- [ ] **target-change / non-target-preserved / scope-propagation /
  source-mapping**：逐项给出 pass/fail 与机器可判证据（不得再 unknown）。

### D. 不变性与安全（每次复验必查）

- [ ] cleanup 四项全 true；postChecks 四项全 true；固定 SHA 前后一致。
- [ ] patchHash 与本地门控字节一致；CI 与本地一致。
- [ ] 分析/候选/验证三阶段工程解析基座一致（依赖状态固定）。

## 升级条件

仅在七项断言全部给出确定性判定（全部 pass，或个别 fail 且有定位与
A 确认）**且** browser-errors 按上述正式路径解决后，B 才将本项从
incomplete 升级，并继续 Approval → Apply → Rollback 生命周期（仍不放宽
审批门控）。此前状态维持 BLOCKED/NOT RUN 语义。
