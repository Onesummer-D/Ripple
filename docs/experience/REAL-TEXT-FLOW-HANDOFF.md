# REAL TEXT FLOW 交接文档（F 第二阶段开发入口）

> 状态：PR #25（Real Adapter 第一阶段）合并前定稿。
> 本文档是 F 在正式产品界面接入真实 TEXT 操作链路的唯一交接依据：
> 打开真实项目 → 点选元素 → 查看关系 → 修改与范围决策 → 生成候选 → 四视口验证 → 审批 → 应用 → 回滚。
>
> 标注约定：**【已稳定】** = 合同已由 A 正式接口实现并由 F 第一阶段消费，可直接依赖；
> **【待冻结】** = 挂点已存在于 F 侧，但数据形状/来源合同尚未冻结，接入前必须与 C/D 负责人确认。

---

## 1. A 真实接口清单（`src/core/local-project-api.ts`）

所有路由挂在 `/__ripple/api/` 前缀下。GET 路由仅四个：`/history`、`/project/preview/report`（query 参数 `projectId`+`previewId`）、
`/candidate/{candidateId}/evidence/{evidenceId}`（截图证据，服务端哈希校验）、`/candidate/{candidateId}/runs/{runId}`（浏览器执行记录）；
其余均为 POST（JSON）。F 侧统一通过 `real-adapter.ts` 的 `post()` / `get()` 访问，禁止界面组件直接发请求。

| 路由 | 方法 | 请求体关键字段 | 响应关键字段 | 状态 |
|---|---|---|---|---|
| `/analyze` | POST | `projectRoot`（必填）、`previousCandidateId?` | `projectRoot, revision{projectId,sourceDigest,gitCommit,runtimeFingerprint}, graphId, unresolved[], routes[], targets[], relationCounts` | 【已稳定】409 = 分析期间源码变化，必须重新读取 |
| `/history` | GET | —（query 可带 `projectId`） | `history[]`（`candidateId, projectId, lifecycle, patchHash, updatedAt, verification{state,runId,patchHash,scopeVersion,assertions[],evidence[]}`） | 【已稳定】 |
| `/project/preview` | POST | `projectId` | `projectId, previewId, sourceDigest, url` | 【已稳定】 |
| `/project/preview/stop` | POST | `projectId, previewId` | `stopped` | 【已稳定】尽力清理，失败不阻断 |
| `/project/source-selection` | POST | `projectId, previewId, sourceDigest, sourceRef` | `element, sourceVersion, editableText[]`（含 sourceProven 页面影响） | 【待冻结】D 合同 |
| `/preview/resources` | POST | `projectId, urls[]` | `previewResources{referencedUrls, authorizedUrls}`；未分析工程返回 409 | 【已稳定】 |
| `/candidate` | POST | `projectId, rawIntent, operations[], scope, verificationContract?, previousCandidateId?` | `sessionId, status, candidate{candidateId,...}, verification, workflow` | 【已稳定】 |
| `/candidate/preview` | POST | `candidateId` | `candidateId, url, verification` | 【已稳定】 |
| `/candidate/preview/stop` | POST | `candidateId` | `stopped, candidateId` | 【已稳定】 |
| `/candidate/verify` | POST | `candidateId` | `candidateId, previewUrl, verification, workflow` | 【已稳定】 |
| `/candidate/approve` | POST | `candidateId, runId` | `candidateId, workflow` | 【已稳定】 |
| `/candidate/apply` | POST | `candidateId` | `candidateId, applied, workflow, analysis`（apply 后重分析） | 【已稳定】 |
| `/candidate/rollback` | POST | `candidateId` | `candidateId, rollback, workflow, analysis` | 【已稳定】 |
| `/candidate/source-selection` | POST | `candidateId` + 点选桥信封 | 候选画布上的运行时身份观察 | 【待冻结】D 合同 |
| `/candidate/restore` | POST | `candidateId` | 恢复证据/历史详情 | 【已稳定】 |
| `/discard` | POST | `candidateId` | 丢弃结果 | 【已稳定】 |
| `/candidate/{id}/evidence/{evId}` | GET | — | PNG 截图（sha256 与记录不符返回 409） | 【已稳定】 |
| `/candidate/{id}/runs/{runId}` | GET | — | 浏览器执行记录 JSON（同样哈希校验） | 【已稳定】 |
| `/project/preview/report` | GET | —（query：`projectId`+`previewId`） | 预演诊断 | 【已稳定】 |

