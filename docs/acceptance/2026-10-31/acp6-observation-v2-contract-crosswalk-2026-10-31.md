# AC-P6 GraphObservationBindingV2 对照与旧图隔离记录

状态：**evidence-only，生产观测继续 HOLD**  
日期：2026-10-31（Asia/Shanghai）

本文记录 A/E 最终双层合同方向，并把它与可复验的 B1.1/D r3 证据对照。版本字段已经拆开记录；canonical envelope 的最终序列化仍以 A/E 冻结 artifact 为唯一准入依据。本文不创建 collector、VerificationRun 或授权器。

## 1. 可复验上游事实

| 输入 | 事实 | 处置 |
|---|---|---|
| B1.1 exact-head `6388abec96183cc28824dc2b7fa486e4e944d305` | graph/probe 没有 `projectId`、`sourceRef`、side-specific `sourceDigest/graphDigest`、`graphSchemaVersion`、`relationIdentityVersion`、`runId`、`checkId`、`side`、page tuple 或 binding digest | 不作 V2 绑定声明，D 保持锁定 |
| B Base | 675 nodes / 5302 edges / 253 unresolved；298 个重复 Relation ID key，886 个额外 occurrence | 旧图只能作为审计参考，不生成 V2 digest |
| B1.1 Final | 675 nodes / 3046 edges / 253 unresolved；84 个重复 Relation ID key，252 个额外 occurrence | 必须返回 `graph-schema-invalid` / `unavailable`，不生成可信 `graphDigest` |
| B 身份分类 | 21 valid / 35 unsafe / 92 unknown / 0 regression | 只能作为分类输入；未替代 Relation ID 治理或 V2 canonical 审计 |
| D r3 黄金样本 | G4/G5 与独立负例验证通过 | 只证明 evidence validator 行为，不证明真实图兼容 |

证据来源：B 独立报告 `b11-final-independent-report-20261031.md`、`binding-v2-audit-20261031.json` 和 Relation ID duplicate diagnostic。B1.1 生产实现、阈值、SourceGraph 和 Runtime Identity 均未在本分支修改。

## 2. A/E V2 字段对照

以下是当前双层合同方向。`graphIdentityVersion`、`graphSchemaVersion`、`relationIdentityVersion` 和 `observationBindingVersion` 是四个互不替代的字段；任何字段缺失、串位或互相复制都拒绝。字段序列化和 canonical key 顺序必须来自 A/E 最终 envelope artifact。

| 层 | 字段 | 绑定规则 | digest 归属 | 缺失或冲突 |
|---|---|---|---|---|
| 静态 Graph Identity | `graphIdentityVersion` | 固定为 `sourcegraph-identity/v2`；声明 Graph 身份语义 | static identity envelope | 旧值或缺失：legacy isolation / `unavailable` |
| 静态 Graph Identity | `projectId` | 由宿主项目注册表提供；不能来自 worktree 名、URL、DOM 或调用者字符串 | 静态身份输入 | `logical-project-mismatch` / `unavailable` |
| 静态 Graph Identity | `sourceRef` | 只引用当前 side 图中可重新定位的来源；不能由坐标或普通 recordId 推导 | 静态身份输入；不进入 page tuple | 无法定位时只能 `partial`/`unknown` |
| 静态 Graph Identity | `sourceDigest` | baseline/candidate 各自绑定自身源码版本 | side-specific graph identity | 不匹配为 `source-digest-mismatch` / `stale` |
| 静态 Graph Identity | `graphDigest` | 由当前 side 的 canonical Graph 重算；重复 Relation ID、未知端点、未知字段直接拒绝 | static graph digest | `graph-schema-invalid` / `unavailable` |
| 静态 Graph Identity | `graphSchemaVersion` | 独立描述 Graph 结构 schema；不得填入 `sourcegraph-identity/v2` | static graph identity | 旧版本隔离，不自动升级 |
| 静态 Graph Identity | `relationIdentityVersion` | 独立绑定 A 批准的 Relation ID 身份治理版本；不得复用 `graphSchemaVersion` | static graph identity | 缺失/旧值不能产生可信 digest |
| Capture Binding | `observationBindingVersion` | 固定为 `sourcegraph-observation-binding/v1`；不得并入 Graph Identity Version | observation binding envelope | 缺失/旧值：binding 不可信 |
| Capture | `runId` / `checkId` | 只能引用可信 VerificationRun/VerificationCheck；采集器不能自行注册 | observation binding input | `cross-run` / `cross-check` / `unavailable` |
| Capture | `side` | 只能是 `baseline` 或 `candidate`；两侧分别校验 | observation binding input | `side-mismatch` / `unavailable` |
| Capture | `pathname/search/hash` | 保留完整 PageTuple，不得只保留 pathname | observation binding input | `page-context-mismatch` / `unknown` |
| Capture | `viewport` | 宽、高、DPR 按 check plan 精确匹配 | observation binding input | `viewport-mismatch` / `unknown` |
| Capture | `state` | 使用 check plan 的稳定 state ID 和可重算 digest | observation binding input | `state-mismatch` / `unknown` |
| Cross-layer | `observationBindingDigest` | 只对 A/E canonical envelope 规定的 `observationBindingVersion`、该 side 的 Graph Identity 和完整 capture tuple 做 canonical 绑定；不能把 page tuple 写入 Relation ID 或 static `graphDigest` | binding digest only | 缺失/无法按冻结 envelope 重算时不形成可信 binding |

规则：baseline 和 candidate 必须各自携带自己的 `projectId`、`sourceRef`、`sourceDigest`、`graphDigest`、`graphIdentityVersion`、`graphSchemaVersion` 和 `relationIdentityVersion`，再分别绑定同一 `runId/checkId` 下自己的 capture tuple。禁止把 candidate 值复制到 baseline，也禁止把 `graphIdentityVersion` 填入 `graphSchemaVersion`。无 `sourceRef` 时最多保留诊断性的 `partial`/`unknown`，不得生成 `source-proven` 或跨侧 pairing。

