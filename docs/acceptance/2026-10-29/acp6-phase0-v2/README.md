# AC-P6 Phase 0 canonical evidence archive

This nested directory is the sole canonical Phase 0 archive. The repository root `README.md` is the original Ripple project README; root-level Phase 0 snapshot files are removed in the repair commit. The previous nested snapshot is replaced by this exact archive, so reviewers must not use an older validator or replay log.

This directory is evidence-only. It contains the canonical Phase 0 matrix rebuilt from the recovered B `ed58cfd` JSON, the signed A taxonomy reference, the validator, and replay outputs. No production SourceGraph, B v5 matcher/probe, Runtime Identity, Candidate, Verification, Approval, Apply, Rollback, or threshold files are changed.

## Inputs

- Formal input: `acceptance-ed58cfd-final.json`
- Source commit: `ed58cfdc2892acaa9b97363a3414b1c219d07053`
- Recovery commit: `ba48108532bec0724614867182e69bd07277de96`
- Exact input SHA-256: `0d7e5f97d91e69852f15c313522e05587a2571d61489c72274e3944b47d6527a`
- Fixed project: `allanhue/webportflio@b244f857457d2a07f118155602eef9097fd322bd`
- JSON.parse: pass; bytes: 1,035,281
- PR Base for this repair archive: `d1d26185710c8e4d80182356f760109123bdc989`
- Raw classification evidence baseline: `c851bfe11e6851e01695f94246a5a571435d8faa`, blob `0716de01663f1a7efc370242c5809bf0990978fa`, SHA-256 `89b1c30eb320c3074bf1d445f2a1628026a4f9c08e54b6879e3cc5ed1bfe3200`

The prior `c851bfe11e6851e01695f94246a5a571435d8faa` archive remains intact in the parent evidence branch and is referenced by `legacy-archive-reference.json`. Its historical classification witness is not treated as the formal B acceptance JSON.

## Results

The matrix preserves all 123 source-use rows from the recovered JSON: 85 covered and 38 uncovered, across 8 tokens with 1 complete token and 7 incomplete tokens. AC6.4 remains 147 pairs, 131 anchored, and 16 UNKNOWN (9 static and 7 dynamic). Canonical primary counts are 3 global/theme, 21 no-static-anchor, 8 dynamic/ambiguous, 4 candidate-without-source-edge, and 2 pseudo/generated-content. Raw labels and secondary causes are retained per row. Source-use graphNodeIds are explicitly `missing` and never inferred.

## Reproduction

From this directory:

```text
node validate-acp6-v06-phase0-v2.mjs acp6-v06-phase0-gap-matrix-v2-20261029.json acceptance-ed58cfd-final.json --raw=raw-classification-source-c851bfe.json
```

The positive run exits 0. Negative mutations in `negative-run-index-v4.json` are expected to be detected by the validator and are recorded with their exit codes and failed checks in `reproduction-log.txt`. `shuffle-order` is the positive order-invariance case. The validator compares every source-use row, binds every raw classification row to the c851bfe source SHA, binds each platform input and each per-row platform copy to the trusted artifact/run/source identity, enforces `platform-checks-exact-row-set` (unique row IDs and exact equality with the 123-row formal set), rejects fabricated provenance even when offsets and driftRows are self-consistent, rejects invented graphNodeIds and invalid classifications, and keeps AC6.2 dynamic rows separate from AC6.4 dynamic UNKNOWN pairs.

The current evidence has no independently readable Windows artifact. The trusted platform binding therefore keeps `crossPlatformStatus=unavailable` and `proofLevel=not-proven`. `independent-equal` and `independent-drift-explained` require verified artifact bytes, run identity, core SHA, source-file SHA, and per-row provenance before they can pass; filling provenance fields alone cannot promote proof.

`clean-reproduction-log.txt` records a second replay from a separate directory containing only the archived matrix, recovered input, and validator. It includes the exact input hashes and process exit code for the positive, negative, and shuffled-order runs. The P1 clean replay is recorded in `clean-reproduction-log-v4.txt`; `manifest-validation-record.json` records its post-finalization manifest hash check and is intentionally excluded from the manifest to avoid a self-reference cycle.

## Archive identity

The PR base is `d1d26185710c8e4d80182356f760109123bdc989`. The raw classification evidence baseline is independently identified as `c851bfe11e6851e01695f94246a5a571435d8faa`; it is a row-level witness, not the formal B input. `manifest.json` lists every formal replay evidence file's byte length and SHA-256; self-referential metadata, the historical corrupt input, and `manifest-validation-record.json` are excluded. `manifest-sha256.txt` hashes the final manifest bytes, and the validation record checks that hash and all listed files. All files are written with LF and hashes refer to the exact bytes committed to GitHub.
