# RFC：Ripple Project-first 领域架构与迁移路线

**日期：2026-10-18** · **状态：独立分支的核心契约试验，未经端到端集成验收**  
来源：[产品与架构复审 v2](../strategy/Ripple_产品定位与架构复审_v2_2026-10-18.md) · [独立架构审计](./architecture-independent-audit-2026-10-18.md)。

## 已做出的技术决策

**采用审计方案 B：推翻以固定 CaseFixture 为产品业务中心的架构，保留可复用的 A 页面能力、B 真实浏览器/源码分析工具、C 素材与 Bolt 高质量网站 UI；围绕真实 Project / EditSession / Patch / Evidence 重设领域和编排。**

这里的 B 是架构方案而非 B 队员。若后续迁移实验证明被保留模块妨碍设计或重写成本更低，允许选择全量重建。对旧实现既不盲目保留，也不因“更先进”而盲目丢弃。

## 已落地的独立契约验证

分支下新增：
- `src/core/model.ts`：ProjectRevision、SourceGraph、ScopeDecision、CandidatePatch、VerificationRun/Evidence、AppliedRevision、EditSession，完全不包含 `qingye/qiguang/third-party` 这样的案例 ID。
- `src/core/session.ts`：纯函数状态机，限制读源码→用户确定 Scope→候选 Patch→实际证据→批准→同一 Patch 应用。
- `src/core/session.test.ts`：9 项 Vitest 状态机测试，覆盖多项编辑、历史保护、越权目标、候选/环境不一致、截图产物、未知风险、Scope 更改旧证据失效、应用同一树、源码分析刷新。

上述三文件经过独立 `tsc --strict` 检查，同等状态转移的 9 项 Node 断言已在临时工作目录执行通过。**本次没有运行仓库自身的 Vitest / Playwright 全套测试；没有将新领域核心接入 A 的 UI，也没有证明 B 工程的真实 Patch 可直接应用。**

## 核心不变量

1. 保存原始用户意图 `rawIntent`；“完善提示词”只能增强工作方式，不得擅自增加/修改业务目标。只读/写权限应该由执行编排控制。
2. `ProjectRevision.sourceDigest` 是实际内容指纹，不能只写分支名。图谱、候选与测试运行必须以它为基线；`runtimeFingerprint` 记录依赖、运行环境、模拟/真实 API 条件。
3. 修改范围显式包含 `includedRefs`、`excludedRefs`、`protectedRefs`，明确批准者、版本；被保护节点不能被补丁触及。运行时 **不能**继续通过 `sourceId` 命名或 `instanceId` 字段有无猜用户 Scope。
4. 同一个 `CandidatePatch` 可包含多条 TEXT/MEDIA/TOKEN/CODE 修改。B 原有 `draftFor` 的多项修改覆盖问题要作为迁移回归。
5. 真正可审批的候选必须产生隔离工程树摘要与补丁哈希；DOM 注入是**快速近似预演**，不能直接充当正式可应用补丁的验证。
6. `VerificationRun` 要绑定候选、补丁、基线、环境、页面、视口、交互状态与证据产物；风险/失败/未测不能自动视为通过。改变 Scope 生成新候选，保留旧运行记录但标记 `stale`。
7. 用户批准后，落入原工程的应当是**同一份已验证 Patch**。真实执行器必须检查当前原工程未漂移、校验最终 tree hash、原子执行、写版本或可恢复归档。此 TS 状态机只能拒绝不匹配声明，不能代替文件系统的独立哈希和原子事务。
8. 正式应用完成后，后续修改创建新 EditSession；源头共享/实例级覆盖规则应作为可管理、可回收的领域对象，不能无限向组件散布额外 `export const` 或 `if`。

## 产品系统边界，不强制微服务

