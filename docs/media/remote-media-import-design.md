# Ripple MEDIA 远程媒体导入设计（接口 + 威胁模型，D 侧提案，2026-10-24）

状态：**仅接口与威胁模型，不含实现**；是否纳入后续版本由 A 决定（Issue #35 B3）。
前提：本地资产优先合同（`asset-import-contract-draft.md`）已成立；远程导入是其 `source.kind` 从 `local-file` 扩展到真实抓取的**显式授权扩展**，默认关闭。

## 1. 接口草案

```ts
interface RemoteFetchPolicy {
  allowedDomains: string[]        // 精确域名 + 可选子域开关；不支持通配全网
  maxRedirects: number            // 建议 ≤ 3
  maxBytes: number                // 建议 ≤ 15 MB（图片素材上限，可配）
  timeoutMs: number               // 建议 ≤ 10s（连接）/ 15s（整体）
  requireContentTypeImage: true   // 仅接受 image/* 且与魔数嗅探一致
}

interface RemoteImportRequest {
  url: string                     // https only（见威胁模型 T0）
  policyVersion: string           // 策略版本，进导入记录
  fetchedBy: string; fetchedAt: string
}

interface RemoteImportResult =
  | { ok: true; record: AssetImportRecord & { source: { kind: 'remote-fetch'; url: string; finalUrl: string; upstreamSha256: string; fetchedAt: string } } }
  | { ok: false; reason: 'blocked-domain' | 'private-address' | 'redirect-limit' | 'timeout' | 'too-large' | 'content-type-mismatch' | 'dns-rebinding-detected' | 'hash-unstable' | 'decode-failed' }
```

抓取成功路径与本地导入完全同构：字节 → `assertMediaSwapAsset` → 内容寻址暂存 → `AssetImportRecord` → 冻结进候选。远程导入**只多了取字节的一步**，校验、暂存、候选、生命周期全部复用，不引入第二条信任路径。

## 2. 威胁模型

| # | 威胁 | 缓解 |
|---|---|---|
| T0 | 明文 http / 凭证泄漏 | 仅 https；URL 不得含 userinfo（`user:pass@`）；禁止内嵌凭据 |
| T1 | 域名授权绕过 | 精确域名白名单 + 用户显式授权；白名单变更需审计日志；不支持"全网可抓" |
| T2 | 内网地址 / 元数据端点（SSRF） | 解析后对 **最终连接 IP** 做私网/保留段校验（10/8、172.16/12、192.168/16、169.254/16、127/8、::1、fc00::/7、fe80::/10、0.0.0.0）；DNS 结果逐条校验；任一命中即 `private-address` 拒绝 |
| T3 | DNS 重绑定 | 校验用 IP 与**实际连接用 IP 为同一次解析结果**（不允许校验后重新解析）；连接以 IP 进行并把 Host/SNI 固定为原域名；TTL 期间不二次解析 |
| T4 | 重定向绕过（302 到内网/白名单外域名） | 每跳重新执行 T1–T3；跳数 > `maxRedirects` 即 `redirect-limit`；最终 URL 域名也必须在白名单 |
| T5 | 超大响应 / 解压炸弹 | 流式读取，累计 > `maxBytes` 立即中止（不解码、不缓冲整体）；图片仅光栅格式，不解压归档 |
| T6 | 内容类型欺骗（SVG/HTML 脚本） | 双重校验：Content-Type 必须 image/*，且魔数嗅探（`sniffImageFormat`）一致；SVG 不在支持格式内（现有断言天然拒绝） |
| T7 | 慢速攻击 / 挂起 | 连接与整体双超时；超时即 `timeout`，不留半写入暂存（内容寻址只在完整字节后落盘） |
| T8 | 源站内容变化（TOC/TOU） | 抓取即冻结：记录 `upstreamSha256`，候选只认暂存字节；源站后续变化不影响已登记候选；**不回写源站** |
| T9 | 哈希不稳定引用 | 记录同时存 URL 与哈希；再次抓取同一 URL 若哈希不同，生成**新** importId，不产生覆盖 |
| T10 | 抓取侧工件污染 | 抓取失败不创建任何暂存条目；失败原因进记录（审计），无部分状态 |

## 3. 安全边界（不突破项）

1. 不改 A 核心 Approval / Scope / Verification 合同；远程字节与本地字节进同一条校验链。
2. 默认关闭：无白名单配置时远程导入一律 `blocked-domain`。
3. Verification 只 attest 本地暂存字节与候选产物；网络抓取行为本身不是可审计"证据"，证据链仍以浏览器观测为准。
4. 与 B 门控无关项不触碰；不因此放宽 MPA/unknown 影响的 fail-closed。

## 4. 与 B3 的关系

本设计对应 Issue #35 B3「方案一」的落地形态；「方案二（外链只读）」仍是默认行为。A 决策要点：

- 是否立项远程导入（产品范围）；
- 白名单与限额的默认配置值；
- `RemoteImportResult` 失败原因是否进入 B 侧审计合同。
