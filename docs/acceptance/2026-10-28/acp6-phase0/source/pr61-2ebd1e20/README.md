# AC-P6 Phase 0 PR #61 input evidence

This directory contains the JSON.parse-valid B v5 acceptance input used to derive the Phase 0 matrix.

- Source PR #61 replay HEAD: `2ebd1e20d043287edbbfc2ec31c10f15688a4499`
- Source PR #61 replay base: `0c02b85cdf7b1d52821fee3e06c013cbd664efa8`
- Fixed project: `allanhue/webportflio@b244f857457d2a07f118155602eef9097fd322bd`
- Input: `acceptance-2ebd1e20-final.json`
- Input bytes: 1,035,281
- Input SHA-256: `289edde457393f499bf53ecd85379b874e6bde4782949e08418194723cc0571b`
- JSON.parse: pass
- AC6.2 extracted counts: 123 rows, 85 covered, 38 uncovered, 8 tokens, 1 closed, 7 unclosed
- AC6.4 extracted counts: 147 pairs, 131 static anchors, 16 UNKNOWN, 7 dynamic UNKNOWN

Replay command recorded by B v5:

```text
node --experimental-transform-types --loader ./scripts/ts-extension-loader.mjs ./scripts/b-css-token-probe.mjs <fixed-project-root> --acceptance --json <acceptance.json> --expect-core-sha 2ebd1e20d043287edbbfc2ec31c10f15688a4499
```

The malformed PR #65 archive remains separate historical evidence. This input is not relabeled as PR #65 acceptance output.
