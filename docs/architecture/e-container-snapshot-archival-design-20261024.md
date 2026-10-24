# E 容器 Snapshot 归档设计（阶段二，仅设计不编码）

> E Agent，2026-10-24。依据：C+D 阶段二合同 v2
> （`feat/runtime-identity-phase2-20261024 @ 71da59d`，下称"合同 v2"）与
> `e-identity-phase2-prep-20261024.md`。
> **权威口径更新：A 冻结版 v1 `9c2c780`
> （`docs/architecture/runtime-identity-phase2-frozen.md`）已取代 C+D v2 成为
> 唯一权威；A 后续 v1.1 为最终权威。两者冲突处（跨版本严格配对条件）在
> v1.1 出具前一律按 A v1 执行，E 不采用 C+D 四支柱判定做 strict 升级。**
> 本文档只设计容器侧 snapshot 采集归档与宿主消费边界，**不修改生产代码、
> 不决定正式 Schema**（Schema 冻结权属 A；A v1 §2 已冻结数据结构，容器归档
> 实施权属 A，见 §8/§10）。正式编码启动条件见 §8。

## 1. 采集时机

复用现有视觉采集运行点，不新增页面往返。现有链路
（`visual-capture-executor.mjs` captureVisualSide）每次开页后依次：
fonts ready → `page.evaluate(sampler)`（sampler 内嵌 C+D collector，但仅提取
identityReasons，完整 snapshot 被丢弃）→ 双截图稳定性测量 → descriptor 组装。

**设计**：sampler 的 collector 调用已产出完整 `RuntimeIdentitySnapshot`，
当前被白白丢弃。最小改动方案是让 sampler 在 collector 可用时把原始 snapshot
作为独立字段随 geometry 返回（容器侧拆分写盘，见 §3），由容器写为独立工件；
若 collector 不可用（input.json 未下发 collectorSource）或调用抛错，
snapshot 字段为 null，与现有 identityReasons=null 的降级语义一致。
不采用"再跑一次 page.evaluate(collector)"的二次采集方案：多一次往返、且两个
snapshot 可能落在页面状态变化两侧，引入无谓不一致。

采集点键控与视觉证据完全同键：`checkId × route × viewport × state × side`。

## 2. 双侧独立归档

- baseline、candidate 各自开页、各自采集、各自写盘，互不知道对方存在；
- 每侧一条归档记录（合同 v2 §2 的"每运行点每侧一条 + 显式 side"组织形式
  与现有 `writeVisualSideArtifacts` 的 per-side 写盘一一对应；双侧分组方案
  由 A 二选一，差异只在宿主读取形状，容器侧不变）；
- 侧别写进文件名与 manifest 条目（`baseline-identity.json` /
  `candidate-identity.json`），宿主按 CAPTURE_PATH 风格白名单校验。

## 3. 工件组织（设计提案，正式 Schema 待 A 冻结）

```
<artifactRoot>/
├─ visual/<viewport-dir>/            # 现有：截图 + geometry（不动）
│   ├─ baseline.png / baseline-geometry.json
│   └─ candidate.png / candidate-geometry.json
└─ identity/<viewport-dir>/          # 新增：snapshot 工件（顶层独立目录）
    ├─ baseline-identity.json        # RuntimeIdentitySnapshot 序列化 + sha256 入 manifest
    └─ candidate-identity.json
```

manifest 增量（新段 `runtimeIdentityCaptures[]`，不动现有 `visualCaptures[]`）：

```jsonc
{
  "checkId": "<runId>-<viewport>", "route": "/", "state": "rendered",
  "viewport": { "width": 1280, "height": 800 },
  "baseline":  { "snapshot": { "path": "identity/<dir>/baseline-identity.json", "sha256": "…" } | null,
                "failure": null | "<bounded reason>" },
  "candidate": { "snapshot": { "path": "…", "sha256": "…" } | null, "failure": null | "…" }
}
```

- 路径白名单：`^identity/[a-z0-9-]{1,32}/(baseline|candidate)-identity\.json$`，
  与现有 `CAPTURE_PATH` 同强度（防 manifest 路径逃逸）；
- 文件大小上限沿用 geometry 的 16 MB 档；超限**整份拒收**（host 记
  failed 条目），不允许截断——截断的 records 会让"逐实例恰好一条"硬规则
  （合同 v2 §2-1）静默失真；
- records 规模：collector 现采集全文档标注元素。极端大页面按视觉合同同
  策略（合同 v2 §14：运行点拆分）；E 侧不加静默截断，超限即拒收并留原因。