身份授权规则（A 侧强制，F 不得在前端另建模拟状态机）：

- `approve` 需要 `candidateId + runId`，审批人记录为 `by: 'local-user'`。
- `apply` 仅允许 **active 且已审批** 的候选；`rollback` 仅允许 lifecycle = `applied` 且仍与原应用状态一致的候选。
- 所有候选生命周期操作走 `withCandidateLock`：并发操作返回「候选正在验证或变更中」。
- `assertCurrentOrRetire`：候选基线过期时自动退役为 `stale`，后续操作返回 404/候选错误——F 必须把这种失效刷新到界面，不得用本地状态续命。

## 2. D 点选桥合同与降级（`src/core/runtime-selection-bridge.ts`）

D 桥导出（F 只消费，不实现）：

- `isCurrentPickerEnvelope(data)`：校验点选信封是否属于当前会话（过期信封一律丢弃）。
- `assessPickerDisplayIdentity(data, trusted)`：评估信封显示身份是否可信。

身份确定性等级（`PickerCertainty`）：

| 等级 | 可否用于精准实例修改 |
|---|---|
| `stable-keyed-instance` | 可以 |
| `stable-react-instance` | 可以 |
| `position-dependent` | 不可——只能定位到近似位置，降级为「需人工确认」 |
| `unknown` / `unmapped` | 不可——禁止生成实例级操作 |

F 侧降级规则：**identityCertainty 不达 `stable-*` 时，编辑操作只能落到源码级 target（data/源码位置），不得附带运行时实例身份**；界面必须明确显示「实例身份未证实，按源码目标处理」。

## 3. C 来源关系字段（**【待冻结】**，PR #28 冻结前不得依赖形状）

F 侧挂点已存在于 `real-adapter.ts`：

```ts
attachSourceRelations({ provenUnaffectedRefs, pageRelations })
```

已确定的合同约束（冻结前不变的部分）：

- **挂点签名不变**：F 只接收这两个字段，不主动拉取、不缓存跨工程（`resetForProject()` 已清除）。
- **`provenUnaffectedRefs` 是页面关系从 unknown 升级为 source-proven 的唯一通道**。
  缺页一律保持 `relation: 'unproven', relationCertainty: 'unknown'`，F 绝不臆造「无影响」。
- `pageRelations` 的具体字段形状 **【待冻结】**：接入前须与 C 确认每个关系条目的来源证明与确定性标注方式。

## 4. F 发送 / 接收字段对照

### F → A（发送）

| 场景 | 字段来源 | 说明 |
|---|---|---|
| 打开工程 | `projectRoot`（用户输入的本机目录） | 唯一入口；`openProject()` 已做同步落定 + 停止挂起竞态防护 |
| 生成候选 | `projectId`(来自 analyze) + `rawIntent`(用户原始意图文本) + `operations[]`(TEXT 编辑操作) + `scope`(页面范围决策) | Scope 决策必须来自用户明确选择 + 来源证明默认值，绝不静默替用户决定 |
| 审批 | `candidateId + runId` | runId 必须来自最近一次 verify 的真实响应 |
| 应用 / 回滚 / 丢弃 | `candidateId` | 只允许对当前 active/applied 候选操作 |

### A → F（接收，映射在 `real-adapter.ts`）

