# D-E0 G0 remote evidence archive

This directory is a standalone evidence-only archive. It preserves the original G0 fixture and independent Node/PowerShell recomputation outputs. It does not modify the historical D-E0 contract or acceptance report and does not enable D-P1 or any production collector.

## Replay

```text
node node-recompute.mjs
pwsh -NoProfile -File powershell-recompute.ps1
```

Both commands read `g0.json`, validate it against the archived serializer family, emit a full JSON result, and write the corresponding output file. `powershell-recompute.ps1` is a focused offline runner; `canonical-observation-digest.ps1` is the archived authority serializer source.

## Expected result

- fixture bytes: 1931
- fixture SHA-256: `f1bc951f493d2d404fafa7e764d397039fa44619496aa6f2107f5290e20152d3`
- canonical bytes: 1353
- canonical SHA-256: `8301d143ef0409e613f5e37d665011343787917c902478de65a18dab4b8ea87e`
- graph digest: `4b061992d5b8d61732d1c9da093dd643523c9a841dd8a86d9feeeaedb6f1627b`
- Node exit code: 0
- PowerShell exit code: 0

`manifest.json` binds each file SHA, the historical local evidence identity, the 2ee08975 authority candidate, and the remote archive base. The archive branch is intentionally standalone; it is not a production or contract rewrite.
