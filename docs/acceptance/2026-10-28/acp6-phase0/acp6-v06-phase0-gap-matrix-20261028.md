# AC-P6 v0.6 Phase 0 机器缺口矩阵

> 本文件是独立派生设计资产，不修改生产代码、B v5 matcher 或原始验收 JSON。

## 来源与生成规则

- 原始证据：`D:/Onesummer_D/Learning/Competitons/ShuMei_QG/Ripple涟漪/_scratch/acp6-pr61-2ebd1e20-independent-20261027/acceptance-2ebd1e20-final.json`
- 原始证据 SHA-256：`289edde457393f499bf53ecd85379b874e6bde4782949e08418194723cc0571b`
- B 验收证据来源 HEAD：`2ebd1e20d043287edbbfc2ec31c10f15688a4499`；其原始 base：`0c02b85cdf7b1d52821fee3e06c013cbd664efa8`
- 本次 Phase 0 执行基线：`5b75fe699afce98638e6fd6ad110911d83389dc8`（远端已核验）
- 固定工程：`allanhue/webportflio@b244f857457d2a07f118155602eef9097fd322bd`
- 生成规则：`acp6-v06-phase0-rules-20261028-r2`
- 稳定 ID：SHA-256(`acp6-v06-phase0-row|token|file|byteOffset|selector`) 的前 16 位，前缀为 `acp6-gap-`。
- 原始 JSON 未被覆盖；本矩阵只增加派生分类和一致性元数据。

## 原始 B JSON 来源对照

派生矩阵实际使用本地精确复跑文件：

- 路径：`D:/Onesummer_D/Learning/Competitons/ShuMei_QG/Ripple涟漪/_scratch/acp6-pr61-2ebd1e20-independent-20261027/acceptance-2ebd1e20-final.json`
- 大小：1,035,281 bytes
- SHA-256：`289edde457393f499bf53ecd85379b874e6bde4782949e08418194723cc0571b`
- 生成来源：PR #61 精确 HEAD `2ebd1e20d043287edbbfc2ec31c10f15688a4499`，冻结 B v5 probe/matcher，退出码 2（3 PASS / 2 PENDING / 0 ERROR）。
- JSON.parse：成功。

GitHub B 归档文件：

