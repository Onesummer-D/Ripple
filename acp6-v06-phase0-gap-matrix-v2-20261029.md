# AC-P6 Phase 0 canonical gap matrix v2

- Formal B input: `ed58cfdc2892acaa9b97363a3414b1c219d07053` recovered JSON
- Input SHA-256: `0d7e5f97d91e69852f15c313522e05587a2571d61489c72274e3944b47d6527a`
- Input bytes: `1035281`
- Fixed project: `allanhue/webportflio@b244f857457d2a07f118155602eef9097fd322bd`
- Taxonomy: `acp6-gap-taxonomy/v1`; mapping: `acp6-gap-mapping/v1`
- PR Base for this repair archive: `d1d26185710c8e4d80182356f760109123bdc989`
- Raw classification evidence baseline: `c851bfe11e6851e01695f94246a5a571435d8faa` (SHA-256 `89b1c30eb320c3074bf1d445f2a1628026a4f9c08e54b6879e3cc5ed1bfe3200`); it is bound row by row and is not the formal B input.

## Scope and counts

| Metric | Value |
| --- | ---: |
| AC6.2 source-use rows | 123 |
| AC6.2 covered | 85 |
| AC6.2 uncovered | 38 |
| Tokens | 8 |
| AC6.4 consumer pairs | 147 |
| AC6.4 anchored | 131 |
| AC6.4 UNKNOWN | 16 |
| AC6.4 static UNKNOWN | 9 |
| AC6.4 dynamic UNKNOWN | 7 |

## Canonical taxonomy

Canonical classes are fixed to `global-or-theme-selector`, `no-static-element-anchor`, `dynamic-or-ambiguous-class`, `candidate-without-source-edge`, and `pseudo-element-or-generated-content`. Raw labels remain in `rawGapClass`/`rawGapClasses`; they are not silently renamed.

Primary counts: `{"global-or-theme-selector":3,"no-static-element-anchor":21,"dynamic-or-ambiguous-class":8,"candidate-without-source-edge":4,"pseudo-element-or-generated-content":2}`. Raw counts: `{"selector-owner-unresolved":24,"dynamic-className":9,"candidate-without-strict-edge":4,"theme-cascade-ambiguity":1}`.

Primary selection is ordered pseudo → global/theme → dynamic → candidate → no-static-anchor. Pseudo-elements take precedence over dynamic and candidate causes; theme selectors take precedence over owner ambiguity. `:hover` and `:focus-visible` are pseudo-classes and are not classified as generated content.

## Source comparison and offsets

The matrix is rebuilt from every AC6.2 `declarationSetCoverage.sourceUseCoverage` row in the recovered JSON; rawGapClass/rawGapClasses are checked against the exact c851bfe raw classification matrix. Validator compares token, file, character offset, UTF-8 byteOffset, selector, covered flag, candidate/strict edge counts, and declaration references row by row. Source-use graphNodeIds remain explicitly missing.

Offsets are measured on exact UTF-8 source bytes. No LF/CRLF normalization is performed. The Linux Actions artifact is independently identified (run 40656095611, artifact 12801358049, ZIP SHA-256 8074527bc50fe7400f79a4dbe9c556634b1298cf39ab3ea83dcf1a591e5fb42c) but its ZIP bytes were unavailable to this local replay, so all cross-platform offset status is unavailable/not-proven; no Linux offsets are copied from Windows.

## Machine-readable row matrix