## 4. 绑定：快照、版本摘要、工件哈希

| 绑定 | 谁产生 | 落到哪 | 说明 |
|---|---|---|---|
| snapshot SHA-256 | 容器 | manifest 条目 + `RuntimeRunIdentity.artifacts.snapshot` | 原始字节哈希，宿主读盘后复核 |
| geometry/截图 SHA-256 | 容器 | 现有 manifest（不变） | 与 snapshot 并列，四重关联之"工件哈希" |
| snapshot.page 三元组 | 容器（collector 读 location） | snapshot 内 + 宿主归档时校验 | 与该运行点 descriptor 的 route/suffix 摘要不一致 → 归档为带原因条目（page-context-mismatch） |
| sourceDigests（file → sha256） | **宿主**（容器无源码访问） | `RuntimeRunIdentity.sourceDigests` | 按侧绑定 projectRoot / candidateRoot，运行开始时 memo 固化（合同 v2 §8.2），recipe 用 D2 公共函数 |
| 逐实例 assessment | **宿主** | `RuntimeInstanceAssessmentEntry[]` | 宿主对每个 record 各调一次 assessRuntimeIdentity |

容器不计算、不猜测任何来源摘要（E 永不自哈希源码）；容器职责止于
"snapshot 原样落盘 + 哈希入 manifest"。

## 5. 失败与降级处理（fail-closed）

| 情形 | 容器行为 | 宿主行为 | 结果 |
|---|---|---|---|
| collectorSource 未下发 / collector 抛错 | snapshot=null + failure 原因 | 该侧无快照记录 | E 标 not-run；不得引用实例（合同 v2 §5） |
| 写盘失败 / 超限 | 该侧 failure 原因；**不中断其余运行点** | 按 failure 处理 | 其余 check 继续（与视觉采集同策略） |
| manifest 记录路径/哈希不合法 | —（白名单拒绝） | 拒收，failed 条目 | 同 attach 现有 integrity 语义 |
| snapshot 字节 ≠ manifest 哈希 | — | 拒收，failed 条目 | 同现有 SHA-256 双核验 |
| snapshot.page ≠ descriptor route | 照常归档（容器不裁决） | 归档为带原因条目（page-context-mismatch） | 不静默丢弃 |
| 版本不符 / 页面不符（评估期） | — | assessment.reasons 原样入档 | 逐实例降级，见合同 v2 §5 矩阵 |
| 候选重跑后过期 | — | 既有 manifest 身份绑定校验（runner 已核 candidateId/patchHash/digests）拦截 | 走既有 stale 路径 |
| 归档失败运行点 | **不得静默省略** | 带原因保留（合同 v2 §2-4） | 与 E"缺失证据不发明"一致 |

## 6. 与 C+D 接口对照

| 接口 | C+D v2 口径 | E 侧落点 | 状态 |
|---|---|---|---|
| sourceVersion 摘要 recipe | `sha256(原始文件内容 utf8)`（插件注册用 transform 输入 code 计算，v2 §8.1）；宿主 fileDigest 必须同 recipe，建议冻结公共函数（D2） | E attach 现有 `sourceFileDigest` 来自 C+D `project.ts`，需 A 确认与 D2 函数同口径后统一 | **待 A 冻结 D2**；口径漂移会导致 source-version-mismatch 误报 |
| expectedPage 三元组 | 严格证明路径宿主传完整三元组（裁决④）；samePage 逐字段可选只是传参问题（v2 §8.4） | E 只消费 assessment 结论；冻结前不清除 search/hash 缺失标记 | **待 A 裁决严格度**（可与 ①②③ 并行，不阻塞归档开发） |
| 多实例逐条 Assessment | `assessments.length === snapshot.records.length`，逐 record 调一次；一对不污染其他对（v2 §2） | E `visual-geometry.ts:640` 判定位改按 (side, sourceRef/instanceId) 键控逐对核验 `instanceIdentityProven===true` | **E 实施项**，冻结 ③ 后开工 |
| 跨版本实例对应 | **A v1 §3 冻结（六项全满足）**：双侧 `instanceIdentityProven===true`；双侧 `runtimeInstanceId` 相等、非空、≠sourceRef；双侧 sourceRef 相等；双侧 snapshot.page 三元组一致且等于 expectedPage；按 id 唯一配对（禁数组序，配不出唯一对 → 全部降级）；reason 新增 `cross-side-assessment-mismatch`（词表 13→14）。**与 C+D v2 四支柱冲突**（四支柱的"图侧来源对应""id 相等既不必要也不充分"与 A v1 第 3/4 条直接矛盾），以 A v1.1 为最终权威，v1.1 前按 A v1 执行 | E 视觉配对继续用 sampler 数据，对外措辞区分"候选配对"与"宿主实例证明"；配对升级只消费宿主按 A v1 §3（及 v1.1）给出的回执，E 不实现四支柱 | **A v1 已冻结，v1.1 修订中**；v1.1 出具后 E 核对消费口径 |
| 严格证明与视觉观察独立 | #3/#6/#8/#9 locatable=true 而 instanceIdentityProven=false 全程独立（v2 §7） | E view 的两层（identityStatus vs crossVersion.scope）天然分离，保持 | **已对齐**，无需改动 |
| 侧别组织形式 | 每侧一条 vs 双侧分组，A 二选一（v2 §2） | 容器侧两种形状都不变（per-side 写盘） | **待 A 冻结 D1** |
| 归档过渡方案 | 字段冻结前先按 Evidence 工件归档，冻结后双写迁移（D5，C+D 认可） | 本设计即工件方案；model.ts 冻结后宿主双写 | **待 A 确认 D3/D4**（写入权、保留期） |

