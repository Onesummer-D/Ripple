# 参赛材料内容初稿

> 日期：2026-10-22。依据：工作区《Ripple涟漪_项目方案.pdf》（全国数媒竞赛产品方案，报名截止 2026-10-23 23:59）、README、DEV_HANDOFF 与 docs/delivery 各清单。
> 纪律：只写真实技术信息与已核实状态；创新点与价值不空泛宣传；未验收能力按「待验收/不支持」表述。本稿不编造参赛赛道要求与获奖标准，赛事口径以官方通知与方案 PDF 为准。

## 1. 作品概述

涟漪（Ripple）是一套面向真实 React/Vite 网页工程的 AI 辅助编辑预演与验证工作台。用户在网页上修改文字、图片或样式之前，系统先把隐藏的关联关系与真实渲染变化转化为可视的「涟漪」，再让用户决定「只改这里」还是「同步关联处」，最后以可信证据完成验证、应用与回滚。

- Slogan（方案 PDF 口径）：**改动上线前，先看见波及。**（传播口径另有「尚未落笔，先见涟漪。」，两处使用时保持一致。）
- 首期载体：已授权接入的 React/Vite 网站；真实验证工程为青野文创（私有仓，固定 commit f7e4998a）。
- 项目与全部验收记录公开：<https://github.com/Onesummer-D/Ripple>。

## 2. 项目背景

- 已有数字作品的日常修改（改一条宣传语、换一张海报、调一个品牌色）通常由不懂代码的运营人员承担；共享组件、共享内容源、CSS 继承与响应式布局使「改一处、动三页」成为常态风险。
- 通用 AI 编程工具直接改代码，但不回答「这次修改会影响哪些页面、会造成哪些视觉变化」；改动后果依赖事后人工排查。
- 网站恰好是最适合把「涟漪」演出来的数字作品：共享组件、共享内容源、CSS 继承、多页面、响应式布局同时存在，且浏览器能真实渲染候选修改。Playwright 支持指定视口、移动设备模拟、截图比较与 DOM 快照，可把「手机端按钮被挤出去」这类后果变成可验证证据，而不是让 AI 猜。
- 关键技术判断：**共用组件不等于内容一定联动**。只有静态来源分析（AST）与运行时渲染证据结合，才能区分「看起来共用」与「真实共享同一内容源」。

## 3. 用户需求

核心用户（方案 PDF 口径）：

1. **接手已有网站的运营人员**：不懂 React，需要安全完成日常活动更新（如只改首页标题而不波及活动落地页）。
2. **建站服务商**：把网站交付给客户维护，需要让客户自助修改且有回滚保障。

用户任务：在真实网页上点选要改的内容 → 看到影响范围与四视口变化 → 决定修改范围 → 用可信证据确认无误 → 应用或回滚。

## 4. 核心功能（按真实实现状态标注）

| 功能 | 状态 | 说明 |
| --- | --- | --- |
| 真实工程导入与 AST 结构分析（SourceGraph：imports vs 实际 reads/TOKEN/MEDIA 消费区分） | 【已验证·合成】 | Linux CI 全绿；真实工程分析前置步骤在 Bolt Run 中成功 |
| 网页点选 → 源码定位与运行时实例身份（navigation-only） | 【已验证·合成+官方 CI】 | D PR #18 已合入 A；实例级精准编辑授权仍关闭 |
| 意图输入 → 隔离 worktree 候选补丁（diff、patchHash、tree digest，多操作合并） | 【已验证·合成】 | fail-closed 边界齐全（路径越界/符号链接/漂移/篡改拒绝） |
| 资源授权与内容寻址快照（SHA-256，未授权外联默认阻断） | 【已验证·真实（部分）】 | 青野真实快照 221 个资源/12.4 MB，unavailable=0（Run #10/#11） |
| Docker 隔离预演 + 四视口（1440/768/375/390）Playwright 验证与七项断言 | 【已验证·合成】/【待验收·真实】 | Bolt Runs #1–#17 全失败，Run #18 未触发 |
| 范围决策与审批门控（unknown/partial 页面拒绝进入安全范围） | 【已验证·演示层】 | F 体验层强制；真实 Receipt 门控随 Run 待验收 |
| 同补丁 Approval→Apply→Rollback→History Restore | 【已验证·合成+MEDIA 真实单线】 | TEXT 真实闭环 NOT RUN；青野 MEDIA 分类图闭环真实通过（Run 39536064634） |
| MEDIA 素材替换（本地上传/海报库、三容器裁切对照、media:// 引用） | 【已验证·工作台本地】 | 真实管线单操作通过（青野）；栖光演示为 Fixture |
| CSS Token 执行器 | 【未接入】 | A 未完成；第三方 Token 0 节点实测 |
| E 视觉差异证据（像素 diff + 几何规则，risk/unknown 语义） | 【已验证·合成样例】 | 未接入 VerificationRunner |
| AI 影响解读（把结构/渲染证据翻译为决策建议，引用 Evidence ID） | 【已验证·演示层】 | 本地规则解读；未知测量显示待确认 |