| rowId | status | token | source file | byteOffset | selector | rawGapClass | canonical gapClass | mappingRuleId | graphNodeIds |
| --- | --- | --- | --- | ---: | --- | --- | --- | --- | --- |
| acp6-gap-7681a1cbb8f0413c | covered | --text-primary | src/css/footer.css | 115 | .footer | — | — | — | missing |
| acp6-gap-3622ac946f5dca38 | covered | --text-primary | src/css/footer.css | 1192 | .footer-section h4 | — | — | — | missing |
| acp6-gap-80f8f8307616027b | covered | --text-primary | src/css/nav.css | 681 | .nav-logo:hover | — | — | — | missing |
| acp6-gap-3b6136e218b1fd32 | covered | --text-primary | src/css/nav.css | 890 | .nav-link | — | — | — | missing |
| acp6-gap-772811fbc0457512 | covered | --text-primary | src/css/nav.css | 1211 | .hamburger | — | — | — | missing |
| acp6-gap-1a07ac810794baae | uncovered | --text-primary | src/css/style.css | 995 | body | selector-owner-unresolved | global-or-theme-selector | MAP-SOU-GLOBAL-001 | missing |
| acp6-gap-a99b0609ab86f64f | uncovered | --text-primary | src/css/style.css | 3320 | .content h2 | selector-owner-unresolved | no-static-element-anchor | MAP-SOU-OWNER-001 | missing |
| acp6-gap-12c7345a271c6404 | covered | --text-primary | src/css/style.css | 4497 | .contact-form label | — | — | — | missing |
| acp6-gap-5fc08122bea47a3d | covered | --text-primary | src/css/style.css | 4703 | .contact-form input,
.contact-form textarea | — | — | — | missing |
| acp6-gap-f5f0d08a3b7886e8 | covered | --text-primary | src/css/style.css | 5457 | .theme-toggle | — | — | — | missing |
| acp6-gap-a040cfff69fc21c4 | covered | --text-primary | src/css/style.css | 8459 | .greeting h1 | — | — | — | missing |
| acp6-gap-af7e7830fa2a14a4 | uncovered | --text-primary | src/css/style.css | 10495 | .btn-secondary | selector-owner-unresolved | no-static-element-anchor | MAP-SOU-OWNER-001 | missing |
| acp6-gap-792185a53960990d | covered | --text-primary | src/css/style.css | 13210 | .stat-number | — | — | — | missing |
| acp6-gap-38dd4f78f305a492 | covered | --text-primary | src/css/style.css | 13499 | .skills-section h3 | — | — | — | missing |
| acp6-gap-b6507b0e953549fa | covered | --text-primary | src/css/style.css | 14193 | .skills-section .skill-badge | — | — | — | missing |
| acp6-gap-494379191ec2ba4d | covered | --text-primary | src/css/style.css | 14956 | .section-header h3 | — | — | — | missing |
| acp6-gap-01d38eadec5e0376 | covered | --text-primary | src/css/style.css | 15834 | .project-header h4 | — | — | — | missing |
| acp6-gap-87857215a58d54b6 | covered | --text-primary | src/css/style.css | 17688 | .contact-card h3 | — | — | — | missing |
| acp6-gap-04fc5fd5533c3338 | covered | --border-color | src/css/footer.css | 161 | .footer | — | — | — | missing |
| acp6-gap-bfacabea13b57d58 | covered | --border-color | src/css/footer.css | 2230 | .social-icon | — | — | — | missing |
| acp6-gap-069212c8c2f62eea | covered | --border-color | src/css/footer.css | 2620 | .footer-divider | — | — | — | missing |
| acp6-gap-c8b86a239f88cd41 | covered | --border-color | src/css/footer.css | 4479 | [data-theme="light"] .footer | — | — | — | missing |
| acp6-gap-f39969fed0f7990b | covered | --border-color | src/css/footer.css | 4658 | [data-theme="light"] .social-icon | — | — | — | missing |
| acp6-gap-8f1344622d75274e | covered | --border-color | src/css/nav.css | 173 | .nav-container | — | — | — | missing |
| acp6-gap-b67204d231e5653b | uncovered | --border-color | src/css/nav.css | 2061 | .nav-links | dynamic-className | dynamic-or-ambiguous-class | MAP-DYN-001 | missing |
| acp6-gap-16dc5d9eb24a4dc1 | covered | --border-color | src/css/style.css | 2818 | .skills-grid > div | — | — | — | missing |
| acp6-gap-e2e5e10fb82cf5a2 | covered | --border-color | src/css/style.css | 3770 | .stats-grid div | — | — | — | missing |
| acp6-gap-3961080530e5810e | covered | --border-color | src/css/style.css | 4612 | .contact-form input,
.contact-form textarea | — | — | — | missing |
| acp6-gap-0ee36268df344755 | covered | --border-color | src/css/style.css | 5365 | .theme-toggle | — | — | — | missing |
| acp6-gap-87321cad295188a3 | uncovered | --border-color | src/css/style.css | 10537 | .btn-secondary | selector-owner-unresolved | no-static-element-anchor | MAP-SOU-OWNER-001 | missing |
| acp6-gap-3a9f56944909d61f | uncovered | --border-color | src/css/style.css | 10994 | .social-links a | selector-owner-unresolved | no-static-element-anchor | MAP-SOU-OWNER-001 | missing |
| acp6-gap-94b8fb684ea376dd | uncovered | --border-color | src/css/style.css | 12487 | .stat-card | dynamic-className | dynamic-or-ambiguous-class | MAP-DYN-001 | missing |
| acp6-gap-25033f92bac0ead7 | covered | --border-color | src/css/style.css | 14286 | .skills-section .skill-badge | — | — | — | missing |
| acp6-gap-ab43f861e4be2c04 | covered | --border-color | src/css/style.css | 15478 | .project-card | — | — | — | missing |
| acp6-gap-11c342f726cb237f | covered | --border-color | src/css/style.css | 17572 | .contact-card | — | — | — | missing |
| acp6-gap-c4609510f77e7b44 | uncovered | --accent | src/css/footer.css | 600 | .footer-brand | selector-owner-unresolved | no-static-element-anchor | MAP-SOU-OWNER-001 | missing |
| acp6-gap-1027a7455bb3d74f | uncovered | --accent | src/css/footer.css | 952 | .footer-cta | candidate-without-strict-edge | candidate-without-source-edge | MAP-CAND-001 | missing |
| acp6-gap-8cebe28b7de80471 | covered | --accent | src/css/footer.css | 1325 | .footer-section h4 | — | — | — | missing |
| acp6-gap-dc96bd48e41e2565 | uncovered | --accent | src/css/footer.css | 1739 | .footer-links li a:hover | selector-owner-unresolved | no-static-element-anchor | MAP-SOU-OWNER-001 | missing |
| acp6-gap-460c622984ae9d97 | covered | --accent | src/css/footer.css | 2371 | .social-icon:hover | — | — | — | missing |
| acp6-gap-17e038f806870668 | covered | --accent | src/css/footer.css | 2432 | .social-icon:hover | — | — | — | missing |
| acp6-gap-f590c38d66d52f5e | covered | --accent | src/css/footer.css | 3045 | .scroll-to-top | — | — | — | missing |
| acp6-gap-3e431957897adb9f | uncovered | --accent | src/css/footer.css | 4553 | [data-theme="light"] .footer-brand | theme-cascade-ambiguity | global-or-theme-selector | MAP-THEME-001 | missing |
| acp6-gap-52f50d80f289d159 | covered | --accent | src/css/interests.css | 157 | .interests-grid .card | — | — | — | missing |
| acp6-gap-56923cab340f259a | covered | --accent | src/css/nav.css | 581 | .nav-logo | — | — | — | missing |
| acp6-gap-fa87445de6eeca0c | covered | --accent | src/css/nav.css | 1067 | .nav-link:hover | — | — | — | missing |
| acp6-gap-bc6fc7b767348c4e | covered | --accent | src/css/nav.css | 1444 | .hamburger:hover | — | — | — | missing |
| acp6-gap-a07b7efaa938245c | covered | --accent | src/css/nav.css | 1514 | .hamburger:focus-visible | — | — | — | missing |
| acp6-gap-e9cd71230c8fecdf | uncovered | --accent | src/css/style.css | 1998 | .section-title | selector-owner-unresolved | no-static-element-anchor | MAP-SOU-OWNER-001 | missing |
| acp6-gap-d81381d84c0356ee | uncovered | --accent | src/css/style.css | 2232 | .section-title::after | selector-owner-unresolved | pseudo-element-or-generated-content | MAP-SOU-PSEUDO-001 | missing |
| acp6-gap-b11568f8e63f06cb | covered | --accent | src/css/style.css | 2497 | .experience-item | — | — | — | missing |
| acp6-gap-30305395e59fccf8 | covered | --accent | src/css/style.css | 2896 | .skills-grid h3 | — | — | — | missing |
| acp6-gap-9b280c12225690cb | uncovered | --accent | src/css/style.css | 3231 | .content h1 | selector-owner-unresolved | no-static-element-anchor | MAP-SOU-OWNER-001 | missing |
| acp6-gap-575e4bc21bc5e381 | covered | --accent | src/css/style.css | 3847 | .stats-grid h2 | — | — | — | missing |
| acp6-gap-fdd0a9e050c54406 | uncovered | --accent | src/css/style.css | 4227 | .image-container img | selector-owner-unresolved | no-static-element-anchor | MAP-SOU-OWNER-001 | missing |
| acp6-gap-44e51ee48330fc98 | covered | --accent | src/css/style.css | 4842 | .contact-form button | — | — | — | missing |
| acp6-gap-e8087459138cbb21 | uncovered | --accent | src/css/style.css | 5143 | .social-media a | selector-owner-unresolved | no-static-element-anchor | MAP-SOU-OWNER-001 | missing |
| acp6-gap-226e3f18bce6f82d | covered | --accent | src/css/style.css | 5664 | .theme-toggle:hover | — | — | — | missing |
| acp6-gap-b28782dc8cd54747 | covered | --accent | src/css/style.css | 5725 | .theme-toggle:hover | — | — | — | missing |
| acp6-gap-d499b2e05a50e8a7 | covered | --accent | src/css/style.css | 8549 | .name-highlight | — | — | — | missing |
| acp6-gap-a24853b5ecd1ca10 | covered | --accent | src/css/style.css | 8756 | .name-highlight::after | — | — | — | missing |
| acp6-gap-e29cecb2c1316328 | uncovered | --accent | src/css/style.css | 9209 | .company | selector-owner-unresolved | no-static-element-anchor | MAP-SOU-OWNER-001 | missing |
| acp6-gap-91ab97ddc9309383 | covered | --accent | src/css/style.css | 10207 | .btn-primary | — | — | — | missing |
| acp6-gap-8538bd1e7defa405 | uncovered | --accent | src/css/style.css | 10635 | .btn-secondary:hover | selector-owner-unresolved | no-static-element-anchor | MAP-SOU-OWNER-001 | missing |
| acp6-gap-f242b0230ed3acb5 | uncovered | --accent | src/css/style.css | 10660 | .btn-secondary:hover | selector-owner-unresolved | no-static-element-anchor | MAP-SOU-OWNER-001 | missing |
| acp6-gap-28601cf0954a9348 | uncovered | --accent | src/css/style.css | 11060 | .social-links a:hover | selector-owner-unresolved | no-static-element-anchor | MAP-SOU-OWNER-001 | missing |
| acp6-gap-c30b85cdab347df5 | covered | --accent | src/css/style.css | 11502 | .profile-image | — | — | — | missing |
| acp6-gap-6a48459fe1baaec5 | covered | --accent | src/css/style.css | 11810 | .image-decoration | — | — | — | missing |
| acp6-gap-99850a3adda7e481 | uncovered | --accent | src/css/style.css | 12735 | .stat-card::before | dynamic-className | pseudo-element-or-generated-content | MAP-DYN-PSEUDO-001 | missing |
| acp6-gap-8a7a8f3d659dfb5d | uncovered | --accent | src/css/style.css | 13011 | .stat-card:hover | dynamic-className | dynamic-or-ambiguous-class | MAP-DYN-001 | missing |
| acp6-gap-e5d92ef523cacbfa | covered | --accent | src/css/style.css | 13098 | .stat-icon | — | — | — | missing |
| acp6-gap-8bc34077d1c9da7d | covered | --accent | src/css/style.css | 13751 | .skills-section h3::after | — | — | — | missing |
| acp6-gap-329ff8f72a814e4c | covered | --accent | src/css/style.css | 14396 | .skills-section .skill-badge | — | — | — | missing |
| acp6-gap-79d5d2a6066eea68 | covered | --accent | src/css/style.css | 14469 | .skills-section .skill-badge:hover | — | — | — | missing |
| acp6-gap-a8ec201981072653 | covered | --accent | src/css/style.css | 15077 | .view-all | — | — | — | missing |
| acp6-gap-9830d198fe48163b | covered | --accent | src/css/style.css | 15653 | .project-card:hover | — | — | — | missing |
| acp6-gap-80b33ac13167c0c1 | uncovered | --accent | src/css/style.css | 16133 | .project-link | dynamic-className | dynamic-or-ambiguous-class | MAP-DYN-001 | missing |
| acp6-gap-daa82297af946f45 | covered | --accent | src/css/style.css | 17981 | .contact-btn | — | — | — | missing |
| acp6-gap-e5fd86b599c27aa2 | uncovered | --text-secondary | src/css/footer.css | 687 | .footer-tagline | candidate-without-strict-edge | candidate-without-source-edge | MAP-CAND-001 | missing |
| acp6-gap-2624fa0fa5f6d031 | uncovered | --text-secondary | src/css/footer.css | 1536 | .footer-links li a | selector-owner-unresolved | no-static-element-anchor | MAP-SOU-OWNER-001 | missing |
| acp6-gap-b192ab3f1cde76af | covered | --text-secondary | src/css/footer.css | 2163 | .social-icon | — | — | — | missing |
| acp6-gap-e399f9ce225922ba | covered | --text-secondary | src/css/footer.css | 2844 | .footer-copyright | — | — | — | missing |
| acp6-gap-e0237a73cac1eee8 | covered | --text-secondary | src/css/style.css | 2990 | .skills-grid p | — | — | — | missing |
| acp6-gap-2b8c0eda083726f4 | uncovered | --text-secondary | src/css/style.css | 3418 | .content p | selector-owner-unresolved | no-static-element-anchor | MAP-SOU-OWNER-001 | missing |
| acp6-gap-dd9d8b2db0329e65 | covered | --text-secondary | src/css/style.css | 3940 | .stats-grid p | — | — | — | missing |
| acp6-gap-193ee5fb755f60b5 | uncovered | --text-secondary | src/css/style.css | 8978 | .title | candidate-without-strict-edge | candidate-without-source-edge | MAP-CAND-001 | missing |
| acp6-gap-c84cd4aacf4dd82b | covered | --text-secondary | src/css/style.css | 9114 | .bio | — | — | — | missing |
| acp6-gap-de767764ebbc4de1 | uncovered | --text-secondary | src/css/style.css | 10897 | .social-links a | selector-owner-unresolved | no-static-element-anchor | MAP-SOU-OWNER-001 | missing |
| acp6-gap-1ce697519f63215e | covered | --text-secondary | src/css/style.css | 13307 | .stat-label | — | — | — | missing |
| acp6-gap-1cf5a82d1f65687c | covered | --text-secondary | src/css/style.css | 17254 | .project-tech | — | — | — | missing |
| acp6-gap-7da644343632ca2f | covered | --text-secondary | src/css/style.css | 17767 | .contact-card p | — | — | — | missing |
| acp6-gap-98288a263b162995 | uncovered | --background | src/css/footer.css | 977 | .footer-cta | candidate-without-strict-edge | candidate-without-source-edge | MAP-CAND-001 | missing |
| acp6-gap-1b37eecf8eef9d08 | covered | --background | src/css/footer.css | 2396 | .social-icon:hover | — | — | — | missing |
| acp6-gap-1400102a06187831 | covered | --background | src/css/footer.css | 3070 | .scroll-to-top | — | — | — | missing |
| acp6-gap-727ef431d90055ad | covered | --background | src/css/nav.css | 1103 | .nav-link:hover | — | — | — | missing |
| acp6-gap-2369656a3b4b410b | covered | --background | src/css/nav.css | 1415 | .hamburger:hover | — | — | — | missing |
| acp6-gap-a854d2e75c916e13 | uncovered | --background | src/css/style.css | 966 | body | selector-owner-unresolved | global-or-theme-selector | MAP-SOU-GLOBAL-001 | missing |
| acp6-gap-b35f2448295c2c45 | covered | --background | src/css/style.css | 4867 | .contact-form button | — | — | — | missing |
| acp6-gap-a5f928ee53776fe2 | covered | --background | src/css/style.css | 5689 | .theme-toggle:hover | — | — | — | missing |
| acp6-gap-584a50dce381d511 | uncovered | --background | src/css/style.css | 7524 | .hero-background | selector-owner-unresolved | no-static-element-anchor | MAP-SOU-OWNER-001 | missing |
| acp6-gap-891f160b463ae316 | covered | --background | src/css/style.css | 10232 | .btn-primary | — | — | — | missing |
| acp6-gap-a242cedaab77a87c | uncovered | --background | src/css/style.css | 11085 | .social-links a:hover | selector-owner-unresolved | no-static-element-anchor | MAP-SOU-OWNER-001 | missing |
| acp6-gap-766b86077e6e6ee6 | covered | --background | src/css/style.css | 14494 | .skills-section .skill-badge:hover | — | — | — | missing |
| acp6-gap-f6c2a5153396edf2 | uncovered | --background | src/css/style.css | 16184 | .project-link | dynamic-className | dynamic-or-ambiguous-class | MAP-DYN-001 | missing |
| acp6-gap-d43b6bde441cb4e5 | covered | --background | src/css/style.css | 18006 | .contact-btn | — | — | — | missing |
| acp6-gap-0f7a8f18de3c871d | covered | --card-bg | src/css/footer.css | 2137 | .social-icon | — | — | — | missing |
| acp6-gap-24f03c20aee330e6 | covered | --card-bg | src/css/footer.css | 4625 | [data-theme="light"] .social-icon | — | — | — | missing |
| acp6-gap-bb22591555459854 | covered | --card-bg | src/css/nav.css | 97 | .nav-container | — | — | — | missing |
| acp6-gap-35c0eeb1ea10efe9 | covered | --card-bg | src/css/style.css | 2282 | .card | — | — | — | missing |
| acp6-gap-d0d0367b89c0e00d | covered | --card-bg | src/css/style.css | 2738 | .skills-grid > div | — | — | — | missing |
| acp6-gap-20227b8b89485ebb | covered | --card-bg | src/css/style.css | 3692 | .stats-grid div | — | — | — | missing |
| acp6-gap-2749e4f7eac37fb0 | covered | --card-bg | src/css/style.css | 4677 | .contact-form input,
.contact-form textarea | — | — | — | missing |
| acp6-gap-5f6757279fa42a26 | covered | --card-bg | src/css/style.css | 5431 | .theme-toggle | — | — | — | missing |
| acp6-gap-345b1ce52c592eb6 | uncovered | --card-bg | src/css/style.css | 10602 | .btn-secondary:hover | selector-owner-unresolved | no-static-element-anchor | MAP-SOU-OWNER-001 | missing |
| acp6-gap-e20fc1493021c241 | uncovered | --card-bg | src/css/style.css | 10871 | .social-links a | selector-owner-unresolved | no-static-element-anchor | MAP-SOU-OWNER-001 | missing |
| acp6-gap-84c08bdb0b00726a | uncovered | --card-bg | src/css/style.css | 12385 | .stat-card | dynamic-className | dynamic-or-ambiguous-class | MAP-DYN-001 | missing |
| acp6-gap-21ffe4e9cdd5e2c4 | covered | --card-bg | src/css/style.css | 14167 | .skills-section .skill-badge | — | — | — | missing |
| acp6-gap-11213eba96515fde | covered | --card-bg | src/css/style.css | 15399 | .project-card | — | — | — | missing |
| acp6-gap-308c224f5dd5d8bd | covered | --card-bg | src/css/style.css | 17461 | .contact-card | — | — | — | missing |
| acp6-gap-40d00fe6fa2e103e | covered | --accent-secondary | src/css/interests.css | 230 | .interests-grid .card:hover | — | — | — | missing |
| acp6-gap-1cfcc36cf6678e9a | uncovered | --accent-secondary | src/css/style.css | 16148 | .project-link | dynamic-className | dynamic-or-ambiguous-class | MAP-DYN-001 | missing |
| acp6-gap-fbdb1f3a2f99a2cb | uncovered | --accent-secondary | src/css/style.css | 16547 | .project-link:focus-visible | dynamic-className | dynamic-or-ambiguous-class | MAP-DYN-001 | missing |
| acp6-gap-b3630405fc03a356 | covered | --skill-color | src/css/style.css | 14682 | .skills-section .skill-icon | — | — | — | missing |

