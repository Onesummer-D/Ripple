# Remote media import design boundary

当前阶段只允许创建 `external-url-reference` provenance 记录，不允许 Ripple 服务端下载远程素材。

后续若要实现下载，至少需要在 A 和负责人批准后单独落码并验收：

- 每次 URL 解析和 301/302 跳转都重新阻断私网、回环、链路本地和保留地址，并处理 DNS rebinding。
- 限制响应大小、连接/读取超时、响应 MIME、图片魔数和完整解码；下载字节必须先冻结 hash，再进入内容寻址暂存。
- 记录最终 URL、逐跳 URL、解析 IP、响应头摘要、下载时间、源 hash 和用户明确授权。
- 不接受 URL 用户名/密码，不把 Cookie、Authorization 或服务器端凭据带到目标站点。
- 下载失败、超限、重定向不安全、MIME/魔数不符或源站变化都保持非通过状态。

阶段一记录只证明 URL 语法、可信授权回执和“不会抓取/不会暂存”的边界。含 URL 用户名/密码的输入拒绝；常见 token、key、auth、signature、secret、password、credential、session 和 access_code 查询值在 ledger 中置为 `[REDACTED]`。URL fragment 不保存。敏感参数识别是保守的键名规则，不覆盖路径中的秘密或所有厂商自定义参数。
