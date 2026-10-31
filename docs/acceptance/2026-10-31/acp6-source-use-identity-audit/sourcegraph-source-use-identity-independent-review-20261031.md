# Ripple B｜SourceGraph source-use 类型与身份独立核对

日期：2026-10-31
性质：evidence-only 独立核对；不启动新身份版本正式验收。

## 1. 精确输入与冻结边界

| 项目 | 精确值 |
|---|---|
| Base | 5b75fe699afce98638e6fd6ad110911d83389dc8 |
| 生产实现 | 34d2a22e696c9eb1af15d5cd9800cf76b7cf7883 |
| 原始证据快照 | 6388abec96183cc28824dc2b7fa486e4e944d305 |
| 归档 HEAD | fb2efe35c447eadf262d55f1d9755bb26cecabda |
| 归档 Tree | e942bf8d12e3c7224b79d673705fdc253c0cf552 |
| merge-base | 5b75fe699afce98638e6fd6ad110911d83389dc8 |
| 固定工程 | allanhue/webportflio@b244f857457d2a07f118155602eef9097fd322bd |
| B v5 probe blob | 3431294c0807161432e0a7c986825ffc5263bc87 |
| B v5 matcher blob | 3a04ab896b40500b2c314b710b4cb1c3a3893dcb |

本次只读使用 Base/Final 的独立原始图快照；没有修改 probe、matcher、阈值、生产源码或旧 B v5 报告。

原始图：

- Base：5302 edges、253 unresolved；SHA-256 30047feae2d45f00ae39b8661048e6ccd1f2ad455dfa317df75cbedfe2e5c19f
- Final：3046 edges、253 unresolved；SHA-256 0ae3eaf5ead0a8bd8b87c158349b7d9f7980adad94cab2ed5fafbb07a9a2de76

## 2. 节点类型证据

src/core/model.ts:26 的声明枚举为：

file | symbol | component | route | data | media | token | token-use | jsx-element | state

固定工程的 Base 与 Final 实际都只出现以下七类：

| kind | Base | Final | Source-use 角色 |
|---|---:|---:|---|
| file | 62 | 62 | CSS/源码容器；不可冒充 token-use |
| component | 19 | 19 | 组件 owner/renderer；不可冒充 token-use |
| token | 36 | 36 | CSS declaration；不可冒充 var() use |
| token-use | 252 | 252 | 唯一的 var(...) 使用节点 |
| jsx-element | 214 | 214 | JSX host/consumer；可作为 candidate 端点，不是 token-use |
| data | 85 | 85 | 文本/字面量；不可冒充 token-use |
| route | 7 | 7 | 页面路由身份；不可冒充 token-use |

symbol、media、state 在类型枚举中允许，但本固定图没有实际节点。类型不会因为 label、selector、普通 ID 或另一端关系而改变。

代码生成依据：

- declaration → kind token：src/core/project.ts:545-556
- var(...) → kind token-use 并建立 source-proven file → token-use reads：src/core/project.ts:552-568
- JSX host → kind jsx-element：src/core/project.ts:760-768
- component → kind component：src/core/project.ts:348-351
- route → kind route：src/core/project.ts:806-836

### 正例与反例

| 判定 | 节点/关系 | 证据 |
|---|---|---|
| 正例 | token-use:dist/assets/index-hJgMd1dF.css#702；css-token-use-source:...:702，file → token-use，reads，source-proven | sourceUse.path 与 byteOffset=702 精确落到 token-use 节点 |
| 反例 | token:dist/assets/index-hJgMd1dF.css#170；definition:...#170，file → token，reads，source-proven | declaration 没有 sourceUse，不是 source-use |
| 反例 | jsx:src/pages/Cert.jsx#1510；css-selector-candidate:...，token-use → jsx-element，css-cascade，semantic-candidate | JSX host 是消费者候选，不能冒充 token-use，也不能升级 source-proven |
| 反例 | component:src/App.jsx#717；component-host:...，component → jsx-element，renders | component 是 owner/renderer，不是 token-use |
| 反例 | page:/；declarative-router:...，route → component，renders | route 是页面身份，不是 token-use |
| 反例 | literal:src/components/ContactForm.jsx#1253；literal-read:...，component → data，reads | data 是普通字面量节点，不是 token-use |
| 反例 | token-use:...#702 → file:...，uses-token，unknown | 虽有 sourceUse 锚点，目标未解析且 certainty=unknown，不是可信来源证明 |

