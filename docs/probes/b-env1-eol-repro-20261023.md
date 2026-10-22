# B-ENV-1 固定复现：CRLF/LF 工作树 × Ripple 摘要合同（2026-10-23）

> 数据文件：`b-env1-eol-repro-20261023.json`（本目录）。复跑：
> `node --experimental-transform-types --loader ./scripts/ts-extension-loader.mjs scripts/b-env1-eol-repro.mjs <检出路径> [artifacts目录]`
> 第三方固定 SHA：`b700bbd55b31a62fe04d4cd8210fc37232f0c9f0`；脚本只操作该检出，结束后恢复原字节。

## 结论先行（给 A 的判断材料，B 不提出修改要求）

1. **codescandy 的 git blob 全部是 LF**（文本文件；`ProfileHeader.tsx` blob `a5b756e`，3517 字节）。
   Windows 上 CRLF 工作树只可能来自检出时的 `core.autocrlf=true` 转换。
2. **同一 HEAD 下，CRLF 工作树可被 git 报告为"干净"**（本机实测 `git status --porcelain` 为空）：
   这是 stat 缓存与换行过滤共同作用的结果——Ripple 的 `readProjectSnapshot` 干净检查因此会放行 CRLF 树，
   快照摘要按 CRLF 字节计算。
3. **Ripple 创建候选时用 `-c core.autocrlf=false` 新建隔离 worktree，得到 LF 字节**，
   与 CRLF 快照摘要必然不一致 → "隔离 worktree 的检出字节与原工程不同，拒绝对错位源码范围应用补丁"。
   这就是首轮实测遇到的拒绝的确定机制，现可稳定复现（`mismatchDemonstrated: true`）。
4. **B 不建议**把 ProjectRevision / CandidatePatch / 补丁范围 / 工作树完整性的摘要改为"归一化文本后计算"——
   这些摘要必须尊重真实字节，归一化会使摘要与实际补丁不一致。请 A 判断：
   是修改**检出策略**（要求/固定 LF 工作树），还是修改**源码版本合同**（例如快照记录 EOL 状态并在
   建候选 worktree 时显式对齐），或其他方案。

## 实测记录（同一 HEAD，两种工作树状态）

| 项 | LF 状态 | CRLF 状态 |
| --- | --- | --- |
| `core.autocrlf` | false | true |
| `ProfileHeader.tsx` 磁盘字节 | 3517（LF） | 3624（CRLF） |
| `git status --porcelain` | 空 | **空（干净，stat 缓存/过滤幻觉）** |
| 图内 Overview 字面量 id | `literal:…ProfileHeader.tsx#2620` | `literal:…ProfileHeader.tsx#2691` |
| 候选操作 start–end | 2620–2643 | 2691–2715 |
| Ripple 快照摘要（sourceDigest） | `016aee03ac1a…` | `bdb283ff3536…` |
| `git worktree add -c core.autocrlf=false` 摘要 | `016aee03ac1a…` | `016aee03ac1a…`（LF 字节） |
| `git worktree add -c core.autocrlf=true` 摘要 | — | `a3d59740fc5e…` |

要点：**图偏移与候选偏移随 EOL 平移**（+71 字节），任何把源码位置写进工件的流程都必须携带 EOL 状态，
否则 LF/CRLF 两环境下的证据无法对齐。

## 附带观察（如实记录，不定性）

- 本机（git 2.47.1.windows.1）上曾出现 `git checkout -f HEAD` 在 autocrlf 切换后不重写工作树字节、
  靠 stat 缓存维持"干净"假象的情况；删除文件后 `git checkout -- <path>` 才稳定按当前策略重检出。
  复现脚本的还原环节因此采用"删除受跟踪文件后整树重检出"并校验目标文件字节与 blob 一致。
- `git update-index --refresh` 在不同 autocrlf 策略下的输出也受该缓存影响；判断干净与否不能只看
  一次 `git status`，需结合字节级校验。
