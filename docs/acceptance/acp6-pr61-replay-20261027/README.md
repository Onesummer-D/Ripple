# PR #61 AC-P6 replay evidence

Evidence branch: `evidence/pr61-acp6-replay-20261027`
Branch base / PR #61 tested HEAD: `28d76e8cb44c5f697ce868ce44bfa8b5287b6273`
Prior comparison SHA: `1a2ec305bba0caa3877e4773feabe06c0605115c`
B probe/matcher baseline: `0c02b85cdf7b1d52821fee3e06c013cbd664efa8`
Fixed sample: `allanhue/webportflio@b244f857457d2a07f118155602eef9097fd322bd`
Fixed `src/css/style.css` SHA-256: `8de0b6c59beb8538534adcbd5bb20906bda6b6ca7b9e3998702a229a2506a920`

## Replay command

Run from the B/A source snapshot:

```text
node --experimental-transform-types --loader ./scripts/ts-extension-loader.mjs ./scripts/b-css-token-probe.mjs <fixed-project-root> --acceptance --json <acceptance.json> --expect-core-sha <core-sha>
```

## Results

For both `1a2ec305` and `28d76e8`:

- `status=PENDING; PASS=2; PENDING=3; ERROR=0; exit=2`
- AC6.1 PASS; AC6.2 PENDING; AC6.3 PENDING; AC6.4 PENDING; AC6.5 PASS.
- Graph: 650 nodes, 4656 edges, 253 unresolved.

AC6.4:

- 147 source-positioned consumer pairs; static anchor coverage 94/147 (63.95%).
- 53 uncovered pairs.
- 4 dynamic className candidate records across 2 files: `src/layouts/Nav.jsx` (1) and `src/pages/Home.jsx` (3).
- `componentLevelEdgesTotal=0`; the dynamic class gate remains PENDING.

AC6.2:

- 123 evaluated source-use rows (fixed CSS raw `var()` ground truth: 126).
- 73/123 strict-covered (59.35%); 50 rows have `linkedStrictEdges=0`.
- 8 source tokens; only `--skill-color` fully covered, 7 tokens remain uncovered.

AC6.3:

- Seven expected routes; `pageNodes=[]`, all seven `graphNodeIds=[]`, and no route identity conflict records.

AC6.5:

- Three `--accent-color` fallback uses retained as unknown at offsets 12715, 12991, 13078.

The two raw JSON reports are archived as both `acceptance-1a.json` / `acceptance-28d.json` and lossless gzip copies `acceptance-1a2ec305.json.gz` / `acceptance-28d76e8.json.gz`. No Candidate/Verification/Approval/Apply/Rollback changes were made.
