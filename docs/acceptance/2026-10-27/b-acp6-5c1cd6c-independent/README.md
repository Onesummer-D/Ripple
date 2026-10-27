# PR #61 AC-P6 first-slice independent acceptance

- Exact C+D HEAD: `5c1cd6c78c47de0ea0d32a6278fe5ad2d30cfe8c`
- Frozen B evaluator base: `0c02b85cdf7b1d52821fee3e06c013cbd664efa8`
- Fixed third-party project: `allanhue/webportflio@b244f857457d2a07f118155602eef9097fd322bd`
- Fixed `src/css/style.css` SHA-256: `8de0b6c59beb8538534adcbd5bb20906bda6b6ca7b9e3998702a229a2506a920`
- Machine report: `acceptance-5c1cd6c.json`
- Machine report SHA-256: `E9D549B7161090C6E69A56FE1D9E1D47562941C1E0A2CF1E7757D3AD85D741BD`
- Result: `3 PASS / 2 PENDING / 0 ERROR / exit 2`

## Exact replay

```text
node --experimental-transform-types --loader ./scripts/ts-extension-loader.mjs ./scripts/b-css-token-probe.mjs <fixed-project-root> --acceptance --json <acceptance.json> --expect-core-sha 5c1cd6c78c47de0ea0d32a6278fe5ad2d30cfe8
```

## Independent summary

- Graph: 675 nodes / 5302 edges / 253 unresolved.
- AC6.1 PASS; AC6.2 PENDING; AC6.3 PASS; AC6.4 PENDING; AC6.5 PASS.
- AC6.2: 1/8 tokens fully strict-covered; 85/123 source-use rows covered; 38 rows have zero strict edges.
- AC6.3: 7 unique routes, all bound by `routePath` to `page:/...` nodes at `src/App.jsx` source offsets.
- AC6.4: 131/147 anchored; 16 UNKNOWN = 9 static no exact edge + 7 dynamic className.
- AC6.5: 3 fallback unknown edges.
- Independent graph delta from frozen 650/4656: +7 route nodes, +18 JSX element nodes, +46 render edges, +300 uses-token edges, +300 css-cascade edges; unresolved remains 253.

The raw JSON and human-readable report are stored on this evidence branch only. No PR production files or acceptance thresholds were modified.

