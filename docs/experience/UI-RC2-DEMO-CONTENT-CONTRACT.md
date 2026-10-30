# UI-RC2 Demo Content Contract

状态：UI-RC2 阶段一交付已完成，F/UI 会签记录已补齐；PR #67 保持 Draft 等待外审。本文仅适用于 Demo Adapter，不能替代 Real Adapter 或 SourceGraph 合同。

## 基线

- 开发 Base：`feat/a-v06-base-20261028 @ 5b75fe699afce98638e6fd6ad110911d83389dc8`
- 分支：`feat/f-ui-rc2-demo-20261028`
- 交付：PR #67，阶段一 P1 目标去重整改与 E2E 回归随本分支提交；Token、SiteHeader 场景 B/C 仍未实现。
- 类型定义：`src/app/experience/demo-content.ts`

## 必须字段

每个 `DemoContentSlot` 必须显式包含：

- `pageRef`：元素所属页面，不能从当前浏览页推断。
- `slotId`：页面内稳定插槽 ID。
- `sourceKey`：Demo 共享来源键；它不是 Real `sourceRef`。
- `kind` 与 `original`：原文、富文本、图片素材或未知内容。
- `provenance: 'demo'`：所有素材都必须标记为 Demo。
- `consumers`：共享来源的页面消费关系、确定性、原因和可选初始 Scope 建议。
- `unknownReasons`：部分证明或未知关系的可见原因。
- `notEditableReasons`：不可编辑时必须保留的原因。

可选择元素通过 `selectableElement` 映射到 ViewModel 的 Demo 元素 ID 和 Demo selector。该 selector 只用于模拟画布点选，不能被解释为 Real `sourceRef`、Runtime Identity 或授权凭据。

页面结构由 `DemoContentPage.structure.blocks` 描述。Block 只引用同页 `slotIds`，不得跨页借用当前浏览上下文改变元素归属。

## 共享 TEXT 示例

```ts
defineDemoContent({
  schema: 'demo-content/v1',
  provenance: 'demo',
  pages: [
    {
      pageRef: 'page:home',
      label: '首页',
      path: '/',
      provenance: 'demo',
      structure: { schema: 'demo-content/v1', blocks: [] },
      slots: [{
        pageRef: 'page:home',
        slotId: 'home.hero.title',
        sourceKey: 'campaign.hero.title',
        kind: 'text',
        original: { kind: 'text', text: '秋日茶器市集' },
        provenance: 'demo',
        selectableElement: {
          elementId: 'el:hero-title',
          selector: '[data-xp-demo="hero-title"]',
          label: '活动标题',
          editable: true,
        },
        consumers: [
          { pageRef: 'page:home', relation: 'editing', certainty: 'source-proven', reason: 'fixture owner', defaultScope: 'include' },
          { pageRef: 'page:products', relation: 'same-source', certainty: 'source-proven', reason: 'same sourceKey', defaultScope: 'include' },
          { pageRef: 'page:seasonal', relation: 'unproven', certainty: 'partial', reason: 'conditional campaign branch', defaultScope: 'undecided' },
          { pageRef: 'page:contact', relation: 'unproven', certainty: 'unknown', reason: 'no proven consumer edge', defaultScope: 'undecided' },
        ],
        unknownReasons: [],
        notEditableReasons: [],
      }],
    },
  ],
})
```

## Projection and lifecycle boundaries

1. Demo candidate projection is a pure function of page identity, slot ownership, `sourceKey`, `consumers`, ScopeDecision, certainty and draft text.
2. `include` may show a Demo candidate only when the consumer relation is source-proven. `exclude` and `protect` keep `original` and show the reason.
3. `partial` and `unknown` keep the baseline and show insufficient evidence or unverified preview. They must not be described as “safe no impact”.
4. Contact may render normal content while retaining `unknown` provenance and no editable mapping.
5. Page navigation changes browsing position only. It must not clear the active Demo target, draft, Scope or candidate layer.
6. Target changes, draft edits, Scope revisions and history selection follow the existing invalidation rules.
7. The registry must never call Project API or create Candidate, VerificationRun, Approval, Apply or Rollback records.

## UI Agent 会签与交付记录

以下内容按 UI-RC2 交接素材和当前实际渲染逐项核对，作为 F/UI 的阶段一接口会签记录：

| 项目 | 已核对内容 |
|---|---|
| 四页内容与素材 | Home `/` 使用 `hero-market.jpg`；Products `/products` 使用 `vessels.jpg`、`workshop.jpg`；Seasonal `/seasonal` 使用 `seasonal.jpg`；Contact `/contact` 有完整联系内容与表单，但所有来源关系保持 UNKNOWN。 |
| 共享标题 | `campaign.hero.title`，fixture 所属页为 Home；Products、Seasonal 是 source-proven 消费者；Contact 没有证明消费边，不能编辑或替换。 |
| 共享促销横幅关系 | `campaign.seasonal.banner` 与 `data:seasonal-banner` 是当前 Demo 的独立/partial 场景，不宣称与共享标题同源，也不进入真实授权。UI 设计中的共享促销横幅场景保留为后续 Demo，不扩大本轮核心语义。 |
| 三场景演示脚本 | A：选择共享标题 → 输入草稿 → 候选层切换 → Home/Products/Seasonal 逐页核对；B：Products protect/exclude、Seasonal partial、Contact unknown 展示 fail-closed 原因；C：切换 Demo/Real 与历史版本，验证 Demo 素材不进入真实生命周期。 |
| 合同与 testid | `DemoContentRegistry` 为 `demo-content/v1`；四页 `pageRef`、slot、sourceKey、provenance、consumer、UNKNOWN 原因均显式定义；`canvas-el-*`、`data-xp-demo`、PageRail 和既有生命周期 testid 保持兼容。 |

Token、SiteHeader 场景 B/C、Real Adapter、SourceGraph、Candidate、VerificationRun、Approval、Apply、Rollback 均不在本轮实现范围内。
