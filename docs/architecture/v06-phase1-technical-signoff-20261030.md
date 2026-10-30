# Ripple v0.6 Phase 1 技术会签记录

日期：2026-10-30（Asia/Shanghai）

状态：Phase 1 架构会签通过；C Phase 1 生产实现尚未放行，等待 C 提交精确实施计划和独立分支。

## 1. 正式生产基线

| 对象 | 精确引用 | 用途 |
|---|---|---|
| v0.6 生产 Base | `feat/a-v06-base-20261028 @ 5b75fe699afce98638e6fd6ad110911d83389dc8` | C、F 的统一 Draft PR Base |
| Base Tree | `ede999bd2eb1507ac03b55762c94d489b93d9965` | 基线冻结核对 |
| Phase 0 evidence | PR #68 `a0c5c5349003deb8f8a8e479086b1e7389ec4c80`, Tree `9726c2844774ea403d02df898b49c5b14faca51f` | 仅用于 AC-P6 证据复核，禁止并入生产 |
| A Phase 0 记录 | `8081110baccafa6596bd98b6b760b81b61d3c325` | 独立验收记录 |
| F/UI RC2 | PR #67 `d67fba6b8677c0e0755364138e79a69012119873` | 以 v0.6 Base 为父提交的 Demo-only 线 |

Phase 0 evidence 分支、B 证据分支和历史 PR #61 不作为新的生产祖先。Runtime Identity v1.2 合同、原因枚举、Candidate/Scope/Verification/Approval/Apply/Rollback 语义继续冻结。

## 2. C Phase 1 最小首批

C 只能提交一个静态 SourceGraph 首批，目标是补齐可由源码确定性证明的关系；无法证明的记录保持 `semantic-candidate`、`unknown` 或 `unresolved`。

### 允许修改

- `src/core/model.ts`：仅增加或细化 SourceGraph/CSS Token 字段；不得改 Runtime Identity 类型、原因枚举或 VerificationRun 授权字段。
- `src/core/project.ts`：静态 CSS/JSX/路由来源解析及确定性 SourceGraph 建模。
- `src/core/project-data-routes.ts`：静态路由身份和页面来源关联。
- `src/core/css-token-source.ts`：声明、`var()`、selector、byteOffset、mediaContext 的确定性解析。
- 以上模块的定向单元测试、SourceGraph 证据样例、接口文档。
- 仅在必要时增补直接 PostCSS 依赖；锁文件必须从 v0.6 Base 增量生成，不得覆盖安全锁文件。

### 禁止修改

- `src/core/runtime-identity*`、`verification-runner* `、Candidate、Scope、Approval、Apply、Rollback 核心。
- D 浏览器 collector、DOM/computed-style/theme/media/cascade 采集。
- `VerificationRun.tokenConsumerObservations` 的生产接线。
- F/UI 真实授权交互、Real Adapter、E③ 配对算法。
- B v5 matcher/probe、阈值或验收脚本。
- Runtime Identity v1.2 合同正文和原因枚举。

### C Phase 1 验收条件

1. 38 条 Phase 0 uncovered 行逐行保持原始 row identity、`taxonomyVersion`、`mappingVersion`、`mappingRuleId` 和 canonical 分类；新证据必须可追溯到 Phase 0 精确输入 SHA。
2. AC6.4 147 条 consumer pairs 与 16 条 UNKNOWN 的独立锚点逐字段保留；动态 className、复杂 selector、缺失边继续 UNKNOWN。
3. source-use graphNodeIds 缺失时不得推断补齐。
4. CSS 候选关系不得升级为 DOM、cascade、computed-style、theme/media 激活证明。
5. SourceGraph 结果不得增加 Scope、Candidate、Verification、Approval、Apply 或 Rollback 权限。
6. 定向 Vitest、Typecheck、Build、`git diff --check` 通过；B 使用冻结 v5 验收器对 C 精确 HEAD 独立复跑。
7. 输出精确 HEAD、Tree、变更文件白名单、机器 JSON、人读报告、Manifest/SHA-256 和失败负例。

### 拒绝条件

