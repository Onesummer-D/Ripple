# A 解释卡与本轮完整体验独立审查

审查 Agent `/root/explanation_review`，2026-10-15。实现只读。结论 **PASS**，覆盖来源/范围解释、当前测量解读及本轮三种工作台宽度的完整交互验收。2026-10-14 的 PENDING 初审不作为通过依据。

## 审查结果

- 来源解释从 reads 边列出实际消费者。青野共享来源对应首页、活动页、专题页，独立 About 来源不加入共享清单。
- 局部/共享范围文字使用当前 ScopeDecision 的 affectedInstanceIds；两个操作按钮实际选择对应范围、切到候选模式并递增预演 revision。
- 结构记录附 Evidence ID，Fixture 明确标记示例；无可验证结构证据时显示待确认。本轮没有接入或声称完成 B 实包及第三方原站。
- 当前浏览器样本驱动重叠、裁切、颜色与矩形解释；每项观察绑定同一份 Evidence ID。缺失、unknown、loading 或缺少 measurement 时保持等待态。
- 页面、资源、范围、候选、视口、模式与 revision 变化使旧 sample 失效，解释卡没有独立缓存过期结论。
- 重叠只判断当前元素与 CTA 矩形交集；中心 cover 仅依据匹配的计算样式推导可见原图区域；颜色来自 computed style。没有把这些观察升级为审美、主体完整或整站合格判断。
- 界面明确“证据解读 · 本地规则”，未声称调用 LLM。
- Evidence 使用原生 dialog，具有名称、关闭按钮、Escape、当前 JSON 下载及聚焦当前预览行为。
- 查看 explanation-risk-375.png，中文、Evidence ID 和入口均正常换行，无横向溢出。375/768/1440 工作台浏览器用例均通过。

## 独立验证

独立执行 `npx vitest run src/preview/explanations.test.ts src/app/usePreviewMeasurement.test.tsx src/app/PagePreview.test.tsx`，3/3 文件、7/7 测试通过，零 skipped。包括 reads 消费者、局部范围、unknown/loading、裁切约束、颜色、消息来源/nonce 与 iframe 资源恢复生命周期。

已读取正式 formal-verification.json 和 verify-browser.txt，并独立计算当前 sourceDigest。

- sourceDigest 均为 `b06c3268974314723e42169b4003ab55821f42c50c47af1d2e79feb5ac815640`。
- typecheck、build、test、browser 均 exitCode 0。
- 正式 unit 43/43 通过；Chrome 6/6 通过。
- 新浏览器断言验证风险→未重叠、解释 Evidence ID 与测量 ID 匹配、详情 JSON/下载/Escape、解释卡局部操作、媒体尺寸及裁切建议、Token 计算颜色。

本轮没有未解决阻断项。PASS 不代表整个 A 项目最终交付完成；B 真实分析包、第三方原站和其他交付阶段不在本次用户限定范围内。
