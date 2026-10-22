# B-ENV-1：Windows Git 换行转换与候选副本字节一致性

状态：已登记，待修复（P2）
负责人：A 协调；实现交 C+D 或协调人指定的工程 Agent
关联：与 Issue #6 的 AC-P2a / AC-P2b 分开排期；不阻塞 Linux 已验证 TEXT 闭环

## 1. 问题陈述

Windows 下 Git 的换行转换（`core.autocrlf`）使同一 blob 在不同工作树中以
LF 或 CRLF 字节物化。Ripple 的工程快照摘要（sourceDigest）、SourceGraph
解析产生的源码范围与 sourceRef 偏移、CandidatePatch 的字节绑定，均以
"某一 EOL 口径下的实际字节" 为输入。当输入快照的 EOL 口径与候选隔离
worktree 的检出 EOL 口径不一致时，摘要校验正确拒绝——但合法 Windows
工程因此无法稳定创建候选。

## 2. 可信复现（B @ 0bbe057 双检出策略验证）

固定目标：codescandy @ `b700bbd55b31a62fe04d4cd8210fc37232f0c9f0`。

| 工作树 | Overview JSX 来源偏移 | 快照摘要 vs 新建 worktree 摘要 |
|---|---|---|
| LF 检出 | `#2620` | 各自使用匹配的 autocrlf 策略时一致 |
| CRLF 检出 | `#2691` | 各自使用匹配的 autocrlf 策略时一致 |

- 原问题根因：Ripple 候选隔离检出策略与输入快照的 EOL 口径不一致。
- 早前 v1 手工转换造成的"额外摘要差异"已证实为实验伪影，不计入。

## 3. 涉及的实际字节口径（基线 3cc37c2 核实）

1. `readProjectSnapshot`：`snapshot.revision.sourceDigest` 基于原工程
   **工作树实际字节**（Windows autocrlf 检出下为 CRLF 字节）。
2. `src/core/candidate.ts:497`：候选隔离 worktree 以
   `-c core.autocrlf=false git worktree add --detach <rev>` 检出
   （LF 字节，等于 blob 字节）。
3. `src/core/candidate.ts:499`：`digestTrackedTree(candidateRoot) !==
   snapshot.revision.sourceDigest` 即抛 `CandidateError`——fail-closed
   语义正确，**必须保留，不得放宽**。
4. SourceGraph 解析与 sourceRef 偏移（`jsx:<file>#<offset>`）基于解析时
   所用文件内容的字节；快照与解析同一口径时内部一致，跨口径即漂移
   （#2620 vs #2691）。
5. 仓库根当前无 `.gitattributes`。

## 4. 修复方向（待评审，统一口径，不弱化门控）

**方向 A（推荐）：统一为 git blob 字节（canonical）。**

- `sourceDigest` 改为对 revision tracked blob 的字节摘要
  （`git ls-files -s` / `cat-file --batch` 口径，与检出无关）。
- SourceGraph 解析输入与 sourceRef 偏移基于同一份 blob 字节采集
  （`git show <rev>:<path>`），跨平台、跨 autocrlf 可复现。
- 候选 worktree 维持 `autocrlf=false` 检出（字节天然等于 blob 字节），
  现有 `candidate.ts:499` 校验逻辑不变。
- 错误提示分级：摘要不匹配时逐文件比对，检出 EOL 签名差异则明确提示
  「EOL 不一致（CRLF/LF），快照字节口径与检出不一致」并给出建议操作
  （`core.autocrlf=false` 重新检出 / 以 blob 口径重建快照 /
  `.gitattributes` 固定 eol），不再笼统报「摘要不匹配」。

**方向 B（备选）：检出策略跟随快照记录的 EOL 口径。**

- 快照额外记录其字节 EOL 口径；候选 worktree 按记录口径检出后校验。
- 缺点：EOL 口径成为可变状态，SourceGraph 解析偏移仍随口径漂移，
  跨平台复现性差，仅作回退方案。

### 待确认

- smudge/clean filter、LFS、既有 `.gitattributes` eol 规则项目的兼容口径。
- 多文件页面快照粒度与 E RFC 第 2 点（sourceVersion 粒度）联动。
- 方向 A 落地时，`readProjectSnapshot` 对**非 git 工程目录**（无 blob
  可取）的降级口径：以工作树字节为快照基准并显式记录 EOL 口径，候选
  侧按同口径物化后校验（等价于方向 B 的语义，仅限该降级路径）。

## 5. 明确禁止

- 不得归一化（normalize）安全哈希输入。
- 不得忽略字节差异或"容忍"摘要不匹配。
- 不得放宽 Candidate 门控或降级 `CandidateError` 的抛出条件。

## 6. B 测试工具后续（不属 A 公共核心，B 自行最小修复）

- `--expect accepted` 在成功候选字节验收前提前删除 worktree。
- 全局 `git worktree prune` 可能修改调用者 Git 元数据。

以上两项修复完成前，B 的测试工具不作为可复用的正式验收工具。
