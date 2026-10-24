# AC-P6 阶段一：Token 来源元数据与执行合同边界

状态：C+D 阶段一独立审查修订稿。本文只定义来源元数据切片，不宣称已经实现 Token 作用域分析。

## 1. 依据与目标

本阶段以公共基线 `feat/project-first-core-20261018 @ 1373ca2e20c56f59cf633a005100c2aa1d2a1bc0` 为起点，保留原 C+D dirty 工作树中的 Runtime Identity、B1 及其他 Agent 成果，不将它们带入本分支。

本阶段只解决一个问题：在现有 SourceGraph 的 token 节点上记录声明来源类别，并证明这项元数据不会改变已有的节点身份、声明值、`uses-token` 关系、`unresolved` 或 PageImpact 语义。

## 2. 字段合同

公共类型新增：

```ts
type TokenOrigin = 'css-custom-property' | 'tailwind-palette'

interface SourceNode {
  // ...existing fields
  tokenOrigin?: TokenOrigin
}
```

`tokenOrigin` 是粗粒度来源标签，仅用于声明 provenance：

- CSS 自定义属性声明标记为 `css-custom-property`。
- Tailwind 调色板字面量标记为 `tailwind-palette`。
- 字段只对 `kind: 'token'` 节点有意义。

它不是 CSS selector、主题、`@media`、级联、继承或 DOM 消费者作用域证明。它不表达 selectorScope，也不参与精确消费者归因。当前不实现完整 selector/cascade 算法；同名声明不能因为名字相同而自动合并，也不能因此生成确定性的 CSS 消费关系。

SourceNode 的序列化保持向后兼容：字段是可选的，旧图可以没有它，读取方必须把缺失字段视为 unknown provenance，而不是推断作用域。字段名称、类型、序列化兼容性、是否需要 schema 版本或适配层，以及未来 `selectorScope` 的扩展位置，均需 A 在合并前会签。

## 3. 本阶段实际实现

- `src/core/model.ts` 增加 `TokenOrigin` 和可选 `SourceNode.tokenOrigin`。
- `src/core/project.ts` 在 CSS 自定义属性和 Tailwind 调色板 token 节点创建处写入来源标签。
- 原有 token label、value、id、节点位置和 `uses-token` 关系保持原逻辑。
- 不改变 PageImpact、`unresolved`、任何 Candidate/Scope/Approval/Verification 门控。
- 对同名多主题 CSS 声明分别保留节点；没有 selector 消费证明时维持 unknown。

## 4. 明确未实现

以下能力不属于本切片：

- `selectorScope` 身份及同名多作用域声明集的消费映射。
- CSS 级联、继承、主题和媒体条件求值。
- HashRouter 页面来源证明。
- 动态 DOM 消费锚点和元素锚点传播。
- computed-style 正式 VerificationRun 证据。
- CSS Token Candidate 执行器。

因此，“已记录 Token 来源类型”不得表述为“已支持 Token 作用域分析”。所有无法由静态来源证明的关系继续使用 unknown/未解析语义，并保持现有 fail-closed 门控。

## 5. 归属与依赖顺序

| 顺序 | 归属 | 交付 |
| --- | --- | --- |
| 1 | B | 固定 `webportflio` SHA `b244f85` 的真实浏览器样式基线；只能作为基准，不能替代正式 Candidate/Verification 证明 |
| 2 | C+D | Token 来源标签、声明节点身份、已有消费关系和 PageImpact 保持，后续再接元素锚点与 HashRouter 建模 |
| 3 | A | Token Candidate 执行合同、Scope 决策持久化、selectorScope 扩展位置 |
| 4 | B + C+D | 经过正式合同约束的 DOM 元素消费锚点 |
| 5 | A | computed-style VerificationRun 正式证据结构与门控 |
| 6 | F | Token 修改输入、范围选择、验证和历史展示 |

来源元数据本身不能产生 PASS，也不能绕过 A 的 Candidate、Scope、Approval 或 Verification 门控。

## 6. A 会签清单

A 在公共基线合并前确认：

1. 字段名 `tokenOrigin` 和联合类型是否接受；
2. 旧 SourceNode 序列化读取是否兼容；
3. 是否需要 schema 版本或适配层；
4. 下一阶段正式 `selectorScope` 应落在哪个扩展位置；
5. 本轮最小 diff 是否可以安全进入公共开发基线。

## 7. 回归验收

本分支测试覆盖：CSS 自定义属性来源、同名双主题声明的隔离和 unknown、Tailwind 来源及原有关系、无选择器消费证明时的 unknown、普通 TEXT/MEDIA 节点不受影响，以及相同夹具下图节点/边/未解析/PageImpact 的行为不变性。

必跑命令：

```text
git diff --check
npx vitest run src/core/project.test.ts
npx vitest run src/core/scope.test.ts
npm run typecheck
npm run build
npx vitest run
```

推送和正式 GitHub CI 只在网络可用时执行；若环境无法连接 GitHub，交付独立分支、提交 SHA 和可复制的推送命令，不修改原 dirty 工作树。