## 5. 技术架构

- **Project-first 统一契约**：ProjectRevision、SourceGraph、ScopeDecision、EditOperation、CandidatePatch、VerificationRun、Evidence、Approval、AppliedRevision、EditSession 统一在一个领域模型中；TEXT/MEDIA/TOKEN 共用同一候选生命周期，不建第二套状态机。
- **来源分析**：TypeScript AST 读取真实 React/Vite 工程；source-annotation 区分 JSX 来源与运行时实例（React key 构成实例边界，无 key 的 map 实例标 position-dependent/unknown）；page-overrides 用 UUID + AST marker，不用字符偏移。
- **候选与验证**：候选在隔离 Git worktree 生成真实 diff；VerificationRunner 固定四视口计划，Docker 受限容器（internal network、loopback relay、只读挂载、非 root、CSP、sandbox iframe、pids/内存限制、180 s 预算），资源快照内容寻址；Receipt 绑定 source digest、candidate/patch/tree hash、Scope 版本、runtime fingerprint、页面、视口、截图与执行 JSON。
- **生命周期安全（Run #12 修复）**：视口拥有全部页面与任务；清理失败（closeFailures/pagesLeaked/unsettled）任一 > 0 即 fail-closed 中止；发布门校验 v4 manifest、先验证后关浏览器再原子发布；failed-to-run 诊断不可被审批。
- **UI 分层**：工作台（ProjectWorkbench）负责真实链路；体验工作台（F，画布优先）负责演示与门控；纯派生逻辑集中在 selectors/view-model 便于适配。
- 明确边界：只支持受限 React/React DOM + Vite 风格 SPA；不执行目标项目 lifecycle script、项目 Vite 配置、SSR、任意自定义服务；Docker worktree 不是完整执行沙箱。

## 6. 核心创新

1. **影响感知式编辑交互**：把「改动→依赖→影响」从抽象治理问题转译成可见、可控、两分钟能演示完的数字媒体交互（结构涟漪 + 真实渲染涟漪 + AI 证据解读三层叠加）。
2. **证据纪律**：UNKNOWN/RISK/NOT_RUN/STALE/FAILED_TO_RUN 永不伪装成 PASS；视觉差异证据「从不 PASS」语义（变化≠风险、无变化≠通过）；审批只接受完成且绑定完整身份的 Receipt。
3. **同一补丁原则**：审批、应用、回滚使用同一份已验证 CandidatePatch，不重新生成；回滚保护应用后用户新增修改。
4. **四视口真实预演**：把响应式后果（换行、溢出、遮挡、异常重排）变成带哈希的可复核证据。
5. **失败驱动的工程闭环**：17 次真实运行（Runs #1–#17）逐次归因（资源快照、pids 超限、导航 10 s、导航契约、预算），每次修复都带确定性负例与独立审查（三轮），不放宽断言换绿。

## 7. 技术路线

AST 来源分析（TypeScript compiler API）→ DOM→Source 运行时注解与点选桥 → EditSession/意图 → Scope 决策 → 隔离候选（worktree diff + 哈希登记）→ Docker 受限预演（受限 Vite 适配 + loopback relay + CSP）→ Playwright 四视口验证（七断言 + 资源快照 + 浏览器错误聚合）→ 发布门与 Receipt → Approval → 同补丁 Apply/Rollback/History → MEDIA asset-swap 执行器与 E 视觉证据模块（按接入顺序推进）。

## 8. 测试与验证

