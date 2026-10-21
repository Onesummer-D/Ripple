# 视觉差异合成样例

这些样例由 `src/core/visual-evidence-fixtures.ts` 确定性生成。生成方式是用整数矩形和带种子的“字形条”逐像素绘制，不经过浏览器，也不依赖任何字体。重新生成的命令：

```
npm run fixtures:visual-evidence
```

**来源声明**：descriptor 中 browser 字段为 `synthetic-scene-renderer`，URL 使用 `.invalid` 域名。这些样例只用于证明图像比较与几何算法正确，不是浏览器 Evidence，也不是 Bolt 或任何真实工程的验收结果。所有身份哈希都是固定字符串的 SHA-256。

每个目录包含以下文件：

| 文件 | 内容 |
| --- | --- |
| `input.json` | 请求本身，截图按文件名引用 |
| `baseline.png` / `candidate.png` | 两侧截图 |
| `expected-evidence.json` | 期望的 Evidence |
| `diff.png` | 差异图，仅在有变化或有抗锯齿像素时生成 |

`manifest.json` 记录了每个文件的 SHA-256。`src/core/visual-evidence-fixtures.test.ts` 会用已提交的输入重算 Evidence 并与期望结果比对。zlib 版本可能导致 PNG 编码字节不同，所以 diff.png 的字节哈希不参与比对，改为比对解码后的像素哈希。

| 目录 | 演示内容 | result |
| --- | --- | --- |
| target-text-change | 只有目标文本变化；URL query 被脱敏 | unknown |
| non-target-change | 目标变化，页脚背景也变化（review，不是 risk） | unknown |
| geometric-overlap | 目标变长，与段落、CTA 新出现重叠 | risk |
| dpr-mismatch | DPR 1 对 DPR 2 | unknown（不可比较） |
| page-extent-changed | 全页截图高度不同 | unknown（不可比较） |
| screenshot-missing | 缺少候选截图 | not-run |
| corrupt-png | 候选截图被截断到 64 字节 | failed-to-run |
| interaction-state-mismatch | 默认状态对菜单打开状态 | unknown（不可比较） |
| unchanged-insufficient-evidence | 截图相同，但缺少稳定性标记、哈希和几何数据 | unknown（不是 PASS） |
| identity-stale | 声称的 patchHash 已过期 | stale |
| antialias-noise | 只有按钮边缘有半覆盖像素 | unknown（unchanged） |
| target-unmapped | DOM 中找不到目标注解 | unknown（unattributed） |