```
用户入口：本地文件 / GitHub / ZIP / Agent 导出项目
  ↓ ProjectConnector（权限、隔离、环境）
ProjectRevision + ProjectRunner（编译和真实网页状态）
  ↓
SourceIndexer + RuntimeMapper（AST、媒体、CSS、DOM、来源证据）
  ↓
EditSession（Raw Intent、共享/语义关系、ScopeDecision）
  ↓
CandidateExecutor（接受显式 Scope，原子组合操作，输出 patch/tree hash）
  ↓
VerificationRunner（Playwright，多设备、动画与真实交互状态）
  ↓
Approval + RevisionStore（应用同一补丁、冲突检测、回溯）
  ↕
可视化工作台（现有 A UI，经 adapter 改造）
```

系统所有层用稳定 ProjectID、sourceDigest、CandidateID、patchHash、runID 关联。只有来源真实且与当前候选一致的证据才能标绿；未知必须展示。不能让 UI、B API 和 Fixture 分别维护一套自己的“改了哪里”。

## 新旧迁移矩阵

| 旧来源 | 保留什么 | 必须改变什么 |
|---|---|---|
| A `domain/contracts.ts` / `state.ts` | 纯函数、状态可测试思路 | CaseRuntime/draftValues 虚拟“已应用”退出产品真相源 |
| A `PagePreview` / `RelationshipMap` / `EvidencePanel` / MEDIA 库 | 可视化效果、响应状态与浏览器测量 | 从固定 Slots/CaseId 转为真实 ElementRef/Project/Session |
| A `fixtures.ts` / `truthMatrix.ts` | 回归负例和预期结果 | 迁入 tests/fixtures，不能代表任意外部项目 |
| B `graph.ts` | ts-morph 源码追踪原型 | 不再要求外部代码写 `<Route>`、`src/content/*`、`data-ripple-*` |
| B `pipeline.ts` | Git worktree、真实构建与候选策略 | 重写显式 Scope、多个编辑的原子补丁和版本持久化 |
| B `preview.ts` / `assert.ts` | 截图、几何风险、裁切与场景测试 | 版本指纹、API/动画状态、正常变化与未验证区分 |
| B case→A case 命名映射 | 旧系统过渡数据 | 不允许进入最终公开的通用 Project API |
| C 图像资源、栖光新旧海报 | 青野综合站点素材和通用 MEDIA 测试 | 栖光不再作为独立产品故事 |
| Bolt UI / Lovable 结构测试 | Bolt 商店 UI 作为青野优先视觉基线；Lovable 角标/购物/文件路由借鉴 | 不能为了迎合旧 Fixture 把优质业务站变为简陋页面 |

## 真实集成下一目标：Bolt 站点，而不是另一个假案例

在固定的 Bolt Git Commit 上：真正加载站点 → AST+运行时关系找共享导航/宣传文案/商品 → 用户明确保留历史和购物 → 支持当前页/共享/自定义 Scope → 生成真实候选（TEXT + MEDIA/TOKEN）→ Playwright 运行真实网页三视口及必要购物状态 → 证据带对应 Patch 和 Commit → 应用/撤销真实工程改动。

验收需覆盖**连续 5—10 次局部覆盖修改**、源文件改动与缓存失效、不同路由、状态回归、候选变更旧证据 stale、外部源码没标记时 honest unknown。对 Lovable TanStack Start 与冻结许可的开源工程再作异构压力测试。

## 实施优先次序（不是删减完整产品范围）

- 一条受信任的 ProjectRunner / Worktree / Patch hash API 及其测试；**先让工程中存在可追溯真实候选**。
- Bolt 工程 SourceIndexer：真实文件/路由/消费者/DOM 身份及证据，承接 A 的涟漪。
- A 工作台的新领域 API 接入与用户 Scope 控制，证据状态连通。
- 验证/应用/回溯和覆盖规则管理，与已有 UI 交叉验收。
- C 媒体、样式 Token、多状态交互、多工程适配和用户收益评估持续补足。

**分支可做契约和回归试验，但不得将单元测试通过宣称为真实站点已修改。当前主分支应用功能和 B 包均不应因这套契约的存在自动认定完成。**
