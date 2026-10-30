# AC-P6 v0.6 Phase 0 - A-side independent acceptance record

Execution date: 2026-10-30 (Asia/Shanghai)

## Frozen object and isolated environment

- PR #68 HEAD: `a0c5c5349003deb8f8a8e479086b1e7389ec4c80`
- Git tree: `9726c2844774ea403d02df898b49c5b14faca51f`
- Parent: `7fbd2a916c4a5733ec33c8723a8a24d0a5872ece`
- Worktree: `isolated-review-worktree@a0c5c534`
- git status --short: `(empty)`
- Archive: `docs/acceptance/2026-10-29/acp6-phase0-v2/`
- Validator is a standalone Node ESM script; no package install or production code execution was used.

## Exact commands

```text
node "isolated-review-worktree@a0c5c534\docs\acceptance\2026-10-29\acp6-phase0-v2\validate-acp6-v06-phase0-v2.mjs" "isolated-review-worktree@a0c5c534\docs\acceptance\2026-10-29\acp6-phase0-v2\acp6-v06-phase0-gap-matrix-v2-20261029.json" "isolated-review-worktree@a0c5c534\docs\acceptance\2026-10-29\acp6-phase0-v2\acceptance-ed58cfd-final.json" --raw="isolated-review-worktree@a0c5c534\docs\acceptance\2026-10-29\acp6-phase0-v2\raw-classification-source-c851bfe.json"
node "validate-acp6-v06-phase0-v2.mjs" ... --negative=<case from negative-run-index-v4.json>
Independent PowerShell byte/hash loop: manifest files[], manifest self-hash, formal input/raw/corrupt archive hashes.
```

## Positive validator

- Exit code: `0`
- validation.pass: `True`; exitPass: `True`
- Summary: 123 source-use rows (85 covered / 38 uncovered), 8 tokens; AC6.4 147 pairs (131 anchored / 16 UNKNOWN; 9 static / 7 dynamic); platform status `unavailable`.

## 37 indexed cases

| Case | Exit | exitPass | validation.pass | Failed checks observed |
|---|---:|:---:|:---:|---|
| duplicate-id | 0 | True | False | stable-id-unique,stable-id-reproducible,source-use-full-row-comparison,platform-offsets,order-stability |
| unknown-raw-class | 0 | True | False | uncovered-classifications-legal,raw-classification-row-comparison,raw-counts,order-stability |
| unknown-canonical-class | 0 | True | False | uncovered-classifications-legal,canonical-counts,order-stability |
| deleted-classification | 0 | True | False | taxonomy-version,uncovered-classifications-legal,raw-classification-row-comparison,canonical-counts,raw-counts,order-stability |
| missing-row-mapping-version | 0 | True | False | uncovered-classifications-legal |
| wrong-row-mapping-version | 0 | True | False | uncovered-classifications-legal |
| wrong-mapping-rule | 0 | True | False | uncovered-classifications-legal |
| tampered-source-location | 0 | True | False | stable-id-reproducible,source-use-full-row-comparison |
| tampered-input-hash | 0 | True | False | source-hash |
| tampered-counts | 0 | True | False | row-counts |
| graph-node-present | 0 | True | False | source-use-graph-node-ids-explicit-missing |
| source-row-mutation | 0 | True | False | source-use-full-row-comparison |
| ac64-pair-file | 0 | True | False | ac64-pair-content-integrity,ac64-pair-evidence |
| ac64-pair-byte-offset | 0 | True | False | ac64-pair-content-integrity,ac64-pair-evidence |
| ac64-pair-token | 0 | True | False | ac64-pair-content-integrity,ac64-pair-evidence |
| ac64-pair-component | 0 | True | False | ac64-pair-content-integrity,ac64-pair-evidence |
| ac64-pair-source-ref | 0 | True | False | ac64-pair-content-integrity,ac64-pair-evidence |
| ac64-pair-edge-count | 0 | True | False | ac64-pair-content-integrity,ac64-pair-evidence |
| ac64-pair-certainty | 0 | True | False | ac64-pair-content-integrity,ac64-pair-evidence |
| ac64-pair-id | 0 | True | False | ac64-pair-content-integrity,ac64-pair-evidence |
| ac64-pair-content-hash | 0 | True | False | ac64-pair-content-integrity,ac64-pair-evidence |
| ac64-pair-set-hash | 0 | True | False | ac64-pair-set-hash |
| ac64-unknown-pair-ids | 0 | True | False | ac64-unknown-pair-ids |
| covered-row-id-mutation | 0 | True | False | row-indexes-exact |
| uncovered-row-id-mutation | 0 | True | False | row-indexes-exact |
| copied-platform-evidence | 0 | True | False | platform-source-binding,platform-offsets |
| offset-platform-mismatch | 0 | True | False | platform-offsets |
| drift-status-null-linux | 0 | True | False | platform-offsets |
| drift-status-unobserved | 0 | True | False | platform-offsets |
| drift-fake-delta | 0 | True | False | platform-source-binding,platform-offsets |
| drift-missing-row | 0 | True | False | platform-source-binding,platform-offsets |
| offset-reconciliation-promoted | 0 | True | False | offset-reconciliation-observation |
| raw-classification-label-swap | 0 | True | False | uncovered-classifications-legal,raw-classification-row-comparison,raw-counts,order-stability |
| raw-classification-source-hash | 0 | True | False | archive-base-identity,raw-classification-source-hash |
| drift-fabricated-provenance | 0 | True | False | platform-source-binding,platform-offsets |
| platform-check-row-duplicate | 0 | True | False | platform-source-binding,platform-checks-exact-row-set,platform-offsets |
| shuffle-order | 0 | True | True |  |

All `37` indexed cases returned exit 0 and exitPass=true; 36 negative mutations were rejected by the validator, and shuffle-order remained valid.

## Manifest and byte verification

- Manifest entries checked: `53`; files checked: `53`; hash/size errors: `0`.
- Manifest SHA-256: `d024157fc856433b35cc26e5026f1100906972f5f89577d8ee4b2be30febbe8e`; recorded: `d024157fc856433b35cc26e5026f1100906972f5f89577d8ee4b2be30febbe8e`; match: `True`.
- Formal input SHA-256: `0d7e5f97d91e69852f15c313522e05587a2571d61489c72274e3944b47d6527a`.
- Historical corrupt archive SHA-256: `6f2503b9e86a63ab64647bf1e7e742f4e67840c0a1c0b91a8f859be3f963982f`.
- Raw classification source SHA-256: `89b1c30eb320c3074bf1d445f2a1628026a4f9c08e54b6879e3cc5ed1bfe3200`.

## Evidence boundary

- crossPlatformStatus=unavailable, proofLevel=not-proven; no Linux/Windows offset proof is promoted.
- 38 uncovered rows and 16 AC6.4 UNKNOWN pairs remain unresolved by design.
- source-use graphNodeIds remain explicitly missing.
- This record grants no SourceGraph, Candidate, Approval, Apply, or other production authorization.

## A-side decision

**AC-P6 v0.6 Phase 0 - ACCEPT**

Acceptance is limited to the evidence archive and validator replay at the exact PR #68 HEAD above. PR #68 remains Draft; no merge, production change, deployment, or Bolt run is authorized. C Phase 1 may submit its implementation plan. D browser observation remains HOLD pending C Phase 1 acceptance and observation-contract freeze.


