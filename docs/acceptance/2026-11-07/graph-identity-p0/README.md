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
- E PR #73 latest head: `44649afa1d698fd77fd0e445e473e135995dc5c3`
- E historical head: `944161c042cfe16184e4122143c0b545e7f16e67` (comparison only)

## Files

- `docs/architecture/graph-identity-p0-design-2026-11-07.md`: contract, implementation boundary, E comparison, risks and A/E sign-off items.
- `docs/architecture/graph-identity-p0-contract-decisions-2026-11-07.md`: D G0 version relation, Graph Digest/provenance/Host Binding layer decisions.
- `docs/acceptance/2026-11-07/graph-identity-p0/graph-identity-p0-vectors.json`: golden and negative vectors.
- `docs/acceptance/2026-11-07/graph-identity-p0/producer-manifest-schema-v0.json`: proposed producer manifest shape and rejection rules.
- `docs/acceptance/2026-11-07/graph-identity-p0/contract-decision-vectors.json`: machine-readable layer and fail-closed vectors.
- `docs/acceptance/2026-11-07/graph-identity-p0/sha256-manifest.txt`: final GitHub file-byte hashes for this evidence package.

## Contract consistency checks

```powershell
node -e "for (const f of process.argv.slice(1)) { JSON.parse(require('fs').readFileSync(f,'utf8')); console.log(f, 'JSON OK') }" `
  docs/acceptance/2026-11-07/graph-identity-p0/graph-identity-p0-vectors.json `
  docs/acceptance/2026-11-07/graph-identity-p0/producer-manifest-schema-v0.json

git diff --check
node -e "const fs=require('fs'); const v=require('./docs/acceptance/2026-11-07/graph-identity-p0/contract-decision-vectors.json'); const s=require('./docs/acceptance/2026-11-07/graph-identity-p0/producer-manifest-schema-v0.json'); const m=fs.readFileSync('./docs/architecture/graph-identity-p0-contract-decisions-2026-11-07.md','utf8'); if (s.canonicalGraphDigest.fields.join('|') !== v.contractFieldMatrix.graphDigestV2.fields.join('|')) throw new Error('GraphDigest field matrix mismatch'); if (s.provenanceAttestation.graphProvenanceVersion !== v.layers.provenanceAttestation) throw new Error('provenance version mismatch'); if (v.vectors.find(x => x.id === 'legacy-reduced-graph-replay').noRawArtifactClaim !== true) throw new Error('legacy replay claim mismatch'); for (const f of v.contractFieldMatrix.graphDigestV2.fields) if (!m.includes('`'+f+'`')) throw new Error('Markdown field missing: '+f); if (!m.includes('superseded-not-executable') || !m.includes('sourcegraph-provenance/v1')) throw new Error('Markdown contract marker missing'); console.log('contract consistency OK')"
```

Expected design-only scope: two architecture documents and five evidence files under
`docs/`; `git diff --name-only d1c941da` must not contain `src/` or `model.ts`.

The legacy reduced replay computes `ff8735ed...`; the D document table lists
`4b061992...` for the formal GraphIdentityV2 target. The referenced formal
`docs/acceptance/2026-10-31/vectors/g0.json` bytes are not present in the D contract
commit tree, so this package records the field contract and both historical values while
keeping the formal input `not-proven`. The replay is not claimed as `raw-sourcegraph/v1`.