完整节点与关系负例保存在 sourcegraph-node-type-evidence-20261031.json。

## 3. Relation 来源绑定矩阵

src/core/model.ts:48-60 的 Relation 实际字段只有：

id, from, to, kind, certainty, evidenceRefs, sourceUse?, selectorScope?, mediaContext?

固定 Base 与 Final 的实际 Graph 均为：

- sourceIdentity 字段：0
- Relation sourceRef 字段：0
- Relation sourceUseRef 字段：0
- Node sourceIdentity/sourceRef 字段：0

因此当前图不存在可被误读为 Relation.sourceIdentity 的绑定字段。运行时 sourceRef 属于 RuntimeElementObservation，由 src/core/source-annotation.ts:1484-1511 写入 data-ripple-source；它是运行时注释/选择锚点，不会填充 Graph Relation 的来源身份。

sourceUse 的实际含义是 CSS var(...) 锚点：

    {
      "path": "dist/assets/index-hJgMd1dF.css",
      "charOffset": 702,
      "byteOffset": 702,
      "offsetUnit": "code-unit"
    }

Base（4808 条携带 sourceUse 的关系）：

| relation | certainty | from → to kind | 级别 | 数量 |
|---|---|---|---|---:|
| reads | source-proven | file → token-use | full source-use origin | 252 |
| uses-token | unknown | token-use → file | unknown | 252 |
| token-reference | semantic-candidate | token → token-use | partial，端点已绑定 | 964 |
| uses-token | semantic-candidate | token-use → token | partial，端点已绑定 | 964 |
| css-cascade | semantic-candidate | token-use → jsx-element | partial，端点已绑定 | 1184 |
| uses-token | semantic-candidate | jsx-element → token | partial，仅 metadata，无 token-use 端点 | 1184 |
| uses-token | semantic-candidate | token → token | partial，仅 metadata，无 token-use 端点 | 8 |

Final（2552 条携带 sourceUse 的关系）：

| relation | certainty | from → to kind | 级别 | 数量 |
|---|---|---|---|---:|
| reads | source-proven | file → token-use | full source-use origin | 252 |
| uses-token | unknown | token-use → file | unknown | 252 |
| token-reference | semantic-candidate | token → token-use | partial，端点已绑定 | 684 |
| uses-token | semantic-candidate | token-use → token | partial，端点已绑定 | 684 |
| css-cascade | semantic-candidate | token-use → jsx-element | partial，端点已绑定 | 336 |
| uses-token | semantic-candidate | jsx-element → token | partial，仅 metadata，无 token-use 端点 | 336 |
| uses-token | semantic-candidate | token → token | partial，仅 metadata，无 token-use 端点 | 8 |

独立核对结果：

- 两张图的每条 sourceUse.path#byteOffset 都能命中唯一 token-use 节点。
- 所有 sourceUse.offsetUnit 都是 code-unit。
- 252 个 token-use 节点的 path+byteOffset 唯一。
- 这只证明 source-use 锚点存在；不证明 DOM 激活、CSS cascade、主题状态、computed style 或编辑授权。

### 来源证明边界

1. 完整来源锚点：只有 file → token-use、kind=reads、certainty=source-proven 且 sourceUse 精确匹配端点的 252 条关系。
2. partial：token-reference、uses-token、css-cascade 关系即使含有匹配的 token-use 端点，也保持 semantic-candidate；没有运行时或级联证明。
3. partial metadata：jsx-element → token、token → token 只携带 sourceUse/selectorScope，不存在 token-use 端点，不能补造 sourceUseRef。
4. unknown：token-use → file 的 252 条 unknown 关系不能因为 sourceUse 或 selectorScope 而获得 trusted/source-proven。
5. 禁止从 DOM、selectorScope、普通节点 ID、关系另一侧、runtime sourceRef 或 opaque sourceRef 推导 sourceIdentity/sourceRef。

来源矩阵完整机器版本见 sourcegraph-source-binding-matrix-20261031.json。

## 4. 当前裁定与回归边界

- B1.1：ACCEPT WITH SCOPE
- AC6.2：PENDING
- AC6.4：PENDING
- Relation ID 唯一性：REJECT
- 新身份版本正式验收：NOT STARTED

本材料没有升级任何 semantic-candidate、unknown 或运行时 sourceRef 为 source-proven，也没有扩大 Candidate、Scope、Verification、Approval、Apply、Rollback 权限。