## Validation and negative cases

Run the validator from a clean checkout with the source JSON, raw classification source, and matrix path as arguments. It rejects duplicate IDs, unknown raw/canonical classes, missing classifications or row mappingVersion, wrong mapping rules, source-row mutations, input-hash changes, statistic changes, invented graphNodeIds, AC6.4 pair mutations, row-index mutations, and copied/under-proven platform evidence. Platform inputs and every per-row platform copy must match the trusted artifact/run/source identity; a fabricated runner, artifact hash, path, or independent flag is rejected even when all offset deltas and driftRows are numerically self-consistent. A reversed row order must preserve stable IDs and all statistics.

AC6.2 dynamic-className rows and AC6.4 dynamic UNKNOWN pairs have separate cardinalities: 9 raw source-use rows versus 7 consumer pairs. The matrix never maps them one-to-one.

## Boundary

This is evidence and validation only. SourceGraph production code, B v5 matcher/probe, Runtime Identity, Candidate, Verification, Approval, Apply, Rollback and thresholds are unchanged. AC6.2 and AC6.4 remain PENDING.

## Clean reproduction record

The formal source JSON parsed successfully and matched SHA-256 `0d7e5f97d91e69852f15c313522e05587a2571d61489c72274e3944b47d6527a`. The raw classification source is c851bfe11e6851e01695f94246a5a571435d8faa with SHA-256 `89b1c30eb320c3074bf1d445f2a1628026a4f9c08e54b6879e3cc5ed1bfe3200` and is checked row by row. The PR Base is d1d26185710c8e4d80182356f760109123bdc989. The historical corrupt #65 JSON remains preserved and is never used. Cross-platform offsets remain `unavailable/not-proven` because Linux artifact contents were not locally readable.