- 直接把 evidence 分支或旧 PR #61 整体合入；
- 复制或覆盖完整 `model.ts` / `package-lock.json`；
- 为了消除 UNKNOWN 修改 B 阈值；
- 将 semantic-candidate、静态 className 或相同 token 名称当作 source-proven；
- 修改授权门控或在 C 阶段接入浏览器观察；
- 缺少精确输入 SHA、逐行映射或可重放负例。

C 的具体实施计划尚未收到；上述范围是开工合同，不等同于生产代码验收。

## 3. 跨 Agent 接口与顺序

| 阶段 | Owner | 输入 | 允许输出 | 解锁条件 |
|---|---|---|---|---|
| C Phase 1 | C | v0.6 Base `5b75fe699…`、Phase 0 canonical evidence | 静态 SourceGraph 增量和证据 | A 审查 + B v5 精确 SHA 复跑 |
| B 复核 | B | C 新精确 HEAD | v5 机器报告和 PASS/PENDING/ERROR | 不改 matcher/probe/阈值 |
| D 运行时观测 | D | C 已验收 HEAD、冻结 observation/v1 合同 | 独立浏览器观测工件 | C Phase 1 ACCEPT 后才解锁 |
| A 宿主接线 | A | D 已验收工件和协议 | 服务端验证、持久化和 API 投影 | 不改变七项断言和授权门控 |
| E 兼容审查 | E | A/D 接口变更 | Runtime Identity v1.2 兼容性意见 | 不扩展冻结原因枚举 |
| F/UI | F/UI | v0.6 Base、Demo contract | 只读 Demo 展示和体验测试 | 不消费未验收的正式 SourceGraph/观测证明 |

D 在 C Phase 1 ACCEPT 前保持 HOLD。A 不提前接入浏览器观察到正式 VerificationRun。F/UI 可并行维护 Demo，但不能借 Demo 数据生成真实 SourceGraph、Candidate 或授权证明。

## 4. UI 共享来源裁定

### 接受：`campaign.hero.title`

- 仅适用于 Demo Adapter 的 `demo-content/v1`。
- Home 是 Demo fixture owner。
- Products、Seasonal 可展示共享 TEXT 投影；Contact 保持 UNKNOWN、不可编辑。
- `provenance=demo`、Demo `sourceKey` 和 Demo selector 不能解释为 Real `sourceRef`、Runtime Identity 或授权凭据。
- Scope 选择只能控制 Demo 投影，不增加真实来源证明。

### 不合并：`data:promo-banner`

UI 设计中的 `data:promo-banner` 不得与 `campaign.hero.title` 建立同源关系。PR #67 当前合同中的 `campaign.seasonal.banner` / `data:seasonal-banner` 是独立的 partial Demo 场景；它应保持独立 sourceKey、partial/unknown 原因和审批阻断。若 UI 继续使用 `data:promo-banner` 命名，必须作为新的独立 Demo slot，不得复用共享标题关系。

UI Agent 负责素材、文案和设计说明；F 负责 Demo 页面、Adapter、投影和测试。两边不得重复修改同一内容合同文件。

## 5. PR 与集成顺序

1. C 从 `feat/a-v06-base-20261028@5b75fe699…` 建立独立 Draft 分支，提交计划和静态首批。
2. C 精确 HEAD 通过定向审查与 B v5 复跑后，才允许 D 从 C 已验收分支建立工作线。
3. D 独立验收后，A 再决定是否接入宿主观察协议。
4. F/UI PR #67 保持独立；其 Demo-only 变化不等待 C/D，也不能提前消费正式证据。
5. 任何联合预演都必须使用新的准确 HEAD 重新运行 Typecheck、Build、Vitest、Docker/Chromium 和生命周期回归。

当前不允许合并 PR #68、#67、#61 或任何未完成的 C/D Draft，不更新公共开发分支，不部署，不触发 Bolt。

## 6. 下一次独立工程审查

C 提交后必须提供：

- 精确 Base/HEAD/Tree、merge-base 和文件白名单；
- 38 行映射与 16 UNKNOWN 的输入/输出 SHA；
- SourceGraph 节点、边、unresolved 统计；
- B v5 原始 JSON、退出码和证据 Manifest；
- 静态候选与授权隔离负例；
- Typecheck、Build、定向 Vitest、Linux CI；
- 未完成能力和拒绝原因。

本记录只冻结接口和顺序，不批准 C Phase 1 生产实现，不修改生产代码或授权门控。
