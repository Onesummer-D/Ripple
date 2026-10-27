# PR #61 AC-P6 independent rerun @ 2ebd1e20

- Exact C+D HEAD: `2ebd1e20d043287edbbfc2ec31c10f15688a4499`
- This is the LF-cleanup commit after `5c1cd6c78c47de0ea0d32a6278fe5ad2d30cfe8c`; the changed file is `src/core/project-data-routes.test.ts`.
- Frozen B evaluator base: `0c02b85cdf7b1d52821fee3e06c013cbd664efa8`
- Fixed third-party project: `allanhue/webportflio@b244f857457d2a07f118155602eef9097fd322bd`
- Fixed `src/css/style.css` SHA-256: `8de0b6c59beb8538534adcbd5bb20906bda6b6ca7b9e3998702a229a2506a920`
- Result: `3 PASS / 2 PENDING / 0 ERROR / exit 2`
- Machine JSON SHA-256: `289EDDE457393F499BF53ECD85379B874E6BDE4782949E08418194723CC0571B`

The unchanged v5 probe produced the same graph and contract result as 5c: 675 nodes / 5302 edges / 253 unresolved; AC6.1 PASS, AC6.2 PENDING, AC6.3 PASS, AC6.4 PENDING, AC6.5 PASS; AC6.2 1/8 tokens strict-covered and 85/123 source-use rows covered; AC6.4 131/147 anchored and 16 UNKNOWN.

```text
node --experimental-transform-types --loader ./scripts/ts-extension-loader.mjs ./scripts/b-css-token-probe.mjs <fixed-project-root> --acceptance --json <acceptance.json> --expect-core-sha 2ebd1e20d043287edbbfc2ec31c10f15688a4499
```

The raw machine report and human-readable report are stored on this evidence branch only. No matcher threshold, production code, merge, deployment, or Bolt action was changed.