- [acceptance-ed58cfd-final.json](https://github.com/Onesummer-D/Ripple/blob/evidence/pr65-acp6-ed58-independent-20261028/evidence/acceptance-ed58cfd-final.json)
- 大小：802,145 bytes
- SHA-256：`b7500c9d5fc1b4c99bea8b889fa195915172abe8bc7ed9ccada52c64a3d037a4`
- 项目 SHA：`b244f857457d2a07f118155602eef9097fd322bd`；A core：`ed58cfdc2892acaa9b97363a3414b1c219d07053`。
- JSON.parse：失败，byte 378,995（line 11,201 column 50）；未修补、未替换。
- 对原始字节做非修改式局部提取仍得到 consumerGroups=123、uncoveredConsumerPairs=16（静态 9、动态 7），但该文件没有可 JSON.parse 的 AC6.2 declarationSetCoverage，因此不能从它直接重提取 85/38。

结论：本派生矩阵没有冒充或覆盖远端 B 文件；123/85/38 来自 JSON.parse 成功的本地精确复跑文件，并在矩阵中同时保留远端 SHA 与解析失败事实。

## B 结果一致性快照

| 指标 | 派生矩阵 | B 原始期望 |
|---|---:|---:|
| source-use rows | 123 | 123 |
| covered | 85 | 85 |
| uncovered | 38 | 38 |
| Token count | 8 | 8 |
| 未闭合 Token | 7 | 7 |
| AC6.4 consumer pairs | 147 | 147 |
| AC6.4 static anchors | 131 | 131 |
| AC6.4 UNKNOWN | 16 | 16 |

## 五类 gapClass

- taxonomyVersion：`acp6-gap-taxonomy/v1`（本轮提出，等待 A 最终确认）。

| gapClass | 行数 | 规则 |
|---|---:|---|
| selector-owner-unresolved | 24 | Global/element/pseudo selector or no unique JSX/DOM owner; no static source anchor is safe. |
| dynamic-className | 9 | Selector class is listed in the B dynamic-className consumer set; runtime observation is required. |
| theme-cascade-ambiguity | 1 | Theme selector or active declaration/cascade state is not proven by static source graph. |
| complex-selector-normalization | 0 | Selector list/combinator/newline/escaped span needs branch-preserving normalization before matching. |
| candidate-without-strict-edge | 4 | A candidate consumer exists but no strict source edge was emitted; candidate is not proof. |

| 新分类 | 旧分类覆盖 | 处理说明 |
|---|---|---|
| `selector-owner-unresolved` | `no-static-element-anchor`、`pseudo-element-or-generated-content`、`global-or-theme-selector` 的 global/element 部分 | 合并所有“没有唯一 JSX/DOM owner”的静态缺口；pseudo 可作为次级原因。 |
| `dynamic-className` | `dynamic-or-ambiguous-class` 的证据明确为动态 className 部分 | 只采用 B 已提供的动态 className 文件/类名证据；一般歧义不直接归入此类。 |
| `candidate-without-strict-edge` | `candidate-without-source-edge` | 保留候选存在但未生成 strict edge 的语义。 |
| `theme-cascade-ambiguity` | `global-or-theme-selector` 的 theme 部分及重复声明/级联歧义 | 只表示状态或级联尚未证明，不代表 selector owner 已证明。 |
| `complex-selector-normalization` | 同名旧分类 | 保留逗号、换行、组合器和转义 selector 的分支级规范化缺口。 |

原方案的 `pseudo-element-or-generated-content` 和 `global-or-theme-selector` 不再作为独立 primary 分类，但会通过映射表和 `gapClasses` 保留次级语义。

`primaryGapClass` 只表示首要阻断环节；`gapClasses` 保留次级原因。分类不会改变 B 的 covered、edge、UNKNOWN 或 PENDING 判定。

## 38 条未闭合行及全量行身份

矩阵保留全部 123 行；其中 38 行有 gapClass，85 行为 covered 且 gapClass 为 null。每行都携带原始 token、文件、offset、UTF-8 byteOffset、selector、candidateConsumers、linkedStrictEdges。

**动态记录边界**：AC6.2 的 `dynamic-className` 为 9 条 CSS source-use rows 的分类；AC6.4 的动态 UNKNOWN 为 7 个消费者 pair。两者来自不同层级的记录，不能按数量或 selector 推断一一映射。

| # | stable rowId | status | token | file | offset/byteOffset | selector | primaryGapClass | gapClasses | candidates | strict edges | source-use graphNodeIds |
|---:|---|---|---|---|---|---|---|---|---:|---:|---|
| 1 | acp6-gap-7681a1cbb8f0413c | covered | --text-primary | src/css/footer.css | 115/115 | .footer | — | — | 1 | 2 | missing |
| 2 | acp6-gap-3622ac946f5dca38 | covered | --text-primary | src/css/footer.css | 1192/1192 | .footer-section h4 | — | — | 2 | 2 | missing |
| 3 | acp6-gap-80f8f8307616027b | covered | --text-primary | src/css/nav.css | 681/681 | .nav-logo:hover | — | — | 1 | 2 | missing |
| 4 | acp6-gap-3b6136e218b1fd32 | covered | --text-primary | src/css/nav.css | 890/890 | .nav-link | — | — | 6 | 10 | missing |
| 5 | acp6-gap-772811fbc0457512 | covered | --text-primary | src/css/nav.css | 1211/1211 | .hamburger | — | — | 1 | 2 | missing |
| 6 | acp6-gap-1a07ac810794baae | uncovered | --text-primary | src/css/style.css | 995/995 | body | selector-owner-unresolved | selector-owner-unresolved | 0 | 0 | missing |
| 7 | acp6-gap-a99b0609ab86f64f | uncovered | --text-primary | src/css/style.css | 3320/3320 | .content h2 | selector-owner-unresolved | selector-owner-unresolved | 0 | 0 | missing |
| 8 | acp6-gap-12c7345a271c6404 | covered | --text-primary | src/css/style.css | 4497/4497 | .contact-form label | — | — | 1 | 2 | missing |
| 9 | acp6-gap-5fc08122bea47a3d | covered | --text-primary | src/css/style.css | 4703/4703 | .contact-form input,\n.contact-form textarea | — | — | 1 | 2 | missing |
| 10 | acp6-gap-f5f0d08a3b7886e8 | covered | --text-primary | src/css/style.css | 5457/5457 | .theme-toggle | — | — | 1 | 2 | missing |
| 11 | acp6-gap-a040cfff69fc21c4 | covered | --text-primary | src/css/style.css | 8459/8459 | .greeting h1 | — | — | 1 | 2 | missing |
| 12 | acp6-gap-af7e7830fa2a14a4 | uncovered | --text-primary | src/css/style.css | 10495/10495 | .btn-secondary | selector-owner-unresolved | selector-owner-unresolved | 0 | 0 | missing |
| 13 | acp6-gap-792185a53960990d | covered | --text-primary | src/css/style.css | 13210/13210 | .stat-number | — | — | 1 | 2 | missing |
| 14 | acp6-gap-38dd4f78f305a492 | covered | --text-primary | src/css/style.css | 13499/13499 | .skills-section h3 | — | — | 1 | 2 | missing |
| 15 | acp6-gap-b6507b0e953549fa | covered | --text-primary | src/css/style.css | 14193/14193 | .skills-section .skill-badge | — | — | 2 | 4 | missing |
| 16 | acp6-gap-494379191ec2ba4d | covered | --text-primary | src/css/style.css | 14956/14956 | .section-header h3 | — | — | 1 | 2 | missing |
| 17 | acp6-gap-01d38eadec5e0376 | covered | --text-primary | src/css/style.css | 15834/15834 | .project-header h4 | — | — | 1 | 2 | missing |
| 18 | acp6-gap-87857215a58d54b6 | covered | --text-primary | src/css/style.css | 17688/17688 | .contact-card h3 | — | — | 1 | 2 | missing |
| 19 | acp6-gap-04fc5fd5533c3338 | covered | --border-color | src/css/footer.css | 161/161 | .footer | — | — | 1 | 2 | missing |
| 20 | acp6-gap-bfacabea13b57d58 | covered | --border-color | src/css/footer.css | 2230/2230 | .social-icon | — | — | 3 | 6 | missing |
| 21 | acp6-gap-069212c8c2f62eea | covered | --border-color | src/css/footer.css | 2620/2620 | .footer-divider | — | — | 1 | 2 | missing |
| 22 | acp6-gap-c8b86a239f88cd41 | covered | --border-color | src/css/footer.css | 4479/4479 | [data-theme="light"] .footer | — | — | 1 | 2 | missing |
| 23 | acp6-gap-f39969fed0f7990b | covered | --border-color | src/css/footer.css | 4658/4658 | [data-theme="light"] .social-icon | — | — | 3 | 6 | missing |
| 24 | acp6-gap-8f1344622d75274e | covered | --border-color | src/css/nav.css | 173/173 | .nav-container | — | — | 1 | 2 | missing |
| 25 | acp6-gap-b67204d231e5653b | uncovered | --border-color | src/css/nav.css | 2061/2061 | .nav-links | dynamic-className | dynamic-className, candidate-without-strict-edge | 1 | 0 | missing |
| 26 | acp6-gap-16dc5d9eb24a4dc1 | covered | --border-color | src/css/style.css | 2818/2818 | .skills-grid > div | — | — | 3 | 6 | missing |
| 27 | acp6-gap-e2e5e10fb82cf5a2 | covered | --border-color | src/css/style.css | 3770/3770 | .stats-grid div | — | — | 1 | 2 | missing |
| 28 | acp6-gap-3961080530e5810e | covered | --border-color | src/css/style.css | 4612/4612 | .contact-form input,\n.contact-form textarea | — | — | 1 | 2 | missing |
| 29 | acp6-gap-0ee36268df344755 | covered | --border-color | src/css/style.css | 5365/5365 | .theme-toggle | — | — | 1 | 2 | missing |
| 30 | acp6-gap-87321cad295188a3 | uncovered | --border-color | src/css/style.css | 10537/10537 | .btn-secondary | selector-owner-unresolved | selector-owner-unresolved | 0 | 0 | missing |
| 31 | acp6-gap-3a9f56944909d61f | uncovered | --border-color | src/css/style.css | 10994/10994 | .social-links a | selector-owner-unresolved | selector-owner-unresolved | 0 | 0 | missing |
| 32 | acp6-gap-94b8fb684ea376dd | uncovered | --border-color | src/css/style.css | 12487/12487 | .stat-card | dynamic-className | dynamic-className, candidate-without-strict-edge | 1 | 0 | missing |
| 33 | acp6-gap-25033f92bac0ead7 | covered | --border-color | src/css/style.css | 14286/14286 | .skills-section .skill-badge | — | — | 2 | 4 | missing |
| 34 | acp6-gap-ab43f861e4be2c04 | covered | --border-color | src/css/style.css | 15478/15478 | .project-card | — | — | 1 | 2 | missing |
| 35 | acp6-gap-11c342f726cb237f | covered | --border-color | src/css/style.css | 17572/17572 | .contact-card | — | — | 1 | 2 | missing |
| 36 | acp6-gap-c4609510f77e7b44 | uncovered | --accent | src/css/footer.css | 600/600 | .footer-brand | selector-owner-unresolved | selector-owner-unresolved | 0 | 0 | missing |
| 37 | acp6-gap-1027a7455bb3d74f | uncovered | --accent | src/css/footer.css | 952/952 | .footer-cta | candidate-without-strict-edge | candidate-without-strict-edge | 1 | 0 | missing |
| 38 | acp6-gap-8cebe28b7de80471 | covered | --accent | src/css/footer.css | 1325/1325 | .footer-section h4 | — | — | 2 | 2 | missing |
| 39 | acp6-gap-dc96bd48e41e2565 | uncovered | --accent | src/css/footer.css | 1739/1739 | .footer-links li a:hover | selector-owner-unresolved | selector-owner-unresolved | 0 | 0 | missing |
| 40 | acp6-gap-460c622984ae9d97 | covered | --accent | src/css/footer.css | 2371/2371 | .social-icon:hover | — | — | 3 | 6 | missing |
| 41 | acp6-gap-17e038f806870668 | covered | --accent | src/css/footer.css | 2432/2432 | .social-icon:hover | — | — | 3 | 6 | missing |
| 42 | acp6-gap-f590c38d66d52f5e | covered | --accent | src/css/footer.css | 3045/3045 | .scroll-to-top | — | — | 1 | 2 | missing |
| 43 | acp6-gap-3e431957897adb9f | uncovered | --accent | src/css/footer.css | 4553/4553 | [data-theme="light"] .footer-brand | theme-cascade-ambiguity | theme-cascade-ambiguity, selector-owner-unresolved | 0 | 0 | missing |
| 44 | acp6-gap-52f50d80f289d159 | covered | --accent | src/css/interests.css | 157/157 | .interests-grid .card | — | — | 8 | 16 | missing |
| 45 | acp6-gap-56923cab340f259a | covered | --accent | src/css/nav.css | 581/581 | .nav-logo | — | — | 1 | 2 | missing |
| 46 | acp6-gap-fa87445de6eeca0c | covered | --accent | src/css/nav.css | 1067/1067 | .nav-link:hover | — | — | 6 | 10 | missing |
| 47 | acp6-gap-bc6fc7b767348c4e | covered | --accent | src/css/nav.css | 1444/1444 | .hamburger:hover | — | — | 1 | 2 | missing |
| 48 | acp6-gap-a07b7efaa938245c | covered | --accent | src/css/nav.css | 1514/1514 | .hamburger:focus-visible | — | — | 1 | 2 | missing |
| 49 | acp6-gap-e9cd71230c8fecdf | uncovered | --accent | src/css/style.css | 1998/1998 | .section-title | selector-owner-unresolved | selector-owner-unresolved | 0 | 0 | missing |
| 50 | acp6-gap-d81381d84c0356ee | uncovered | --accent | src/css/style.css | 2232/2232 | .section-title::after | selector-owner-unresolved | selector-owner-unresolved | 0 | 0 | missing |
| 51 | acp6-gap-b11568f8e63f06cb | covered | --accent | src/css/style.css | 2497/2497 | .experience-item | — | — | 2 | 4 | missing |
| 52 | acp6-gap-30305395e59fccf8 | covered | --accent | src/css/style.css | 2896/2896 | .skills-grid h3 | — | — | 3 | 6 | missing |
| 53 | acp6-gap-9b280c12225690cb | uncovered | --accent | src/css/style.css | 3231/3231 | .content h1 | selector-owner-unresolved | selector-owner-unresolved | 0 | 0 | missing |
| 54 | acp6-gap-575e4bc21bc5e381 | covered | --accent | src/css/style.css | 3847/3847 | .stats-grid h2 | — | — | 1 | 2 | missing |
| 55 | acp6-gap-fdd0a9e050c54406 | uncovered | --accent | src/css/style.css | 4227/4227 | .image-container img | selector-owner-unresolved | selector-owner-unresolved | 0 | 0 | missing |
| 56 | acp6-gap-44e51ee48330fc98 | covered | --accent | src/css/style.css | 4842/4842 | .contact-form button | — | — | 1 | 2 | missing |
| 57 | acp6-gap-e8087459138cbb21 | uncovered | --accent | src/css/style.css | 5143/5143 | .social-media a | selector-owner-unresolved | selector-owner-unresolved | 0 | 0 | missing |
| 58 | acp6-gap-226e3f18bce6f82d | covered | --accent | src/css/style.css | 5664/5664 | .theme-toggle:hover | — | — | 1 | 2 | missing |
| 59 | acp6-gap-b28782dc8cd54747 | covered | --accent | src/css/style.css | 5725/5725 | .theme-toggle:hover | — | — | 1 | 2 | missing |
| 60 | acp6-gap-d499b2e05a50e8a7 | covered | --accent | src/css/style.css | 8549/8549 | .name-highlight | — | — | 1 | 2 | missing |
| 61 | acp6-gap-a24853b5ecd1ca10 | covered | --accent | src/css/style.css | 8756/8756 | .name-highlight::after | — | — | 1 | 2 | missing |
| 62 | acp6-gap-e29cecb2c1316328 | uncovered | --accent | src/css/style.css | 9209/9209 | .company | selector-owner-unresolved | selector-owner-unresolved | 0 | 0 | missing |
| 63 | acp6-gap-91ab97ddc9309383 | covered | --accent | src/css/style.css | 10207/10207 | .btn-primary | — | — | 1 | 2 | missing |
| 64 | acp6-gap-8538bd1e7defa405 | uncovered | --accent | src/css/style.css | 10635/10635 | .btn-secondary:hover | selector-owner-unresolved | selector-owner-unresolved | 0 | 0 | missing |
| 65 | acp6-gap-f242b0230ed3acb5 | uncovered | --accent | src/css/style.css | 10660/10660 | .btn-secondary:hover | selector-owner-unresolved | selector-owner-unresolved | 0 | 0 | missing |
| 66 | acp6-gap-28601cf0954a9348 | uncovered | --accent | src/css/style.css | 11060/11060 | .social-links a:hover | selector-owner-unresolved | selector-owner-unresolved | 0 | 0 | missing |
| 67 | acp6-gap-c30b85cdab347df5 | covered | --accent | src/css/style.css | 11502/11502 | .profile-image | — | — | 1 | 2 | missing |
| 68 | acp6-gap-6a48459fe1baaec5 | covered | --accent | src/css/style.css | 11810/11810 | .image-decoration | — | — | 1 | 2 | missing |
| 69 | acp6-gap-99850a3adda7e481 | uncovered | --accent | src/css/style.css | 12735/12735 | .stat-card::before | dynamic-className | dynamic-className, candidate-without-strict-edge | 1 | 0 | missing |
| 70 | acp6-gap-8a7a8f3d659dfb5d | uncovered | --accent | src/css/style.css | 13011/13011 | .stat-card:hover | dynamic-className | dynamic-className, candidate-without-strict-edge | 1 | 0 | missing |
| 71 | acp6-gap-e5d92ef523cacbfa | covered | --accent | src/css/style.css | 13098/13098 | .stat-icon | — | — | 1 | 2 | missing |
| 72 | acp6-gap-8bc34077d1c9da7d | covered | --accent | src/css/style.css | 13751/13751 | .skills-section h3::after | — | — | 1 | 2 | missing |
| 73 | acp6-gap-329ff8f72a814e4c | covered | --accent | src/css/style.css | 14396/14396 | .skills-section .skill-badge | — | — | 2 | 4 | missing |
| 74 | acp6-gap-79d5d2a6066eea68 | covered | --accent | src/css/style.css | 14469/14469 | .skills-section .skill-badge:hover | — | — | 2 | 4 | missing |
| 75 | acp6-gap-a8ec201981072653 | covered | --accent | src/css/style.css | 15077/15077 | .view-all | — | — | 1 | 2 | missing |
| 76 | acp6-gap-9830d198fe48163b | covered | --accent | src/css/style.css | 15653/15653 | .project-card:hover | — | — | 1 | 2 | missing |
| 77 | acp6-gap-80b33ac13167c0c1 | uncovered | --accent | src/css/style.css | 16133/16133 | .project-link | dynamic-className | dynamic-className, candidate-without-strict-edge | 1 | 0 | missing |
| 78 | acp6-gap-daa82297af946f45 | covered | --accent | src/css/style.css | 17981/17981 | .contact-btn | — | — | 1 | 2 | missing |
| 79 | acp6-gap-e5fd86b599c27aa2 | uncovered | --text-secondary | src/css/footer.css | 687/687 | .footer-tagline | candidate-without-strict-edge | candidate-without-strict-edge | 1 | 0 | missing |
| 80 | acp6-gap-2624fa0fa5f6d031 | uncovered | --text-secondary | src/css/footer.css | 1536/1536 | .footer-links li a | selector-owner-unresolved | selector-owner-unresolved | 0 | 0 | missing |
| 81 | acp6-gap-b192ab3f1cde76af | covered | --text-secondary | src/css/footer.css | 2163/2163 | .social-icon | — | — | 3 | 6 | missing |
| 82 | acp6-gap-e399f9ce225922ba | covered | --text-secondary | src/css/footer.css | 2844/2844 | .footer-copyright | — | — | 1 | 2 | missing |
| 83 | acp6-gap-e0237a73cac1eee8 | covered | --text-secondary | src/css/style.css | 2990/2990 | .skills-grid p | — | — | 3 | 6 | missing |
| 84 | acp6-gap-2b8c0eda083726f4 | uncovered | --text-secondary | src/css/style.css | 3418/3418 | .content p | selector-owner-unresolved | selector-owner-unresolved | 0 | 0 | missing |
| 85 | acp6-gap-dd9d8b2db0329e65 | covered | --text-secondary | src/css/style.css | 3940/3940 | .stats-grid p | — | — | 1 | 2 | missing |
| 86 | acp6-gap-193ee5fb755f60b5 | uncovered | --text-secondary | src/css/style.css | 8978/8978 | .title | candidate-without-strict-edge | candidate-without-strict-edge | 1 | 0 | missing |
| 87 | acp6-gap-c84cd4aacf4dd82b | covered | --text-secondary | src/css/style.css | 9114/9114 | .bio | — | — | 1 | 2 | missing |
| 88 | acp6-gap-de767764ebbc4de1 | uncovered | --text-secondary | src/css/style.css | 10897/10897 | .social-links a | selector-owner-unresolved | selector-owner-unresolved | 0 | 0 | missing |
| 89 | acp6-gap-1ce697519f63215e | covered | --text-secondary | src/css/style.css | 13307/13307 | .stat-label | — | — | 1 | 2 | missing |
| 90 | acp6-gap-1cf5a82d1f65687c | covered | --text-secondary | src/css/style.css | 17254/17254 | .project-tech | — | — | 1 | 2 | missing |
| 91 | acp6-gap-7da644343632ca2f | covered | --text-secondary | src/css/style.css | 17767/17767 | .contact-card p | — | — | 1 | 2 | missing |
| 92 | acp6-gap-98288a263b162995 | uncovered | --background | src/css/footer.css | 977/977 | .footer-cta | candidate-without-strict-edge | candidate-without-strict-edge | 1 | 0 | missing |
| 93 | acp6-gap-1b37eecf8eef9d08 | covered | --background | src/css/footer.css | 2396/2396 | .social-icon:hover | — | — | 3 | 6 | missing |
| 94 | acp6-gap-1400102a06187831 | covered | --background | src/css/footer.css | 3070/3070 | .scroll-to-top | — | — | 1 | 2 | missing |
| 95 | acp6-gap-727ef431d90055ad | covered | --background | src/css/nav.css | 1103/1103 | .nav-link:hover | — | — | 6 | 10 | missing |
| 96 | acp6-gap-2369656a3b4b410b | covered | --background | src/css/nav.css | 1415/1415 | .hamburger:hover | — | — | 1 | 2 | missing |
| 97 | acp6-gap-a854d2e75c916e13 | uncovered | --background | src/css/style.css | 966/966 | body | selector-owner-unresolved | selector-owner-unresolved | 0 | 0 | missing |
| 98 | acp6-gap-b35f2448295c2c45 | covered | --background | src/css/style.css | 4867/4867 | .contact-form button | — | — | 1 | 2 | missing |
| 99 | acp6-gap-a5f928ee53776fe2 | covered | --background | src/css/style.css | 5689/5689 | .theme-toggle:hover | — | — | 1 | 2 | missing |
| 100 | acp6-gap-584a50dce381d511 | uncovered | --background | src/css/style.css | 7524/7524 | .hero-background | selector-owner-unresolved | selector-owner-unresolved | 0 | 0 | missing |
| 101 | acp6-gap-891f160b463ae316 | covered | --background | src/css/style.css | 10232/10232 | .btn-primary | — | — | 1 | 2 | missing |
| 102 | acp6-gap-a242cedaab77a87c | uncovered | --background | src/css/style.css | 11085/11085 | .social-links a:hover | selector-owner-unresolved | selector-owner-unresolved | 0 | 0 | missing |
| 103 | acp6-gap-766b86077e6e6ee6 | covered | --background | src/css/style.css | 14494/14494 | .skills-section .skill-badge:hover | — | — | 2 | 4 | missing |
| 104 | acp6-gap-f6c2a5153396edf2 | uncovered | --background | src/css/style.css | 16184/16184 | .project-link | dynamic-className | dynamic-className, candidate-without-strict-edge | 1 | 0 | missing |
| 105 | acp6-gap-d43b6bde441cb4e5 | covered | --background | src/css/style.css | 18006/18006 | .contact-btn | — | — | 1 | 2 | missing |
| 106 | acp6-gap-0f7a8f18de3c871d | covered | --card-bg | src/css/footer.css | 2137/2137 | .social-icon | — | — | 3 | 6 | missing |
| 107 | acp6-gap-24f03c20aee330e6 | covered | --card-bg | src/css/footer.css | 4625/4625 | [data-theme="light"] .social-icon | — | — | 3 | 6 | missing |
| 108 | acp6-gap-bb22591555459854 | covered | --card-bg | src/css/nav.css | 97/97 | .nav-container | — | — | 1 | 2 | missing |
| 109 | acp6-gap-35c0eeb1ea10efe9 | covered | --card-bg | src/css/style.css | 2282/2282 | .card | — | — | 7 | 14 | missing |
| 110 | acp6-gap-d0d0367b89c0e00d | covered | --card-bg | src/css/style.css | 2738/2738 | .skills-grid > div | — | — | 3 | 6 | missing |
| 111 | acp6-gap-20227b8b89485ebb | covered | --card-bg | src/css/style.css | 3692/3692 | .stats-grid div | — | — | 1 | 2 | missing |
| 112 | acp6-gap-2749e4f7eac37fb0 | covered | --card-bg | src/css/style.css | 4677/4677 | .contact-form input,\n.contact-form textarea | — | — | 1 | 2 | missing |
| 113 | acp6-gap-5f6757279fa42a26 | covered | --card-bg | src/css/style.css | 5431/5431 | .theme-toggle | — | — | 1 | 2 | missing |
| 114 | acp6-gap-345b1ce52c592eb6 | uncovered | --card-bg | src/css/style.css | 10602/10602 | .btn-secondary:hover | selector-owner-unresolved | selector-owner-unresolved | 0 | 0 | missing |
| 115 | acp6-gap-e20fc1493021c241 | uncovered | --card-bg | src/css/style.css | 10871/10871 | .social-links a | selector-owner-unresolved | selector-owner-unresolved | 0 | 0 | missing |
| 116 | acp6-gap-84c08bdb0b00726a | uncovered | --card-bg | src/css/style.css | 12385/12385 | .stat-card | dynamic-className | dynamic-className, candidate-without-strict-edge | 1 | 0 | missing |
| 117 | acp6-gap-21ffe4e9cdd5e2c4 | covered | --card-bg | src/css/style.css | 14167/14167 | .skills-section .skill-badge | — | — | 2 | 4 | missing |
| 118 | acp6-gap-11213eba96515fde | covered | --card-bg | src/css/style.css | 15399/15399 | .project-card | — | — | 1 | 2 | missing |
| 119 | acp6-gap-308c224f5dd5d8bd | covered | --card-bg | src/css/style.css | 17461/17461 | .contact-card | — | — | 1 | 2 | missing |
| 120 | acp6-gap-40d00fe6fa2e103e | covered | --accent-secondary | src/css/interests.css | 230/230 | .interests-grid .card:hover | — | — | 8 | 16 | missing |
| 121 | acp6-gap-1cfcc36cf6678e9a | uncovered | --accent-secondary | src/css/style.css | 16148/16148 | .project-link | dynamic-className | dynamic-className, candidate-without-strict-edge | 1 | 0 | missing |
| 122 | acp6-gap-fbdb1f3a2f99a2cb | uncovered | --accent-secondary | src/css/style.css | 16547/16547 | .project-link:focus-visible | dynamic-className | dynamic-className, candidate-without-strict-edge | 1 | 0 | missing |
| 123 | acp6-gap-b3630405fc03a356 | covered | --skill-color | src/css/style.css | 14682/14682 | .skills-section .skill-icon | — | — | 2 | 2 | missing |

## graphNodeIds 缺失语义

B v5 source-use rows 没有逐行 `graphNodeIds`。因此每行写入：

`sourceUseGraphNodeIds: { status: "missing", value: null, reason: "B v5 source-use rows do not emit per-use graphNodeIds; no node association is inferred." }`

声明节点上的 graph node IDs 仅作为原始 declarationRefs 复制保存，不能反向推断 source-use 节点。

## 一致性校验

校验脚本：`_scratch/validate-acp6-v06-phase0-gap-matrix.mjs`。

执行：

`node _scratch/validate-acp6-v06-phase0-gap-matrix.mjs <matrix.json> <original-b-v5-acceptance.json>`

本地实际复跑：

`node _scratch/validate-acp6-v06-phase0-gap-matrix.mjs _scratch/acp6-v06-phase0-gap-matrix-20261028.json _scratch/acp6-pr61-2ebd1e20-independent-20261027/acceptance-2ebd1e20-final.json`

退出码：`0`；正例通过，记录顺序反转保持 ID/统计不变，重复 ID、删除分类、篡改来源定位、篡改输入 hash、篡改 covered/uncovered 统计、伪造 graphNodeIds 六个负例均按预期失败。

逐项负例命令可追加 `--negative=<case>`；本地实际退出码均为 `0`：`duplicate-id`、`deleted-classification`、`tampered-source-location`、`tampered-input-hash`、`tampered-coverage-statistics`、`graph-node-missing-bypassed`。该模式中退出码 0 表示校验器正确拒绝了篡改。

校验项目包括：稳定 ID 唯一、确定性复算、五类分类合法、primary 属于 gapClasses、sourceRef 完整、graphNodeIds 明确 missing、123/85/38 统计、8 Token、16 UNKNOWN、原始证据 hash 存在，以及打乱顺序、重复 ID、删除分类、篡改来源定位、篡改输入 hash、篡改 covered/uncovered 统计和伪造 graphNodeIds 的负例。

本次校验结果：`_scratch/acp6-v06-phase0-gap-matrix-20261028-validation.json`，`pass: true`。文件 SHA-256 清单：`_scratch/acp6-v06-phase0-sha256-20261028.txt`。

## 当前边界

本阶段没有 SourceGraph 生产逻辑改动，没有 Token Candidate/Apply，没有 VerificationRun 正式字段变更，也没有修改 B v5 matcher/probe。Phase 0 执行基线为 `5b75fe699afce98638e6fd6ad110911d83389dc8`；现有 `M tsconfig.node.tsbuildinfo` 保留，正式研发仍需从干净 checkout 开始。

