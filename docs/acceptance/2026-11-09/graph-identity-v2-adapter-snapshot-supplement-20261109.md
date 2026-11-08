# Phase 1B-b 定点补充：不可变快照、E 重算与信任负例

状态：`evidence-only / design-review supplement`

本补充不新增生产状态枚举，不修改 `analyzeProject()`、GraphDigestV2 纯模块、PR #72 或 PR #75。文中 adapter 状态和诊断码是待 A/D/E 会签的设计候选，不是已冻结的公共 Schema。

## 1. 不可变快照衔接

### 1.1 方案 A：外部冻结 checkout，保持 `project.ts` 不变

方案 A 只有在分析器运行于真正不可写的来源快照时成立。普通目录的 `ReadOnly` 属性或工作树约定不足以构成冻结保证。

执行顺序：

1. 在临时隔离目录执行 clean clone，使用固定仓库和 commit；随后 `git checkout --detach <commit>`。
2. 读取 `git rev-parse HEAD`、`git rev-parse HEAD^{tree}`，并用 `git ls-tree -r -z --name-only HEAD` 得到 tracked file set。路径按 PR #72 的 `localeCompare(right, 'en')` 排序；集合重复、缺失或与期望清单不一致即停止。
3. 用 `git ls-files -s -z` 检查 mode。tracked symlink（mode `120000`）、特殊文件、checkout 外真实路径和无法读取的文件全部拒绝。来源路径只允许仓库相对 POSIX 形式。
4. 对每个 tracked 文件读取原始字节，记录 `{path, byteLength, sha256}`，并把这些字节放入不可变快照。快照必须是 OS 级只读/写时复制对象，分析进程及其父进程没有写权限；单纯 ACL 或 chmod 不满足本条。
5. 复现 `digestTrackedTree()` 的实际算法：

   ```text
   files = unique(trackedFiles).sort((a, b) => a.localeCompare(b, 'en'))
   for relative in files:
     bytes = exact snapshot bytes for relative
     hash.update(String(Buffer.byteLength(relative, 'utf8')))
     hash.update(':').update(relative).update(':')
     hash.update(String(bytes.byteLength)).update(':')
     hash.update(sha256(bytes)).update('\n')
   sourceDigest = hash.digest('hex')
   ```

   不做 LF/CRLF、Unicode NFC/NFD 或路径大小写归一化。
6. 在该 checkout 上调用现有 `analyzeProject(input, true)`。因为 API 仍从磁盘读取，方案 A 依赖快照的不可变语义，而不是假设 `analyzeProject()` 已接受字节映射。
7. 分析结束后再次读取 Git HEAD/tree、tracked file set 和每个绑定文件的字节哈希。任何变化、读取错误或快照对象被替换均返回 `unavailable`，不输出 GraphDigest。
8. Adapter 只使用步骤 4 的快照字节做 SourceMapping byte-span 验证；不得在 mapping 阶段重新读取可写路径。

### 1.4 字节级复算测试

适配器验收必须对同一批真实 tracked 文件字节分别运行现有 `digestTrackedTree()` 和独立复算器，并比较完整的 64 位小写 SHA-256。两条实现都必须保留文件路径排序、路径 UTF-8 字节长度、文件字节长度、每文件 SHA-256 和记录分隔符的原算法。

必须包含一组反例：将记录末尾的单个 LF 字节 `0A` 替换为两个 ASCII 字节 `5C 6E`（字符 `\\` 与 `n`）时，独立复算结果必须与生产算法结果不同；把 CRLF 当作 LF 也必须得到不同摘要。该反例只验证字节合同，不改变 GraphDigestV2 十字段或 domain。

### 1.2 方案 A 的边界

在 Linux 上，可用只读 bind mount、不可写容器层或等价的 filesystem snapshot；在 Windows 上，需要 ACL 之外的不可写快照/卷级复制，且必须证明分析进程不能获得写句柄。若运行环境只能提供普通目录，A 不能证明 analyzer 实际读取的字节，结果必须保持 `unavailable`。

### 1.3 何时转为方案 B

出现以下任一条件时，方案 A 不成立，应申请方案 B：

