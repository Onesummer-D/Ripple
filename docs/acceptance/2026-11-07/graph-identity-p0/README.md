# Graph Identity P0 evidence-only package

This directory contains the Phase 1B design and machine-readable vectors only.
No production source, public model, B v5 matcher/probe, Runtime Identity, D
collector, E pairing, or authorization gate is changed.

## Inputs

- Design parent: `d1c941da77d4ab4bbcd7ae557052557628bcb27c`
- Tree: `46049ba554a9e7c3ef9048924607a5025342496f`
- Fixed project: `allanhue/webportflio@b244f857457d2a07f118155602eef9097fd322bd`
- D frozen contract blob: `f8c1e1642e58d96330835cdb7dd98c6d1d262815`
- D executable serializer blob: `bb70603a7e02e6cab0277024f7e115226bbb3af4`
- E PR #73 head: `944161c042cfe16184e4122143c0b545e7f16e67`

## Files

- `docs/architecture/graph-identity-p0-design-2026-11-07.md`: contract, implementation boundary, E comparison, risks and A/E sign-off items.
- `docs/architecture/graph-identity-p0-contract-decisions-2026-11-07.md`: D G0 version relation, Graph Digest/provenance/Host Binding layer decisions.
- `docs/acceptance/2026-11-07/graph-identity-p0/graph-identity-p0-vectors.json`: golden and negative vectors.
- `docs/acceptance/2026-11-07/graph-identity-p0/producer-manifest-schema-v0.json`: proposed producer manifest shape and rejection rules.
- `docs/acceptance/2026-11-07/graph-identity-p0/contract-decision-vectors.json`: machine-readable layer and fail-closed vectors.
- `docs/acceptance/2026-11-07/graph-identity-p0/sha256-manifest.txt`: final GitHub file-byte hashes for this evidence package.

## Local checks

```powershell
node -e "for (const f of process.argv.slice(1)) { JSON.parse(require('fs').readFileSync(f,'utf8')); console.log(f, 'JSON OK') }" `
  docs/acceptance/2026-11-07/graph-identity-p0/graph-identity-p0-vectors.json `
  docs/acceptance/2026-11-07/graph-identity-p0/producer-manifest-schema-v0.json

git diff --check
```

Expected design-only scope: two architecture documents and five evidence files under
`docs/`; `git diff --name-only d1c941da` must not contain `src/` or `model.ts`.

The D G0 executable replay currently computes `ff8735ed...`; the archived document
body lists `4b061992...` for the same named vector. This package records both values
and leaves the discrepancy as an explicit A/D sign-off item rather than choosing one
silently.
