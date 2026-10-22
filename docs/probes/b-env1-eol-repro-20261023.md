# B-ENV-1 固定复现 v2：CRLF/LF 工作树 × Ripple 摘要合同（2026-10-23）

> 数据文件：`b-env1-eol-repro-20261023.json`（本目录，schemaVersion 2）。
> 复跑：`node --experimental-transform-types --loader ./scripts/ts-extension-loader.mjs scripts/b-env1-eol-repro.mjs <检出路径> [--selftest] [artifacts目录]`
> 第三方固定 SHA：`b700bbd55b31a62fe04d4cd8210fc37232f0c9f0`。
> **v2 安全模型：传入检出严格只读**（仅 git 读命令 + HEAD 校验）；全部实验在脚本自有
> 临时目录的两个独立 clone 中进行（LF clone / CRLF clone），异常时只清理该自有目录；
> 不使用 `git checkout -f` 或批量删除来"恢复"调用者工程。

## 结论先行（给 A 的判断材料，B 不提出修改要求）

1. **codescandy 的 git blob 全部是 LF**（`ProfileHeader.tsx` blob `a5b756e`，3517 字节）。
   CRLF 工作树只可能来自 `core.autocrlf=true` 的检出转换。
2. **CRLF 检出被 git 报告为"干净"**（两个 clone `git status --porcelain` 均为空）：
   Ripple 的 `readProjectSnapshot` 干净检查会放行，快照摘要按 CRLF 字节计算。
3. **Ripple 用 `-c core.autocrlf=false` 建候选 worktree，得到 LF 字节**，
   与 CRLF 快照摘要必然不一致 → "隔离 worktree 的检出字节与原工程不同"拒绝。
   `mismatchDemonstrated: true`，可稳定复现。
4. **B 不建议**把 ProjectRevision / CandidatePatch / 补丁范围 / 工作树完整性的摘要改为
   "归一化文本后计算"——这些摘要必须尊重真实字节。请 A 判断：修改**检出策略**
   （要求/固定 LF 工作树）、修改**源码版本合同**（快照记录 EOL 状态并在建候选时对齐）
   或其他方案。

## 实测记录（v2，同一 HEAD，脚本自有双 clone）

| 项 | LF clone（autocrlf=false） | CRLF clone（autocrlf=true） |
| --- | --- | --- |
| `ProfileHeader.tsx` 磁盘字节 | 3517（LF） | 3624（CRLF） |
| `git status --porcelain` | 空 | 空（干净） |
| 图内 Overview 字面量 id / 候选 start–end | `#2620` / 2620–2643 | `#2691` / 2691–2715 |
| Ripple 快照摘要 sourceDigest | `016aee03ac1a…` | `a3d59740fc5e…` |
| `git worktree add -c core.autocrlf=false` 摘要 | `016aee03ac1a…` | `016aee03ac1a…`（LF 字节） |
| `git worktree add -c core.autocrlf=true` 摘要 | — | `a3d59740fc5e…` |

### 关于"CRLF 原工程摘要 vs 新建 autocrlf=true worktree 摘要"（v1 疑问的解答）

v2 中两者**完全一致**（`a3d59740fc5e…`，逐文件比对 differingFiles=0）——clone 检出与
worktree add 使用同一个 git 换行过滤器，转换集合必然相同。

v1（手工 sed 转换法）曾测得第三个摘要 `bdb283ff3536…`：原因是手工转换把 git 视为
**非文本**的文件（部分 `.svg` 等）也转成了 CRLF，超出 git 过滤器范围。该值是测量方法
伪影，v2 的 clone 法已取代之，不复现。

因此**唯一有操作意义的不一致**是：CRLF 快照（`a3d59740…`）≠ Ripple 实际使用的
autocrlf=false 候选 worktree（`016aee03…`）。

## 文件安全负例（`--selftest`，本地与 CI 均通过）

- `dirty-source-read-only`：源 clone 带未提交修改 + 未跟踪文件时，measure 正确拒绝
  （ProjectReadError），且修改文件与未跟踪文件字节逐位不变；
- `sentinel-byte-invariance`：预存在的非自有目录及 sentinel 文件在全程后字节不变、目录未被删除；
- 源仓库四项（HEAD / 树摘要 / porcelain / worktree 列表）执行前后完全一致。

## 附带观察（如实记录，不定性）

- **`git -c core.autocrlf=true clone` 的策略不落盘**：`-c` 只作用于 clone 进程本身；
  若后续命令运行在默认 autocrlf=false 的环境（如 Linux CI），同一 CRLF 工作树会被
  `git status` 判为 dirty（168 个文件）——Ripple 在**快照干净检查**阶段即拒绝。
  Windows 上若机器默认 autocrlf=true，则同一棵树"静默干净"，Ripple 放行后在**候选
  worktree 字节一致性**阶段才失败。同一风险两条失败路径，阶段不同。
- Windows（git 2.47.1.windows.1）上 `git checkout -f` 在 autocrlf 切换后可能不重写
  工作树字节而维持 stat 缓存"干净"假象；判断干净不能只看一次 `git status`，需结合
  字节级校验。v2 脚本因此完全不依赖对调用者检出做任何恢复操作。
- 图偏移与候选偏移随 EOL 平移（+71 字节）；任何写入源码位置的工件必须携带 EOL 状态。
