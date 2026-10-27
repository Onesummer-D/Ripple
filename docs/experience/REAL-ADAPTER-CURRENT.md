# v0.5 RC1 真实工作台能力说明

## 适用版本

- 版本：v0.5 RC1 candidate
- 精确 HEAD：`ed58cfdc2892acaa9b97363a3414b1c219d07053`
- Tree：`24de55f8bc1d8146b12b42b8bfdd4b24d5f41f6c`
- 使用形态：受控开发机、loopback API、可丢弃的 React/Vite 测试工程或备份副本

## 真实模式已接入

真实入口为 `experience.html?adapter=real`，可附带 `project=<本机工程路径>`。

1. `POST /__ripple/api/analyze` 分析工程并建立 SourceGraph。
2. `POST /project/preview` 建立隔离预演 iframe。
3. iframe 点选通过 nonce、previewId、projectId 和 sourceDigest 校验后进入 `POST /project/source-selection`。
4. 用户显式选择 Scope 后，`POST /candidate` 创建真实 Candidate。
5. `POST /candidate/preview` 展示候选预演。
6. `POST /candidate/verify` 生成四视口 VerificationRun、视觉证据和 Runtime Identity 回执。
7. `POST /candidate/approve` 只接受最新 passed VerificationRun。
8. `POST /candidate/apply` 和 `POST /candidate/rollback` 由服务端生命周期门控。
9. `GET /history` 提供候选、VerificationRun、证据和历史恢复数据。

界面只渲染服务端回执。generation、candidateId、runId 不匹配的迟到响应会被丢弃；UNKNOWN、RISK、STALE、未配对和来源不完整不会升级为 PASS。

## 证据与 SourceGraph 边界

- VersionFilmstrip 使用真实 artifact 时标记 `real-artifact`，演示素材标记 `demo-art`。
- 真实证据状态为 `archived / metadata / none`；缺失或加载失败可以手动重试。
- Runtime Identity 的 `archive failed`、`version-unverifiable`、digest mismatch、missing、duplicate、stale 和 Web Crypto unavailable 均保持 fail-closed。
- CSS Token 消费、selector/cascade、主题和媒体条件相关的 SourceGraph 候选关系只产生 `semantic-candidate`、`unknown` 和 `unresolved` 关系。AC6.2、AC6.4 未完成前，这些关系不能增加 Scope、Candidate、Verification、Approval、Apply 或 Rollback 授权。
- 精确源码位置的 `reads` 关系在满足来源图合同的场景下可以是 `source-proven`；这只证明源码读取锚点，不证明最终 DOM 消费、CSS 级联、主题/媒体激活、computed style，也不产生任何修改授权。

## 安全限制

- API 和本机预演默认只监听 loopback；不得把本地 API 直接暴露给公网或其他用户。
- 使用前应备份或复制测试工程。不要在未确认范围的生产工程上执行 Apply。
- Approval、Apply、Rollback 必须由用户在当前 Candidate 和最新 VerificationRun 上显式操作。
- 不把旧腾讯云静态 Demo、历史 #53 构建或任意截图当作 RC1 已部署证明。
- 云端认证、多租户会话、TLS 预演网关、并发配额和重启恢复属于后续版本。