## 7. 测试矩阵（容器归档层，增补至既有九项）

| # | 用例 | 预期 |
|---|---|---|
| A1 | 正常采集，collector 可用 | 双侧 identity 工件落盘；manifest 记录 path+sha256；宿主读盘哈希一致 |
| A2 | collectorSource 缺失（旧 input.json） | snapshot=null + failure；宿主 not-run；geometry/截图不受影响 |
| A3 | collector 抛错 | 同 A2，reason 带 bounded 诊断 |
| A4 | manifest 哈希与字节不符 | 宿主拒收，failed 条目 |
| A5 | 路径白名单外（如 `../../x`、双扩展名） | 宿主拒收 |
| A6 | snapshot.page 与 descriptor route 不一致 | 宿主归档为带原因条目（page-context-mismatch），不静默丢弃 |
| A7 | 文件超限 | 容器该侧 failure；宿主 failed 条目；其余运行点继续 |
| A8 | 多实例 records | 宿主逐 record 各得一条 assessment；任一条降级不污染其他条 |
| A9 | 写盘失败（磁盘/权限） | 该侧 failure；验证本身不受影响（fail-closed 到视觉层既有语义） |
| A10 | 与九项矩阵 #7（快照缺失）/ #9（多视口）联跑 | 各视口各状态独立归档、独立降级，不互相覆盖 |

既有九项矩阵的联合 CI 分工按合同 v2 §9-⑤：C+D 原型 10 项 + E 容器矩阵
（A1–A10 + 九项）+ A 集成预演汇总。

## 8. 正式编码所需条件

1. A v1（`9c2c780`）已冻结 ①–⑤ 与数据结构；跨版本严格配对以 A v1.1 为最终
   权威（v1.1 出具前按 v1 §3 六项执行，E 不采用 C+D 四支柱升级）；
2. **职责确认（A v1 §2/§6 冻结）**：容器双侧归档与宿主评估写入 **A 负责**
   （C+D 会签评估语义）；本设计的容器实施方案（§10 清单）移交 A 执行，
   E 不改动 A 负责的核心文件，除非 A 正式委派并指定独立工作分支；
3. A 批准 manifest 新段 `runtimeIdentityCaptures[]` 与 `identity/` 目录白名单
   的扩展方案（本设计 §3，属接线合同）；
4. 编码顺序（A v1 §6 冻结）：A ①容器归档 + servedSourceDigest 公共函数 →
   A ②宿主评估写入 runtimeIdentities（C+D 会签）→ **E ③配对层接线 +
   View additive 扩展（须在 A 完成 ①② 的集成预演分支上进行）** → F ④UI。
   E ③内容：`visual-geometry.ts:640` 判定修复（逐对核验
   `instanceIdentityProven===true`，非空口径废弃）、按 A v1 §4-4 的
   `crossVersion.pairs[]` additive 回执 `{recordKey, instanceIdentityProven,
   reasons}` + scope `provenance: 'host-assessed'`、View 证明等级与缺失原因
   展示（措辞待 F 会签）；宿主代核后 E 只消费 missingEvidence 清除结论。

## 9. 边界重申

