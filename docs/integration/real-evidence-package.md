# Real Evidence Package

Phase 04 的 adapter 接受一个 JSON 对象，最小字段是 `caseId`。`graph`、`slots`、`evidence` 和 `provenance` 都可以逐步提供；缺失或不完整的 Evidence 会保留为 `verification: "unknown"`，不会被 UI 当成确定结论。

```json
{
  "caseId": "third-party",
  "evidence": [
    {
      "id": "E-REAL-THIRD-001",
      "type": "RUNTIME",
      "route": "/showcase",
      "viewport": "375x812",
      "summary": "CTA token consumer",
      "sourcePath": "evidence/third-party/runtime.json",
      "screenshotPath": "evidence/third-party/showcase-375.png"
    }
  ],
  "provenance": {
    "repositoryUrl": "https://example.com/repository",
    "commit": "abc123",
    "tag": "v0.1.0",
    "license": "MIT",
    "noticePath": "NOTICE",
    "tokenSource": "src/theme/tokens.ts",
    "consumerPaths": ["/showcase", "/docs"]
  }
}
```

如果提供 `graph`，必须同时提供完整的 `nodes` 与 `edges`，并让 slot、instance、source 的稳定 ID 都能在图中找到；只需要补 Evidence 或 provenance 时可以省略 `graph`。

入口代码位于 `src/adapters/realEvidenceAdapter.ts`，`src/adapters/appAdapter.ts` 提供应用层注入点。默认 `realCasePackages` 为空，`appAdapter` 使用 Fixture，保持现有 UI 和编辑状态机不变。B 的真实包接入时将对应 `CaseId` 的原始 JSON 放入该 map 即可。

## 图片候选交接

A 的 MEDIA CandidateEdit.newValue 为 media://<resourceId>，并携带可选 mediaResource 元数据（id、name、mimeType、bytes、width、height）。图片数据保存在浏览器本地 IndexedDB 的 ripple-media/resources，adapter 可用 listMediaResources 读取完整 dataUrl。跨浏览器或离线交付时需要连同资源数据导出；media:// 引用不能直接当网络地址加载。当前本地海报仅用于 A 的交互演示，B 的真实浏览器结果继续通过 Evidence 接入。

## Evidence 资源与页面聚焦

sourcePath 如 evidence/qingye/overlap.json，应将文件放到 public/evidence/qingye/overlap.json；screenshotPath 同理映射到 public 下的图片。详情支持 JSON/纯文本内容、来源链接、截图打开。HTTP(S) 地址可使用，但远程来源预览需要服务允许 CORS。文件不存在或返回 SPA 首页时会显示不可用。

verification=unknown/loading 即使元数据完整也保留原状态。已支持的视口包括 375x812、768x1024、1440x900；Evidence 聚焦只改变查看路由与设备，不清除正在编辑的候选与范围。

A 页面 DOM 使用 data-case-id、data-route、data-slot-id、data-instance-id、data-source-id，供 B 按稳定标识追踪和测量。当前 A 的 qingye-layout JSON 是本地案例页面 QA，包含实际 DOM 矩形和共享/局部对照截图路径；它不代替 B 第三方原站分析包。