- 无法提供 OS 级不可变快照；
- analyzer 必须读取会被其他进程修改的工作树；
- 需要在内存中直接传入冻结文件字节而非路径；
- 需要证明每个 parser read 都来自同一份 byte buffer。

方案 B 才能修改生产接口，使 analyzer 接受 `FrozenSourceSnapshot` 或等价的 read-only byte provider，并禁止内部重新读取磁盘。该方案必须新增 A 文件白名单、适配器 API、测试夹具和性能评估；当前不授权。

## 2. 精确 fail-closed 条件

| 条件 | 结果 | 说明 |
| --- | --- | --- |
| HEAD/tree/tracked set 与期望不一致 | `unavailable` | 不是同一个源码快照 |
| tracked symlink、特殊文件、路径逃逸 | `rejected` 或 `unavailable` | 具体错误码由未来 adapter 合同冻结 |
| 快照文件字节变化或重读失败 | `unavailable` | 不能证明 analyzer 与 mapping 使用相同字节 |
| mapping path/charOffset/byteOffset/anchor 任一不一致 | `unavailable` | 不删除 graph/unresolved，不补造 mapping |
| registry 的 projectId、commit、tree、sourceDigest 不匹配 | `unavailable` | 本地路径派生 id 不可升级为 host identity |
| mapping 非唯一或冲突 | `unavailable` | 不依赖数组顺序、Relation ID 或 label 猜测 |

`rejected` 仅用于结构非法、未知字段、重复 ID、未知 endpoint 等纯模块/输入错误；`unavailable` 用于证据缺失、快照不可证明和宿主身份未验证。两种 adapter 状态均为本阶段设计候选，待 A/D/E 冻结。

## 3. E 的独立重算责任

E **可以**按同一份冻结 GraphDigestV2 合同独立重算 canonical bytes 和 domain-separated digest，并与 C/D 提供的 digest 比对。E 必须使用相同的十字段白名单、UTF-8 canonical JSON、排序规则、重复拒绝和 domain prefix；不能定义另一套 digest，也不能跳过 source snapshot、mapping、registry 或 producer evidence 的可信来源校验。

重算相等只证明内容摘要一致。E 仍需检查其 Host Binding 所引用的 GraphDigest、source snapshot、host registry 和 Producer/Provenance evidence；缺证据时保持 host binding unavailable，不把 digest 相等升级为 source proof 或授权。

## 4. 信任字段负例拆分

### 4.1 canonical Graph 内的未知信任字段

输入：在 GraphDigestV2 顶层、Node、Edge 或 SourceMapping 中加入 `trusted: true`、`runtimeProof`、`authorizationEligible` 等未知字段。

预期：纯模块 exact-field validator 拒绝，错误类别使用 PR #75 已冻结的 `graph-schema-invalid`；不计算 digest。

依据：PR #75 的 GraphDigestV2 十字段和嵌套字段白名单。此类输入是 malformed canonical Graph，不是 `unavailable`。

### 4.2 外部调用者自称 trusted 但没有宿主证据

输入：canonical Graph 结构本身有效，调用者另附 `{trusted: true}` 或 `sourceProof: 'host-claimed'`，但缺少可验证的 host registry、精确 checkout/tree、source snapshot 或 Producer evidence。

预期：纯模块仍只返回 `sourceTrust=content-only`；adapter 不接受该声明，返回 `unavailable`。建议诊断码 `host-evidence-missing` 仅作为待会签的 adapter diagnostics 候选，不加入 GraphDigestV2 公共 Schema。

这两类输入不能合并：第一类是结构拒绝，第二类是外部证明不足。两者都不得升级为 trusted、source-proven、runtime-proven 或授权资格。

## 5. 会签入口

- **A**：确认方案 A 的不可变快照前置条件、方案 B 转换条件，以及 adapter 状态/diagnostics 是否可作为后续合同候选。
- **D**：确认 `digestTrackedTree()` 字节算法复现、TOCTOU 失败处理和 canonical digest 重算责任。
- **E**：确认独立重算并比对 GraphDigestV2 的责任边界，不重定义 digest、不跳过来源校验。
- **B**：使用未修改 v5 matcher/probe 验证固定工程流程不会改变 AC6.2/AC6.4 统计或把 candidate 升级为 strict proof。

本补充不申请 Phase 1B-b Implementation ACCEPT。