不修改 model.ts / VerificationRun / 视觉证明升级逻辑 / Approval 门控；
PR #34 保持 Draft；不合并 main；不触发 Bolt。本设计全部内容在合同冻结前
不进入生产代码。

## 10. 容器归档实施清单（文件级，移交 A 执行）

负责人按 A v1 §2 冻结：T1–T6 属 A（容器归档与宿主写入），T7 为 A/C+D 会签
接口，T8 中 A1–A10 容器用例随 A ①② 落地、View 矩阵部分归 E ③。

| # | 任务 | 涉及文件 | 负责人 | 测试 | 验收条件 |
|---|---|---|---|---|---|
| T1 | sampler 透传完整 RuntimeIdentitySnapshot | `src/core/visual-geometry-sampler.mjs`（collector 可用时 snapshot 随 geometry 返回，失败 degrade null） | A | sampler 单测 + browser 用例 | collector 可用时 snapshot.records 完整透出；不可用/抛错时字段 null 且 geometry 其余字段不受影响（现有 10 用例不回退） |
| T2 | 双侧工件写入与 SHA-256 | `src/core/visual-capture-executor.mjs`（`writeIdentitySideArtifacts`，镜像现有 `writeVisualSideArtifacts`） | A | 执行器单测 | `identity/<viewport-dir>/<side>-identity.json` 落盘；manifest 记录 path+sha256；超限整份拒收并留 bounded 原因 |
| T3 | manifest `runtimeIdentityCaptures[]` 新段 | `src/core/candidate-verification-runner.mjs`（manifest 组装）+ `src/core/visual-capture-executor.mjs`（条目生成，含 failure 结构） | A | manifest 结构校验用例 | 键控 checkId×route×viewport×state；双侧独立条目；缺失/失败侧带 failure 原因不静默省略；既有 manifest v4 校验不回退 |
| T4 | `identity/` 路径白名单与文件上限 | `src/core/visual-verification-attach.ts`（或 A 指定的宿主读取点）白名单 `^identity/[a-z0-9-]{1,32}/(baseline\|candidate)-identity\.json$` + 16MB 上限 | A | 白名单正反例 | 逃逸路径/双扩展名/超上限被拒收为 failed 条目；合法路径可读 |
| T5 | 快照缺失/写盘失败/哈希错误的结果结构 | 容器侧：`visual-capture-executor.mjs` failure 条目；宿主侧：attach/归档读取点统一映射 not-run / 带原因保留 | A | A2–A5、A9 用例 | collectorSource 缺失→snapshot null+failure；哈希不符→拒收；写盘失败→该侧 failure 且其余运行点继续、验证不受影响 |
| T6 | 宿主读取、哈希复核与评估写入 | `src/core/verification-runner.ts`（定稿前写 `runtimeIdentities`）+ 归档核验（snapshot.page vs descriptor route、boundDigest 声明核验） | A（C+D 会签评估语义） | runtime-identity 词表 it.each 扩展 | 每 record 一条 assessment（recordKey=sourceRef#'#'+(id??'@'+index)）；逐条 `assessmentSha256`；归档失败以 `assessments=[]`+原因条目保留；接线前全部门控测试 `strictInstanceProofAvailable===false`，新增测试先红后绿 |
| T7 | 多实例逐条 Assessment 接口 | `src/core/runtime-identity.ts`（词表 13→14 加 `cross-side-assessment-mismatch`，C+D 维护）+ E 消费键约定 | A/C+D 会签 | 词表 it.each + 原型矩阵 | `assessments.length === snapshot.records.length`；一对不污染其他对；E 可按 (side, recordKey) 查单条 |
| T8 | A1–A10 及九项 View 矩阵 | A1–A10：容器归档测试（随 A ①②）；九项 View 矩阵：E ③阶段 `visual-evidence.browser.test.ts` / `visual-dual-targets.test.ts` 扩展 + F 会签 | A（A1–A10）/ E（View 矩阵，A ①② 预演分支上） | 联合 CI（A v1 §5：`runtime-identity.test.ts` + 视觉接线测试） | 正例真实浏览器产出、禁手工构造 passed；负例断言具体 reason（含 `cross-side-assessment-mismatch`）；Approval 门控测试不回退 |

E 侧（③，A ①② 集成预演分支上实施，独立提交）：`visual-geometry.ts:640`
判定修复、`crossVersion.pairs[]` additive 回执与 scope `provenance`、View 证明
等级展示；F ④会签文案后落地 UI。