- **合成工程 CI**（权威 Linux CI）：A 主线 2525092 CI #478 success；A+D 集成 408/408 Vitest、30/30 Playwright（1 跳过为私有专项，Run 39650178433）；PR #17 联合回归 426/426、30 passed/1 skipped（Run 39667915489）。
- **真实工程验收**：青野 MEDIA asset-swap 第一阶段 Run 39536064634 SUCCESS（四视口双端 7 断言、Approval/Apply/Rollback、原工程未改动证明）；Bolt TEXT 验收 Runs #1–#17 失败（预算、pids、导航成本等，已逐项修复），Run #18 待触发。
- **独立审查**：Run #12 修复三轮独立审查（复用页面破坏隔离等 P0 均被负例抓住后修复）；B MEDIA 与第三方探针经协调人独立审查冻结。
- 三案例统一验收矩阵见 `docs/delivery/acceptance-matrix.md`。

## 9. 应用价值

- 让非技术运营安全完成网站日常修改，降低「改崩线上」的沟通与回滚成本。
- 让建站服务商把「影响说明 + 证据 + 回滚」作为交付物的一部分。
- 方法可迁移到任何「共享来源 + 多呈现位置」的数字作品（设计系统 Token、多渠道文案、媒体素材库）。
- 证据纪律（从不把 UNKNOWN 写成 PASS）本身可作为 AI 辅助编辑工具的工程范式参考。

## 10. 不足与后续计划

| 不足 | 后续计划 |
| --- | --- |
| Bolt TEXT 真实全闭环未通过（Runs #1–#17 失败，Run #18 未触发） | 触发 Run #18；若超预算按已批准方向（网络 relay 提供快照恢复 HTTP 缓存 / cgroup 余量允许并发探测页），不延长预算、不减少视口 |
| E 视觉差异模块未接入验证管线 | 按 E 文档 §7 接入顺序：baseline 侧同参截图 → 采样器绑定 → manifest 增加 visualComparisons → Receipt 重算哈希（建议性，不替代必需断言） |
| CSS Token 执行器未实现；SCSS 不支持 | A 实现 Token 执行器与 Scope/computed-style 证据后复验 |
| 第三方工程路由识别缺失（data router 0 route） | A-P1a 合入后按阻断矩阵推进 codescandy TEXT 全生命周期 |
| 实例级精准编辑无授权 | 维持 fail-closed；待可信 Provider 与绑定方案评审 |
| Windows 原生预演不支持；本机全量 core 测试受环境限制 | Linux CI 为权威；推荐 WSL2 + Docker Desktop |
| 演示层真实适配器未接线 | 按 F HANDOFF §4 接口清单由各 Agent 提供后接 real-adapter |

## 11. 演示 PPT 页面内容建议

| 页 | 标题 | 内容要点 | 画面素材 |
| --- | --- | --- | --- |
| 1 | 封面 | 涟漪 Ripple · 改动上线前，先看见波及 | slogan + 三案例主视觉拼图 |
| 2 | 一个问题 | 改一句话，可能动三个页面；谁替运营兜底？ | 青野三页关系概念图（示意标注） |
| 3 | 产品答案 | 结构涟漪 + 渲染涟漪 + 证据解读三层 | 三层架构图 |
| 4 | 主案例演示 | 青野 10 步路线（脚本第 1 节压缩） | 真实工作台录屏截图 |
| 5 | 范围决策与门控 | 只改当前 vs 同步同源；unknown 拒绝 | 范围双卡 + 门控拒绝截图 |
| 6 | 四视口验证 | 七断言 + Evidence ID + 哈希绑定 | 断言面板 + 证据详情（Fixture 角标/待验收标注） |
| 7 | 应用与回滚 | 同补丁原则；回滚保护；历史恢复 | 版本胶片 + 回滚证明（MEDIA 真实佐证） |
| 8 | 栖光 MEDIA | 同素材三容器不同呈现 | 三容器对照 + 裁切弹窗录屏 |
| 9 | 第三方适配 | 真实数字说话：61 证实 / 100 unknown / 0 route / 0 token | 探针统计面板 |
| 10 | 技术架构 | Project-first 契约 + 隔离预演 + 发布门 | 架构图 |
| 11 | 工程严谨性 | 17 次真实 Run 失败驱动修复；三轮独立审查；从不把 UNKNOWN 写成 PASS | CI/Actions 面板截图 |
| 12 | 价值与计划 | 应用价值 + 不足与后续（如实） | 矩阵表缩略 |

答辩备用问题：预算 180 s 的依据、为何拒绝页面复用（状态泄漏证据）、Demo 与真实能力的边界、第三方为何 Issue 不关闭。