## 2.1 `sourceUse` 与 `sourceUseRef`

- `sourceUse` 是 side Graph relation 上的 canonical 来源位置对象，包含 `path`、`charOffset`、`byteOffset`、`offsetUnit`；它属于 Graph payload，并参与该 side `graphDigest`。
- `sourceUseRef` 是 observation capture 对 Graph 来源位置的引用，至少包含 `graphNodeId`、可选 `relationId` 及同一组位置字段；它不能创建新的 Graph edge。
- 校验器必须先按该 side 的 `graphDigest` 和 `relationIdentityVersion` 查找唯一 relation，再逐字段比较 `sourceUseRef` 与 relation `sourceUse`；不能只比较 path、DOM 坐标、selector 或普通 recordId。
- 没有 `sourceUse`、`sourceUseRef`、唯一 strict consumer edge 或有任一偏移不一致时，按 D r3 原因码降级；不得产生 `source-proven`。

`sourceUseRef` 是否作为 `observationBindingDigest` 的直接成员，只能由 A/E canonical envelope 明确决定；本 evidence 文档不自行扩展 digest 输入。无论是否纳入 digest，以上逐字段 Graph reference 校验都不可省略。

## 2.2 canonical envelope 与测试向量

V2 的 digest 输入边界固定为两层：

```json
{
  "observationBindingVersion": "sourcegraph-observation-binding/v1",
  "graphIdentity": {
    "graphIdentityVersion": "sourcegraph-identity/v2",
    "projectId": "<host-bound>",
    "sourceRef": "<side-local>",
    "sourceDigest": "<side-specific>",
    "graphDigest": "<side-specific>",
    "graphSchemaVersion": "<graph-schema>",
    "relationIdentityVersion": "<A-governed-opaque-value>"
  },
  "capture": {
    "runId": "<trusted-run>",
    "checkId": "<trusted-check>",
    "side": "baseline|candidate",
    "page": {"pathname":"<exact>","search":"<exact>","hash":"<exact>"},
    "viewport": {"width": 0, "height": 0, "deviceScaleFactor": 1},
    "state": {"id":"<stable-state>","digest":"<optional-sha256>"}
  }
}
```

上面的字段集合用于执行准备和字段分离检查；对象键顺序、可选字段省略、字符串/数字规则和最终 digest 必须直接采用 A/E 冻结 serializer，不能由 D 自行重排或补字段。

现有可执行 Graph canonical 向量继续有效：G4/G5 canonical SHA-256 与 `graphDigest` 均为 `a75ccff69fbae29ed069721d8d82eb2ff07bfc85d306c81ecca99ff35c45f398`；G0/G1 验证顺序稳定，G2 验证关系变化改 digest，G3 验证环境字段不污染 Graph digest。当前没有 A/E 签发的 `observationBindingDigest` 黄金值，因此不伪造 binding digest 结果。

## 3. 旧 B v5、旧图和旧 ID 隔离

1. 旧 B v5 输出缺少 V2 envelope 或缺少任一 side-specific digest/version 字段时，只能放在 `legacy/b-v5-reference` 命名空间作只读审计输入；V2 校验器不得将其转换为 `complete` 或可信 receipt。
2. 旧图缺少原始 nodes/edges/unresolved 数组、只有统计摘要时，结果为 `missing-artifact` / `unavailable`；不能把 `675/5302/253` 或 `675/3046/253` 当作唯一性证明。
3. 旧 Graph 中的 Relation ID 不能直接作为新 `relationIdentityVersion` 的身份。没有 A 批准的显式迁移表时，旧 ID 只能保留为审计字符串；不得自动去重、重编号、忽略边或吞掉 unresolved。
4. 旧 source/graph digest 与当前 side 不一致时，记录为 `source-digest-mismatch` 或 `graph-digest-mismatch`，状态 `stale`；不得以相同 URL、相同 selector 或相同 DOM 坐标复活。
5. 旧 run/check/side/page tuple 不得跨 run、跨 check 或跨 side 借用；冲突结果为 `cross-run`、`cross-check` 或 `side-mismatch`，状态 `unavailable`。
6. 真实 B1.1 Final 的 84 个重复 Relation ID key 在身份治理完成前继续返回 `graph-schema-invalid` / `unavailable`，`graphDigest=null`，不进入 D collector 或授权链路。

## 4. N01–N32 执行准备边界

- 待执行清单：[acp6-observation-v2-n01-n32-execution-manifest-2026-10-31.json](./acp6-observation-v2-n01-n32-execution-manifest-2026-10-31.json)
- 当前状态：所有条目 `not-executed`；没有把 G4/G5 或真实 Graph 摘要冒充 N01–N32 结果。
- 允许写入：本 evidence/docs 目录下的 sidecar、输入快照、输出、SHA-256 manifest 和运行日志。
- 禁止写入：`src/`、SourceGraph、VerificationRun 权威字段、Runtime Identity、Candidate、Scope、Approval、Apply、Rollback、生产 collector。
- 执行前置：A 冻结 V2 字段与 canonical binding、B/C 提供新身份版本真实 Graph、Relation ID 唯一性审计通过、E 完成 side-specific/page tuple 复审。

## 5. 当前停点

本记录只完成双层合同对照、旧输入隔离规则和 N01–N32 执行准备。A canonical envelope artifact、E 正式复审、真实 Graph 身份治理、B 新身份版本复验和正式授权完成前，D 不建立生产实现分支、不接线 collector、不触发真实 VerificationRun、Bolt 或四视口全链。

