# Runtime Identity 合同权威登记

## 当前唯一权威版本

Runtime Identity 阶段二的唯一权威合同为 v1.2，正文位置：

`docs/architecture/runtime-identity-phase2-v1.2-draft.md`

已会签冻结提交：`0ba5c70ac9dfb3c3cc1a7606af38e37df7d758d7`  
该提交中的正文 Git blob：`8bbecf6e3f64db2b68506eedaa8eea709d1167de`

C+D 与 E 均对该确切提交完成正式会签：

- C+D：[PR #47 review 5642914485](https://github.com/Onesummer-D/Ripple/pull/47#pullrequestreview-5642914485)
- E：[PR #47 review 5642916504](https://github.com/Onesummer-D/Ripple/pull/47#pullrequestreview-5642916504)

该文档虽保留 `draft` 文件名以保持签署对象的字节和路径可追溯，自上述提交起状态为已冻结合同，不再是草案。任何语义变更必须创建新版本并重新取得 A、C+D、E 会签；不得在原路径静默修改。

## 历史版本

v1.1 冻结合同保留在原提交 `7b24e72b4dc2bba56c8b3f36e36fcd49b46fcaa5`，文件为：

`docs/architecture/runtime-identity-phase2-frozen.md`

v1.1 是不可变历史，不与 v1.2 并列作为当前规范。v1.2 明确列出的替代条款以 v1.2 为准；未替代的历史背景只用于追溯，不能覆盖 v1.2 的规则。

## 本集成分支约束

- `runtime-identity-page-namespace-v1.2-proposal.md` 等实现侧草稿不是规范来源；其规则必须服从已冻结 v1.2。
- 冻结合同区分 Verified Snapshot 与逐 record 实例身份证明。
- sourceRef 不同的记录在当前 v1/v2 身份协议下不进行严格跨侧配对。
- A②-3 与 E③ 仍是分开的后续门控；本登记和集成测试不代表正式 Runtime Identity 严格证明全链完成。
