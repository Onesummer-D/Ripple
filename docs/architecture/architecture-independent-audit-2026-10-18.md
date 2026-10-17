# Ripple 独立架构审计报告｜A 主仓库 × B 第二包 × C v0.2 × Bolt/Lovable

**审计日期**：2026-10-18  
**审计性质**：只读。未修改或合并任何业务代码。  
**主仓库快照**：\`main@6340f60683d4241e25bc037009ea839beef6e325\`（GitHub 树查询时 HEAD，文档更新前后请以该基线理解）  
**B 交付**：\`ripple-B-package2-2026-10-14.tar(1).gz\`，SHA256 \`fceb17feb7ee4af3d537e233df74c0a4a874828dc1472a589776cae7f9463956\`  
**C 交付**：\`assets-no-watermark.zip\`，清单 v0.2.0、2026-10-12，SHA256 \`e2639e0da39ca2aefedeb5f827c66b227a6c9a20b2f8cb456a07c7784b443a56\`  
**指导基线**：[产品定位与架构复审 v2](../strategy/Ripple_产品定位与架构复审_v2_2026-10-18.md)｜[审计任务书 v2](../strategy/Codex_架构审计与重构决策任务书_v2_2026-10-18.md)｜[Bolt 研究](../research/competitors/bolt-new/README.md)｜[Lovable 研究](../research/competitors/lovable/README.md)｜[源码复核](../research/competitors/lovable/source-audit-2026-10-16.md)。

> **执行边界**：已静态读取 A 的领域契约/状态机、adapter、renderer/measurement 相关实现与验收文档；B 归档完整解压、阅读关键模块、检查全部案例 JSON 引用的图片是否存在及若干样本图像；C 资源包核对 manifest；通过 GitHub 读 Bolt/Lovable 的业务 UI、页面、共享组件与商品状态代码。**未独立安装 B 依赖、建立其 Git 工作区、执行 B 的 npm fixtures/API 全套或复现 A/B 完整浏览器闭环**，因压缩包不包含 \`.git\` 与 \`node_modules\`，当前环境也未完成 B 原始 Windows/Edge 条件的依赖重建。B 自带通过结果应称“归档的历史测试记录”，不得冒充本次重跑。架构缺陷分“已从静态控制流确定”和“待运行验证”两类。

## 1. 审计总判断

**推荐架构方案 B：保留优秀的独立模块与测试资产，彻底重设 Project-first 领域核心和修改/验证编排。**

理由不是“已有代码不够漂亮”，而是核心的可证明不变量在当前 A/B 组合中不能成立：

1. A UI 的真相源是 \`CaseFixture\`、\`CaseRuntime\` 和 \`draftValues\`；A 的 \`applyDraft\` 更新虚拟槽位快照，**未生成、应用或回传真实用户项目的 Patch**。
2. B 有可检查的 Git worktree 候选流程、Playwright 三视口产物，但 B HTTP 接口接收的是 \`CandidateEdit\` 的映射；**A 用户确认的 ScopeDecision 没有作为独立对象传入 B 的分析/执行过程**，共享或局部模式依赖 case/source/instance 名称推断。
3. B 的 SourceGraph 和候选修改并非可泛化的“任意 React 工程”，而是固定的文件路由结构、content 导出形态、标记约定和已知源 ID；对 Bolt 与 Lovable 的直接适配尚无运行证据。
4. B 候选结果和 A 保存历史中未形成完整的 \`baseline digest ↔ patch hash ↔ render run ↔ visual evidence ↔ applied revision\` 不变量；实际版本漂移、截图过期、Scope 再选择无法被统一验证。
5. TEXT/MEDIA/TOKEN 已有不同处理途径，但还不是同一个可包含多项修改、受用户范围约束、可以复验并正式应用的 Edit Session。

这些问题位于**领域与编排的根部**，仅追加新的 CaseId/Adapter 会继续扩大技术债。应**推翻以 CaseFixture 为业务中心的设计**，但**保留 A 的高质量 UI/交互模块、B 的有价值算法和真实浏览器工作、C 的素材，以及 Bolt 的优秀业务网站 UI**，经过明确接口重塑后复用。若完整迁移评估证明这些模块的耦合成本仍过高，**方案 C（从零重建）同样可选**，没有“代码已写过就必须保留”的限制。

## 2. 实际已有的能力、来源和证据

| 能力 | A 主仓库 | B 第二包 | 本次确认级别 |
|---|---|---|---|
| 画布编辑与 Scope UI | React 编辑器、候选投影、INSTANCE/SHARED 交互、Snapshot、解释卡、媒体资源管理 | 预演管线处理 shared/override | 已存在代码；**A 用户 Scope 到 B 真补丁未贯通** |
| 结构关系 | \`src/cases/fixtures.ts\`／\`truthMatrix.ts\` 的预设图；\`preview/relationship.ts\` 从 reads 边渲染 | ts-morph 抽取模拟站点 \`Route→Component/Slot→Source\` | B 能分析受限真实源码；非通用索引器 |
| 真实预览 | A 自有 iframe、DOM 测量、local Evidence，适用于内建 \`pageDocument\` | Vite 构建、Git worktree、Playwright 截图与 DOM 几何 | 两条独立链路，尚非同一真实候选 |
| 媒体 | A 浏览器 IndexedDB/\`media://\` + C 资产 | B 将文件系统资产拷进 worktree、计算 \`object-fit\` 裁切比例 | 转交协议不完整：浏览器 media URL 不等于 B 文件路径 |
| 浏览器验证 | A 静态/内建页面测量与此前验收 | 375/768/1440 截图、Overflow/ContainerEscape/ProtectedOverlap 等 | B 存在真实截图文件；准确率目前只限既定测试集 |
| 证据 | fixture/real/unknown/loading、内联测量 | 产出 JSON、screens、分类、RUNTIME 实测 | 未见强制绑定源码基线、候选 patch 与截图 |
| 恢复 | A \`restoreSnapshot\` 恢复 \`draftValues\` | B 临时 worktree 删除与分支清理 | **不等于已能恢复外部业务工程** |
| 实际任意项目接入 | \`realCasePackages\` 默认空对象 | API \`/cases/qingye\`、\`/cases/qiguang\`；third-party 尚未开放 | 不具备通用外部项目完整端到端接入 |
| Bolt/Lovable 样本 | 竞品研究文档与源码可读 | B 使用自建简化青野/栖光站 | 可作为下一轮真实适配测试；此轮没有完成 B 实测导入 |

**A 的具体事实**：\`src/adapters/appAdapter.ts\` 明确 \`realCasePackages = {}\`；\`fixtureAdapter\` 从固定 \`fixtures\` 映射；\`src/domain/contracts.ts\` 的 \`CaseId\` 固定为 \`qingye|qiguang|third-party\`，\`ScopeMode\` 只有 \`INSTANCE|SHARED\`；\`state.ts/applyDraft\` 仅改变 \`draftValues\` 并保存虚拟 Snapshot。A 之前 43/43 Vitest、6/6 浏览器测量等本地记录归属于其特定日期/源码版本，不能折算成“已修改外部 GitHub 工程”。

**B 的实际交付包**：976 个归档条目、约 47 MB 压缩体积；包括 \`tools/lib/graph.ts\`、\`pipeline.ts\`、\`preview.ts\`、\`assert.ts\`、\`adapter.ts\`、\`server/index.ts\`、两套站点、样本接口契约及大量图像与 JSON。独立检查 31 份 \`case-*.json\` 引用的 **744 个截图路径全部存在**，样本 PNG 分辨率与 1440×900、375×812 对应，证明归档实际含可检查的渲染产物。这比没有截图的概念 Demo 成熟得多。

**B 的准确率边界**：\`evidence/fixtures-report.json\` **当前只列 F10、F11、F12 三项**（结构 TP5、布局 TP4、均无 FP/FN），而 F01—F12 单独 JSON 均存在。README 的“12/12，Precision/Recall/F1=1.0”属于历史运行陈述和多份分散材料，不是当前这一份汇总 JSON 独立证明的全 12 项重跑。F/M 测试针对刻意设计好的少数站点与标记位置，不能推广为对任意外部工程 100% 准确。

**C 的素材**：v0.2.0 第二批包，29 张 PNG + 2 个 SVG Logo，青野/栖光用途与版本说明；第三方素材仍为空。视觉资产可直接保留使用，但 ZIP 不包含完整网页代码或真实浏览器验证；包内“可公开展示”是团队声明，发布前仍应复核真实素材生成来源、外部引用和许可。栖光的 16:9→4:5 图是很好的**MEDIA 测试数据**，不再承担第二条独立产品故事。

## 3. 确定性缺陷：按严重性排列

### P0｜A 的“应用”与真实项目源代码脱钩

\`src/domain/state.ts:applyDraft\` 对 \`fixture.slots\` 更新 \`nextValues\` 并生成 Snapshot；\`restoreSnapshot\` 仅恢复内存值，不含项目版本/补丁/提交引用。与 B 暂存 worktree 版本没有统一交易边界。**从当前代码无法证明正式应用的是经过浏览器验证的同一份补丁。**

### P0｜A ScopeDecision 在 B 候选 HTTP API 丢失

B \`server/index.ts\` 从 POST 读取 \`candidateEdit\`，再由 \`fromACandidate\` 推断 scope；没有要求单独传 \`ScopeDecision\`、受保护集合或 approved revision。

更具体地：
- \`tools/lib/adapter.ts\` 收到 \`sourceId=qingye-shared-title\` 就直接生成 \`{kind:'source', scope:'shared'}\`，即使候选还带首页 \`instanceId\`。A 的 INSTANCE 决策无法原样可靠反映。
- 栖光媒体依靠请求中是否带 \`instanceId\` 反推 \`override\`；A 正常的 Candidate 对象通常有 \`instanceId\`，故“是否传字段”与“用户确认全站/局部”的语义不同。
- \`qgRouteOf\`、\`QG_INSTANCE\`、\`SOURCE_ID_MAP\`、\`SLOT_LABELS\` 都是特定项目的适配表，适合作为临时桥，不适合作为未来唯一修改语义。

**需要一个经过用户确认的 EditSession/ScopeDecision 含 included、excluded、ruleVersion，作为生成补丁的唯一范围输入**，而非通过 ID 后缀猜测。

### P0｜B 的多项简单修改会丢失前项

\`tools/lib/pipeline.ts:draftFor(edits)\` 在循环里始终 \`draft = one\`，函数只返回**最后一项注入规则**。所以多个本来都能走草稿通道的 TEXT 编辑，不会作为一个完整候选全部注入；现有两项及以上的测试 F09/F12 因包含 CSS 自动走 worktree，**并未覆盖“两个可注入 TEXT”这个反例**。这是从控制流直接确定的问题，正式重构要加入组合候选回归测试。

### P0｜候选 Patch、证据与版本指纹缺乏完整一致性

B \`runCase\` 临时建立 worktree、修改、构建、截图后删除 worktree 和分支，只留零散案例 JSON/截图，未持久保存可应用的 patch manifest 与 target commit；\`CaseResult\` 没有 base commit/tree digest、patch hash、浏览器 build fingerprint 和审批准入绑定。

\`writeRefEvidence\` 每次写同一 \`evidence/E-REF-001.json\`，后运行覆盖前一份；风险 \`E-VIEW-001\` 等在不同 case 中可重复。对“哪个版本的哪个截图证明哪份候选”而言，当前只能依据文件名和人类推测部分关联，**无法形成强一致性的可审计证据链**。

A 在 \`applyDraft\` 里会筛选候选 ID/新值/Scope 等 context，但 B 的 \`toAEvidence\` 使用 \`producer:'B-analysis'\`，A 的类型把 producer 限定为 \`A-preview\`；A 的 \`parseEvidence\` 实际会丢掉 B 传来的 context/measurement/producer 等扩展信息，仍不能把二者认作端到端已兼容。

### P1｜B 源码图只覆盖刻意配合的代码组织

\`tools/lib/graph.ts\` 从 \`src/App.tsx\` 的直接 \`<Route path element>\` 建路由，追踪从 \`src/content/*\` 导入的命名对象，关注特定 JSX \`title/src\` 属性及 \`data-ripple-slot\`，Token 来源消费依赖页面内或组件的一定 JSX 形态。

一个值得修的具体 bug：token 遍历时 \`seenEl = new Set<number>()\` 只用 JSX 的字符起始偏移作去重键，没有组合源文件路径；不同文件恰好相同 offset 的节点会误判为重复候选。另有 \`chains[0]\` 只取本次 JSX 中第一条绑定链、\`findUsages\` 只直接搜路由页面组件，未证明跨层组件依赖、高阶组件、样式编译、文件式路由等复杂情况。

因而“可抓任意真实 React 项目”的表述目前超出实现范围。Bolt 项目是 App state 切页，Lovable 项目是 TanStack 文件路由，**恰好都是不应继续要求外部工程迁就当前 <Route> 扫描器的样本**。

### P1｜字符串补丁和源码位置解析有风险

\`pipeline.ts:applyOneEdit\` 通过 \`src.replace(find, replace)\` 修改第一个匹配文本，不基于 AST/symbol node 生成结构化 patch；对于相同字面量多处出现、引号/换行/反斜杠转义、被引用但不应修改的历史文本、嵌套作用域或合并候选，容易产生不一致或编译失败。

\`override\` 的路径映射和表达式模板还是青野特例；\`source\` 分支固定编辑 \`src/content/campaign.ts\`。第三方工程导入后不能依赖这些定位惯例。MEDIA 分支的路径规范已有第二包修复记录，仍需全面做跨平台与安全检查。

### P1｜并发、用户权限与外部源码执行隔离尚不足

B HTTP 服务把作业置为 running 后立即异步执行，未形成真正的串行/容量受控队列；所有作业使用固定 baseline/候选端口 5199/5299、共享浏览器和磁盘目录，若多个请求同时到达可能发生端口冲突、混用预览或工作区清理冲突。服务监听 127.0.0.1 是好的边界，但没有用户会话鉴权、大小限制与任务配额。MEDIA 解析允许绝对本地路径；CSS 编辑允许请求指定路径；未来接入不可信 ZIP/仓库时必须考虑路径归一、可访问目录白名单、安装脚本权限、敏感环境变量与任意代码执行隔离。

### P1｜验证统计与归档生成不具备稳定复现契约

- \`tools/acceptance-api.ts\` 在 \`try ... finally\` 的 finally 里 \`process.exit(...)\`，其后的归档写入代码不可达，不能依赖它自动生成最终 \`docs/acceptance/...json\`。
- \`fixtures-qiguang.ts\` 的 M03 是读取 M01 浏览器测量并复算裁切公式，因此**没有单独 \`case-M03.json\` 不自动意味着测试缺失**；但应独立落盘 M03 断言与输入证据。
- \`B/evidence/screens\` 共有 744 PNG，但只有 113 个不同文件哈希，大量基线/未改变页面重复存储。可以在缓存与证据 manifest 中去重并保留引用，这不是指责截图造假。
- 图缓存使用 git HEAD + 源文件 \`size:mtime\` 指纹，不是内容 SHA；适合演示，不足以作为证据强版本指纹。
- \`renderSite\` 固定浏览器 Edge，并用 \`waitUntil:'networkidle'\` 与 slot 标记；尚未覆盖动画稳定、IntersectionObserver 滚动、真实 API 状态、登录、异常加载等。布局规则识别的是标记槽位中的几何，而不是全站任意可见元素。
- 媒体裁切输出比例可复核但不等于审美、文字可读性或业务正确性；CSS token 的 WCAG 对比度和计算样式来源也尚未成为完整模块。

## 4. Bolt/Lovable/C 的整合与资产迁移建议

| 资产 | 处理决策 | 理由 / 注意 |
|---|---|---|
| **Bolt 四页生活方式站点 UI** | **作为青野正式业务站视觉基线候选，优先直接复用布局、排版、Hero、商品卡、响应式、动效** | 用户已明确偏好其美术品质；真实源码在 \`Onesummer-D/ripple-qingye-bolt\`，不需要为了 Ripple 再做一套简陋商店 UI。要检查外部 Pexels 等图片和字体许可。当前仓库快照不代表 Bolt UI 上所有历史 V2–V6 状态。 |
| Lovable \`ProductCard\`、\`ShopProvider\`、独立路由、meta 与 Vitest 用例 | **参考/按需要吸收成熟模式**，优先复用可读性/购物数据与局部覆盖思想，不强行照搬 TanStack 路由 | 在该实验中商品专题页 \`productsPageBadges.p1\` 的覆盖与四页品牌更名已通过源码审计；真实工程可作为第二种框架适配样本。 |
| B \`graph.ts\` | 保留为已验证的**受限 TS/JS 源关系提取器原型**，重做多框架前端、源码 provenance 和统一身份协议 | 不能继续以 \`src/content/*\`、\`<Route>\`、\`data-ripple-slot\` 作为外部项目的硬门槛。 |
| B \`preview.ts\` + \`assert.ts\` | **高价值复用**：三视口渲染、截图、DOM 几何、裁切公式、基础规则测试 | 接入独立运行管理、动态状态与证据版本/测试运行 ID，区分正常变化与确认异常。 |
| B \`pipeline.ts\` Worktree 思路 | 复用执行顺序与部分工具函数，**重写 PatchOrchestrator/隔离工作区/正式应用与冲突处理** | 现有仅支持案例特例与临时分支，缺候选正式应用一致性及并发隔离。 |
| B \`adapter.ts\` 与 API | **作为迁移桥保留、目标状态淘汰 CaseId/命名硬映射** | 明确传用户 ScopeDecision，不以 sourceId/instanceId 是否存在来猜修改范围。 |
| B 两个自建站点 | 青野 B 技术站保留为回归/负例测试，不作为用户最终站点；栖光站保留必要 MEDIA 测试夹具后归档 | 不必保留两条平行商业演示故事。 |
| B 的 evidence 截图和测试报告 | **全部保留历史档案**、添 manifest、独立验证；后续产物用内容寻址去重 | 不能将未带 Commit 的旧截图库在新版本上展示为已通过。 |
| C 青野 16 PNG + Logo | 与 Bolt UI 逐页审美整合、素材用途与合法性验收 | C 包共 29 PNG + 2 SVG；只有真实素材，非完整可运行网页。 |
| C 栖光 13 PNG + Logo | MEDIA 正负例、旧版/新版、不同容器的测试输入，不需独立宣传案例 | 适当迁移后清理原页面故事；不丢失高价值图像测量场景。 |
| 第三方候选开源站 | 使用冻结的源码提交及许可证重新核验，**从零自动分析而非预置图** | B \`docs/third-party-audit.md\` 为静态可行性审计；未安装依赖、未运行第三方网站，不可称已适配成功。 |
| A \`CandidateEditor\`、\`PagePreview\`、\`RelationshipMap\`、Evidence/ExplanationPanel、媒体库与测量 | **保留可用视觉与交互逻辑，剥离固定 CaseFixture 数据流** | 这些模块具有 UI/纯派生计算价值，但需要绑定真正 Project/EditSession 与真实 DOM，不能继续制造仅内存“已应用”。 |
| A \`src/cases/fixtures.ts\`、\`truthMatrix.ts\` | **从产品领域移出**，转到 tests/fixtures/expected，作为验收输入；不再定义用户项目对象 | 避免用户实际工程不在三种 CaseId 之内时无法进入产品。 |
| A \`CaseRuntime\`、虚拟 Snapshot 生命周期 | **淘汰为业务真相源，重建领域状态** | 使用真实 Patch、基线和 Evidence 创建 AppliedRevision，历史可真正恢复源码。 |

**UI 原则**：青野业务网站与 Ripple 编辑工作台是两件独立产品界面。Bolt 的优秀商店 UI 可直接复用；Ripple 工作台学习 Bolt/Lovable/Onlook 的优秀交互组织，但围绕真实网页上的修改决策独立设计。

## 5. To-be 领域契约与系统边界

核心系统中心不是 CaseId，而是下面这些类型及其不可违反的不变量：

- \`Project\`：真实源码入口（本地/Git/ZIP）、运行环境、授权、adapter 能力和类型。
- \`ProjectRevision\`：commit/tree digest 或内容哈希、依赖锁与工作环境指纹；基线不可隐式漂移。
- \`SourceGraph\`：Source/Component/RenderedInstance/Route/Media/Token/RuntimeState 等节点；边包含类型、静态/运行时来源、置信区分与缺口；节点可定位源码和 DOM。
- \`EditSession\`：原话、点选对象与交互状态、历史决策、状态机（read-only→analyzed→scoped→candidate→verified→approved→applied/aborted）。
- \`ScopeDecision\`：included、excluded、protected、语义候选、批准人/批准版本、规则生命周期；**不可通过 ID 字符串反推用户意图**。
- \`CandidatePatch\`：baseRevision、patchHash、工作树/可应用 diff、影响节点集、候选编译标识；scope 改变生成新 Candidate。
- \`VerificationRun\` / \`Evidence\`：candidateId、代码指纹、实际页面、视口、浏览器状态、时间、图片与 DOM/样式来源、断言及 \`pass/risk/unknown/not-run/stale\`；不可只保留文字“verified”。
- \`AppliedRevision\`：确认的同一 patch、应用到目标工程的结果版本、冲突/回滚指针及证据。
- \`OverrideRule\`：实例范围、优先级、来源用户决定、最近验证版本、过期/冲突/回收策略。

技术划分：
\`connectors\`（Git/local/ZIP）→ \`project-runner\`（隔离启动与安全）→ \`source-index\` + \`dom-runtime-mapper\` → \`intent-scope\` → \`candidate-orchestrator\` → \`verification\` → \`revision-store\` → \`workbench\`。**这是逻辑边界，不等于必须拆 8 个独立服务。**

推荐用事件/状态机处理执行权限和版本一致性，而不是让一个自然语言 Prompt 单独承担“不许提前写文件”的约束。快速 DOM 注入可用于即时近似，完整工作树运行用于最终可信候选；多个候选字段必须能组合，确认后应用的是生成了证据的同一补丁。

## 6. 三套架构方案比较（A/B/C 为重构方案，不是团队成员）

| 方案 | 能保留的东西 | 主要工程负担 | 长期发展 | 本报告判断 |
|---|---|---|---|---|
| **A：保留现有 CaseFixture/CaseRuntime，增 Adapter** | 旧测试和 UI 迁移最快，B API 可做专用桥 | 每个外部项目都要映射到三个 CaseId、特定源名、旧 Snapshot；范围与真实 patch 双真相源，例外不断扩张 | 差；难支持外部多项目/多轮修改 | **不推荐**；根部抽象与目标冲突 |
| **B：保留独立模块，重建核心领域与编排** | A 高质量 UI/解释/测量、B browser/geometry/AST 实验、C 资源、Bolt 网站 UI | 重建真实 Project/Scope/Patch/Evidence 的契约和 API，迁移测试，修 B 的固定逻辑 | 较好；数据流统一且复用真正成熟的代码 | **推荐**；性能与维护更可控 |
| **C：从真实 Project-first 重新实施全套代码** | 可借设计和测试资产，原实现保留只作参照 | 大量已通过的 UI、浏览器测量和视觉素材接入重做，初期回归成本最高 | 理论可行；并不自然比 B 更优 | **保留为可执行备选**：若实测证明 B 的迁移代价超过重写，直接采用 |

架构评分应在 B 可独立安装、A/B 最小契约集成试验后复核，而不是按文件数或既有工作量决断。**目前最有依据的是“核心重建、算法与组件复用”的 B**。该选择并不意味着保留旧领域模型；旧的 CaseFixture 驱动和虚拟 Snapshot 应主动退出产品核心。

## 7. 真实验收实验与不可跳过的负例

### 7.1 先用同一个真实外部源码项目证明核心闭环

以用户认可的 Bolt React/Vite 商店作为青野候选业务站（不是 B 自造技术小站）。按照固定 commit、锁文件与用户确认的改动目标：

1. 导入仓库/本地工程，启动真实预览；记录首次打开耗时、权限、依赖与失败。
2. 不依赖 \`data-ripple-*\` 特殊标记，实际解析共享组件、页面与数据引用，允许按元素定位源码并标不确定关系。
3. 用户自然语言请求“更新本季活动，保留历史与商品购买”；明确给出要改和要保留的对象，不擅自修改英文、历史与独立商品。
4. 比较局部/共享/自定义 Scope，改变 Scope 后上一候选证据进入 stale 状态；允许 TEXT、MEDIA、TOKEN 在同一个会话中组合而不丢修改项。
5. 在隔离环境生成真实 patch；浏览器检查首页、活动页、专题和品牌故事，必要时跑移动菜单、购物状态及媒体/样式；所有证据包含候选哈希、视口、页面与运行状态。
6. 用户批准后应用同一补丁到项目分支或输出可应用 diff；验证应用版本与已验证候选等价。
7. 连续 5—10 次修改共享商品和多页角标，验证覆盖规则是否冲突、积累冗余、可清理及能准确回滚。

### 7.2 异构适配与未知状态

- Lovable TanStack Start：文件路由、共享 Header/Footer/brandMeta、\`productsPageBadges\` 与购物状态；不强行假装普通 JSX Route 扫描器能直接支持。
- 冻结许可证的开源项目：Tailwind v4 / CSS \`var\`、\`@theme\`、dark/light、多个相同 Token 消费者、局部覆盖，实际 Node build/Playwright/ComputedStyle 证据。
- React+API 的动态状态：明确 mock/real 的边界、是否登录、接口加载/失败、重试与后端隔离；不能把静态截图直接当交易流程验收。
- 回归异常：正常折叠菜单、Reveal/IntersectionObserver 动画与素材裁切不误报；确实重叠、溢出、可点击性丢失时报告，并能点击定位来源。

## 8. 公平用户研究与成本测量

三组：常规 Agent；Agent 自带 Plan/Diff/Preview；Ripple+同等 Agent。测试用户在开始前私下写“必须改变/必须保护/可接受替代”，评审者持有这份 Ground Truth，三组 AI 均不预先获得；三组可正常提问澄清。

测：首次完整任务通过率、字段/页面位置通过率、误改漏改、完成总时间（包含导入与等待）、纠错轮次、模型 Token/费用、浏览器/构建时间、用户操作/切工具成本、风险误报、旧证据识别能力、覆盖规则在连续任务中的维护成本。若 Ripple 为复杂任务减少返工，却在简单任务拖慢，也须同时呈现。24—36 人可作初步样本规划，但样本功效和统计显著性需要设计后计算，不能凭空承诺。

## 9. 下一轮执行门槛与材料状态

本轮**只读审计已完成**，但**独立运行复验尚未完成**，两种完成度严格区分。正式决定删除/迁移哪些业务代码前，应取得三项真实结果：

1. **B 第二包的可复现实跑**：在独立 Git/Node/Edge 环境安装锁定依赖并执行 \`npm run extract\`、\`npm run fixtures\`、媒体 M01—M04、\`npm run acceptance:api\`。修正/解释归档汇总问题和 API 验收文件写入问题；完整记录运行环境、测试失败、输出 hash。
2. **A→B 边界原型**：按新的 explicit \`ScopeDecision\` + \`CandidatePatch\` + \`Evidence\` 协议跑一条真实文本改动，从真实图谱结果进入 UI，再由 UI 选择局部/共享，由 B 生成实际候选，并检验图片与源码版本一致；不可用 \`realCasePackages\` 填固定 JSON 代替。
3. **Bolt/Lovable/开源三种外部结构的兼容审计**：对真正不同的路由、组件、动态数据与样式来源进行静态+浏览器交叉验证，记录未知关系和适配成本。确认 C 素材可复用、Bolt UI 能保持视觉品质，避免拿 B 的简陋测试页替代正式网站。

**当前无需立即分派团队重构任务**；审计结论先交用户确认。待确认推荐架构后，才制定具体设计文档、删除/迁移清单、对照测试与团队实施接口。不能直接把未提交主仓库的 B 包合并 main。

## 10. 总结

本次新证据表明：B 的开发并非“缺少真正实现”，其源码分析、隔离运行、浏览器截图和 MEDIA 裁切测量都有实质成果，历史归档的图像与案例结果也能交叉检查。但 A 的用户界面与 B 的候选执行尚未建立完整契约，原有 CaseFixture/Scope/内存 Snapshot 不足以成为现实产品长期维护的业务核心。

**正式建议：推倒以 Fixture/Case 为中心的业务领域，保留并重构能独立验证的源分析、浏览器验证、UI 和视觉资产；围绕真实 Project/EditSession/CandidatePatch/Evidence/Revision 重建一条完整、可以重复维护的修改流程。** 如果后续对新契约的实验说明原代码迁移更贵、更难保证正确性，就直接选择方案 C 从头实现该层。不为了旧代码牺牲产品，也不为了“重构”本身放弃已经优秀的实现。