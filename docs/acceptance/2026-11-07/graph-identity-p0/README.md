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

Run these commands from the repository root. Each command must exit with code 0.

```powershell
node -e "for (const f of process.argv.slice(1)) { JSON.parse(require('fs').readFileSync(f,'utf8')); console.log(f, 'JSON OK') }" `
  docs/acceptance/2026-11-07/graph-identity-p0/graph-identity-p0-vectors.json `
  docs/acceptance/2026-11-07/graph-identity-p0/producer-manifest-schema-v0.json `
  docs/acceptance/2026-11-07/graph-identity-p0/contract-decision-vectors.json

git diff --check

node -e "const fs=require('fs'),crypto=require('crypto'); const root='docs/acceptance/2026-11-07/graph-identity-p0'; const load=n=>JSON.parse(fs.readFileSync(root+'/'+n,'utf8')); const s=load('producer-manifest-schema-v0.json'), v=load('contract-decision-vectors.json'), g=load('graph-identity-p0-vectors.json'); const resolve=(o,p)=>p.split('.').reduce((x,k)=>x && x[k],o); const fields=s.graphDigestV2.fields; const ref=resolve(s,s.canonicalGraphDigest.fieldsRef); if(!Array.isArray(ref) || JSON.stringify(ref)!==JSON.stringify(fields)) throw Error('fieldsRef does not resolve to graphDigestV2.fields'); if(JSON.stringify(s.canonicalGraphDigest.includes)!==JSON.stringify(fields)) throw Error('canonicalGraphDigest.includes mismatch'); if(JSON.stringify(v.contractFieldMatrix.graphDigestV2.fields)!==JSON.stringify(fields)) throw Error('contract decision matrix mismatch'); if(s.provenanceAttestation.graphProvenanceVersion!==v.layers.provenanceAttestation) throw Error('provenance version mismatch'); const legacy=v.vectors.find(x=>x.id==='legacy-reduced-graph-replay'); if(!legacy || legacy.noRawArtifactClaim!==true || legacy.rawArtifactClaim!=='none' || legacy.status!=='legacy-unproven-replay') throw Error('legacy replay raw-artifact claim mismatch'); if(g.formalG0.inputBytesSha256!==null || g.formalG0.status!=='not-locatable-at-d-contract-commit') throw Error('formal G0 status mismatch'); const md=fs.readFileSync('docs/architecture/graph-identity-p0-contract-decisions-2026-11-07.md','utf8'); const tick=String.fromCharCode(96); for(const f of fields) if(!md.includes(tick+f+tick)) throw Error('Markdown field missing: '+f); if(!md.includes('superseded-not-executable') || !md.includes('sourcegraph-provenance/v1')) throw Error('Markdown marker missing'); const lines=fs.readFileSync(root+'/sha256-manifest.txt','utf8').trim().split(/\r?\n/).slice(5); if(lines.length!==6) throw Error('manifest entry count mismatch'); for(const line of lines){const m=line.match(/^([0-9a-f]{64})\s+(\d+)\s+(.+)$/); if(!m) throw Error('manifest line malformed'); const b=fs.readFileSync(m[3]); if(crypto.createHash('sha256').update(b).digest('hex')!==m[1] || b.length!==Number(m[2])) throw Error('manifest mismatch: '+m[3]);} console.log('contract matrix, provenance, legacy, Markdown and SHA-256 manifest OK')"

git diff --name-only d1c941da77d4ab4bbcd7ae557052557628bcb27c | ForEach-Object { if ($_ -notlike 'docs/*') { throw "non-doc file in scope: $_" } }
```

Expected design-only scope: two architecture documents and five evidence files under
`docs/`; `git diff --name-only d1c941da` must not contain `src/` or `model.ts`.

The legacy reduced replay computes `ff8735ed...`; the D document table lists
`4b061992...` for the formal GraphIdentityV2 target. The referenced formal
`docs/acceptance/2026-10-31/vectors/g0.json` bytes are not present in the D contract
commit tree, so this package records the field contract and both historical values while
keeping the formal input `not-proven`. The replay is not claimed as `raw-sourcegraph/v1`.
