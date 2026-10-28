# UI-RC2 Demo Content Contract

状态：待 UI Agent 会签；仅适用于 Demo Adapter，不能替代 Real Adapter 或 SourceGraph 合同。

## 基线

- 开发 Base：`feat/a-v06-base-20261028 @ 5b75fe699afce98638e6fd6ad110911d83389dc8`
- 分支：`feat/f-ui-rc2-20261028`
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

## UI Agent handoff checklist

- [ ] Confirm the `DemoContentRegistry` shape and `schema` version.
- [ ] Provide four page structures and assets for Home, Products, Seasonal and Contact.
- [ ] Mark Home/Products/Seasonal shared TEXT consumers explicitly.
- [ ] Keep Contact UNKNOWN reasons and `selectableElement` absent for unknown content.
- [ ] Keep Demo selector IDs compatible with existing `canvas-el-*` and `data-xp-demo` test contracts.
- [ ] List any new slots or visual assets before wiring them into `demo-adapter.ts`.
