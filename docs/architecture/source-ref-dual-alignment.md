# E × C+D sourceRef 双侧对齐合同

分支：`feat/e-visual-verification-integration-20261023`（E）
对齐对象：C+D `feat/integration-cd-sourcegraph-20261022`（PR #28，HEAD `1dbaa53`）
状态：已实施（`src/core/visual-geometry.ts` `pairCrossVersionElements` +
`src/core/visual-dual-targets.test.ts` 12 例全绿）；**共享接口层面的改动
仅为 RFC，未冻结**，见文末依赖清单。

## 1. 目的与边界

E 的视觉证据在分析期需要回答一个问题：candidate 侧的渲染差异，对应
baseline 侧的哪个 JSX 来源元素？本合同定义 baseline ↔ candidate 元素的
配对规则与证据分级。**只配对、不授权**：配对结果只影响视觉证据的
`report.crossVersion` 呈现，不进 Scope、不进审批门控、不改 Receipt。

E 侧几何采样器目前输出 `sourceRef` / `runtimeInstanceId` / `certainty`
（词表与取值逐字取自 C+D），但**不采集 `sourceVersion` 与采集期
`reasons`**——这是已确认的 C+D 依赖缺口，见 §4，E 侧不假装已覆盖。

## 2. sourceRef 词法

- 形态：`jsx:<file>#<offset>`（C+D PR #28 冻结）。
- 文件提取：`sourceFileFromSourceRef(ref)`，正则 `/^jsx:(.+)#\d+$/`；
  不匹配返回 `undefined`，绝不猜测。
- `runtimeInstanceId` 形态：`<pathname>:<owner>`（C+D），与 sourceRef
  是**两个独立维度**：同一 sourceRef 可渲染多个实例（如共享 Footer），
  同一实例 id 不允许在同一页重复出现（C+D `project.ts` 读取期强校验）。

## 3. 双侧证明阶梯（E 实现）

`pairCrossVersionElements(baseline, candidate)` 对两侧几何描述符做
配对，每对落在且只落在以下一级：

1. **instance-proven**：两侧各恰有一个元素满足
   `runtimeInstanceId` 等值，且双侧 certainty 均为稳定档
   （`stable-keyed-instance` 或 `stable-react-instance`，
   C+D `isStable` 同口径），且两侧 `sourceRef` 指向同一文件。
   这是唯一可以声称"同一运行实例的两侧视图"的级别。
2. **source-file-proven**：实例级不成立，但两侧 `sourceRef` **精确等值**
   （同一文件、同一 offset）。结论限定为"同一 JSX 来源位置"。
3. **unproven**：其余一切。原因枚举（additive，可并存）：
   `duplicate-runtime-instance`（同侧同 id 多于一个）、
   `different-source-file`、`identity-not-stable`（任一侧非稳定档）、
   `position-dependent-identity`。

**显式禁用**：任何文本相似度、DOM 位置、URL/路由的推断配对。
配对不上就是 unproven，由 F 以"需人工复核"呈现，永不回退到猜测。

配对结果进入证据的 additive 字段 `report.crossVersion`
（计数 + 有界 pair 列表，上限防膨胀）与 `report.target.dual`
（每侧 declaredRefs / mappedRefs / missingRefs）。非 dual 输入的
旧路径逐字节不变。

### 5 类问题分类（F 消费口径）

| 分类 | 含义 |
|---|---|
| `baseline-only` | 仅 baseline 侧有此来源，candidate 已移除/未渲染 |
| `candidate-only` | 仅 candidate 侧有此来源，新增元素 |
| `instance-proven` | 配对成功且为实例级证明（最强） |
| `source-only` | 配对成功但仅来源级证明 |
| `unproven` | 配对失败，需人工复核 |

## 4. 与 PR #28 字段对照及语义差异

| 字段 | C+D 侧语义（PR #28） | E 视觉侧现状 | 差异 |
|---|---|---|---|
| `sourceRef` | `jsx:<file>#<offset>`，SourceGraph 证明 | 同一词法，测试/注入场景由宿主提供 | E 不生成 offset，只消费 |
| `runtimeInstanceId` | `<pathname>:<owner>`，页面内唯一 | 同一词法，从几何描述符读取 | 一致 |
| `certainty` | 五档：stable-keyed-instance / stable-react-instance / position-dependent / unknown / unmapped | 同五档，配对只认前两档为稳定 | 一致 |
| `instanceIdentityProven` | `reasons` 为空即证明（零 reason 口径） | 配对要求双侧各一实例 + 双稳定 + 同文件，比单测 instance-proven 更严 | E 更保守 |
| `sourceVersion` | served 文件 sha256；`resolveRuntimeElement` 要求与图版本一致，旧身份作废 | **E 采样器不采集** | **缺口①** |
| `pageContext` | 每页上下文（路由等） | **E 采样器不采集** | **缺口②** |
| `reasons` | 采集期降级原因（含 blocking 六类） | E 配对自产 reason（§3 枚举），与 C+D blocking 词表部分重合 | 词表交集仅 `duplicate-runtime-instance` |

## 5. 依赖清单（交给 C+D / A 总集成）

1. **缺口①**：geometry sampler 需 C+D 注入 `sourceVersion`（served 文件
   sha256），使视觉证据能执行与 `resolveRuntimeElement` 同口径的版本
   失效判定（当前版本变化只能靠"配对失败"间接受损表达）。
2. **缺口②**：多路由矩阵（C+D 路由合同冻结后）要求 sampler 采集
   `pageContext`，否则跨页同 id 实例无法区分（当前 E 以单页采集为
   前提）。
3. **跨版本 offset 映射**：baseline 与 candidate 是不同构建，`#<offset>`
   可能漂移。E 侧当前先按"同文件 + 稳定实例 id"落地；精确到 offset 的
   跨版本映射策略需 C+D 确认（sourceRef 是否纳入版本指纹，或提供
   映射表）。在 C+D 答复前，E 配对到 instance-proven 即停止，不做
   offset 级断言。
4. **A 总集成**：sourceVersion 进 sampler、Approval → Apply → Receipt
   全链路下的视觉证据挂载、四视口 × 多路由采集矩阵，均属 A 的合同，
   E 不越权实现。

## 6. 验证

`src/core/visual-dual-targets.test.ts` 12 例，覆盖任务书 8 个对照场景：
位置偏移不误报、共享 Footer 重复实例降级、同源不同实例、
RouterProvider unknown、来源不一致拒绝配对、跨页消费者、无目标变化、
版本失效路径。固件字节零变化（12 个 golden fixture 未触碰）。