- 页面关系确定性上限 = 实际元素与页面关系证据，当前浏览页 **不** 因此升格为 source-proven（PR #14 第三轮修复的约束在此继续生效）。
- `candidateStatus` 取 lifecycle 终态优先：`applied` > `rolled-back` > `stale` > 审批记录；`discarded` 视为无活跃候选。
- `compareState` 三态：`none`（无候选/无验证）/ `partial`（有候选但验证未全过）/ `comparable`。**未来引入 comparable 时必须校验候选身份、视口、验证上下文，不得只看两张 URL 就宣布可对照**（第一阶段已删除占位基线）。
- 预览会话清理失败 → Evidence 出现 `ev:cleanup`（state: `risk`），如实显示，不静默。

## 5. 每项操作的失效规则与失败处理

| 操作 | 失效规则 | 失败处理 |
|---|---|---|
| load / openProject / refresh | generation 守卫：每次调用自增，过期响应以 `StaleResponseError` 拒绝，调用方（工作台）必须忽略、**不得**用 unavailable 模型覆盖新请求的 ready 状态 | 工作台已捕获 `StaleResponseError` 直接 return |
| openProject 工程切换 | 旧候选、旧证据、旧预演会话、C/D 挂点数据全部失效；`projectRoot` 在任何 await 之前同步落定，停止请求挂起期间不得被旧续体改写 | 旧会话尽力停止；evidence 如实暴露清理风险 |
| selectElement（切换目标） | 旧目标的草稿与全部 Scope 意向清除；默认 Scope 完全由新目标的来源证明生成 | 不存在的目标 id 一律拒绝，返回原模型 |
| setPage（浏览页） | 只影响画布展示，**绝不参与页面关系投影** | — |
| 候选生命周期 | 服务端为权威：前端不得本地模拟 approved/applied 状态；stale 退役后界面必须回到「无活跃候选」 | CandidateError 文案直接呈现给用户 |
| dispose（关闭工作台/真实画布） | 停止项目预演会话并取消在途请求 | 尽力清理；清理失败保留会话身份入列，下次切换/刷新/关闭按身份重试；dispose 是最后一次重试机会 |

## 6. E2E 测试场景（第二阶段验收用例）

现有 `e2e/experience.spec.ts` 已覆盖 DEMO 全链路与 Real Adapter 第一阶段。第二阶段新增场景：

1. **真实点选**：真实画布 iframe 内点选元素 → 身份信封到达 → identityCertainty ≥ stable-* 时启用精准实例修改；低于 stable-* 时界面显示降级说明。
2. **来源关系**：切换目标后页面关系与 Scope 重算；C 数据到达后 provenUnaffectedRefs 之外的关系保持 unknown，不臆造。
3. **完整 TEXT 链路**：编辑文字 → 范围决策 → 生成候选 → 四视口 verify → approve → apply → 版本胶片出现 applied 记录 → rollback → 胶片出现 rolled-back 记录。
4. **失效场景**：verify 期间源码变化 → 候选 stale → apply 按钮不可用并提示重新生成；审批后切换目标 → 审批反馈不失效（属于候选，不属于目标）。
5. **预览清理**：快速连续切换工程/候选 → 服务端会话无泄漏（stop 全部到达），界面 Evidence 无 ev:cleanup 残留。

## 7. 已稳定 vs 待冻结一览

| 项 | 状态 |
|---|---|
| A 全部生命周期路由与身份授权规则 | 【已稳定】 |
| F 适配器异步契约（generation 守卫 / StaleResponseError / 尽力清理诊断） | 【已稳定】 |
| candidateStatus 终态优先、compareState 三态语义 | 【已稳定】 |
| D 桥的 `PickerCertainty` 等级与降级规则 | 【已稳定】（信封字段形状随 D 合同走） |
| C `attachSourceRelations` 挂点签名、`provenUnaffectedRefs` 唯一升级通道 | 【已稳定】 |
| C `pageRelations` 字段形状 | 【待冻结】PR #28 |
| D 点选信封完整字段（`/project/source-selection`、`/candidate/source-selection` 请求体） | 【待冻结】D 合同 |
| E Visual Evidence 只读证据接口的候选级 artifactUrl 清单 | 【待冻结】与 E 对齐 |

---

*文档责任人：F Agent。PR #25 合并后本文档即第二阶段分支的开发入口。*