| Case | Process exit | Validator pass | Failed checks observed |
| --- | ---: | --- | --- |
| positive | 0 | true | none |
| duplicate-id | 0 | false | stable-id-unique, stable-id-reproducible, source-use-full-row-comparison, platform-offsets, order-stability |
| unknown-raw-class | 0 | false | uncovered-classifications-legal, raw-classification-row-comparison, raw-counts, order-stability |
| unknown-canonical-class | 0 | false | uncovered-classifications-legal, canonical-counts, order-stability |
| deleted-classification | 0 | false | taxonomy-version, uncovered-classifications-legal, raw-classification-row-comparison, canonical-counts, raw-counts, order-stability |
| missing-row-mapping-version | 0 | false | uncovered-classifications-legal |
| wrong-row-mapping-version | 0 | false | uncovered-classifications-legal |
| wrong-mapping-rule | 0 | false | uncovered-classifications-legal |
| tampered-source-location | 0 | false | stable-id-reproducible, source-use-full-row-comparison |
| tampered-input-hash | 0 | false | source-hash |
| tampered-counts | 0 | false | row-counts |
| graph-node-present | 0 | false | source-use-graph-node-ids-explicit-missing |
| source-row-mutation | 0 | false | source-use-full-row-comparison |
| ac64-pair-file | 0 | false | ac64-pair-content-integrity, ac64-pair-evidence |
| ac64-pair-byte-offset | 0 | false | ac64-pair-content-integrity, ac64-pair-evidence |
| ac64-pair-token | 0 | false | ac64-pair-content-integrity, ac64-pair-evidence |
| ac64-pair-component | 0 | false | ac64-pair-content-integrity, ac64-pair-evidence |
| ac64-pair-source-ref | 0 | false | ac64-pair-content-integrity, ac64-pair-evidence |
| ac64-pair-edge-count | 0 | false | ac64-pair-content-integrity, ac64-pair-evidence |
| ac64-pair-certainty | 0 | false | ac64-pair-content-integrity, ac64-pair-evidence |
| ac64-pair-id | 0 | false | ac64-pair-content-integrity, ac64-pair-evidence |
| ac64-pair-content-hash | 0 | false | ac64-pair-content-integrity, ac64-pair-evidence |
| ac64-pair-set-hash | 0 | false | ac64-pair-set-hash |
| ac64-unknown-pair-ids | 0 | false | ac64-unknown-pair-ids |
| covered-row-id-mutation | 0 | false | row-indexes-exact |
| uncovered-row-id-mutation | 0 | false | row-indexes-exact |
| copied-platform-evidence | 0 | false | platform-source-binding, platform-offsets |
| offset-platform-mismatch | 0 | false | platform-offsets |
| drift-status-null-linux | 0 | false | platform-offsets |
| drift-status-unobserved | 0 | false | platform-offsets |
| drift-fake-delta | 0 | false | platform-source-binding, platform-offsets |
| drift-missing-row | 0 | false | platform-source-binding, platform-offsets |
| offset-reconciliation-promoted | 0 | false | offset-reconciliation-observation |
| raw-classification-label-swap | 0 | false | uncovered-classifications-legal, raw-classification-row-comparison, raw-counts, order-stability |
| raw-classification-source-hash | 0 | false | archive-base-identity, raw-classification-source-hash |
| drift-fabricated-provenance | 0 | false | platform-source-binding, platform-offsets |
| shuffle-order | 0 | true | none |

The negative cases cover row IDs, taxonomy/mapping fields, raw classification row and source-hash binding, source locations and hashes, AC6.4 pair content and pair-set integrity, row index sets, graph node status, copied platform provenance, independent-drift status with null/unobserved inputs, fake deltas, missing drift rows, fabricated artifact/run/source provenance, and source-row mutations. Reversing row order passes while preserving IDs, counts and classifications. Independent-equal and independent-drift-explained share the same trusted platform source binding and cannot be promoted by metadata fields alone.
