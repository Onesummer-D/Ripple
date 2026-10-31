# Ripple B AC-P6 B1.1 148-edge independent archive

## Archive identity

This evidence-only archive is based on the clean checkout:

- Archive base: `5b75fe699afce98638e6fd6ad110911d83389dc8`
- B1.1 implementation: `34d2a22e696c9eb1af15d5cd9800cf76b7cf7883`
- Original evidence snapshot: `6388abec96183cc28824dc2b7fa486e4e944d305`
- Archive documentation HEAD: `fb2efe35c447eadf262d55f1d9755bb26cecabda`
- Fixed third-party project: `allanhue/webportflio@b244f857457d2a07f118155602eef9097fd322bd`
- Frozen B v5 probe blob: `3431294c0807161432e0a7c986825ffc5263bc87`

The branch contains evidence files only. It does not alter PR #70, the B v5 matcher, thresholds, production SourceGraph code, or any lifecycle gate.

## Evidence origin

The matrix is the previously completed independent classification. No classification was rerun for this archive. The original exact B v5 command was:

```text
node --experimental-transform-types --loader ./scripts/ts-extension-loader.mjs ./scripts/b-css-token-probe.mjs <fixed-project-root> --acceptance --json <acceptance.json> --expect-core-sha 6388abec96183cc28824dc2b7fa486e4e944d305
```

The exact `6388abec` report had `3 PASS / 2 PENDING / 0 ERROR`, exit code `2`, and fixed project SHA `b244f857457d2a07f118155602eef9097fd322bd`. The archive HEAD `fb2efe35` is documentation-only and is not presented as a new B v5 execution identity.

## 148-row classification

The JSON retains all 148 original rows. Each row records AC type, old and new Relation IDs, selector/sourceUse, owner information, classification reason, and evidence payload.

| AC | valid-semantic-candidate | unsafe-old-association | unsupported-unknown | implementation-regression |
|---|---:|---:|---:|---:|
| AC6.2 (51) | 8 | 10 | 33 | 0 |
| AC6.4 (97) | 13 | 25 | 59 | 0 |
| Total (148) | 21 | 35 | 92 | 0 |

`valid-semantic-candidate` remains `semantic-candidate`; it is never `source-proven`. Dynamic className, unsupported/complex selectors, zero/multiple owners, custom component boundaries, Portal boundaries, and global selectors remain fail-closed.

The requested static forms `.foo`, `button`, `button.foo`, `.foo.bar`, and `.footer-links li a` are parser-supported forms only. A relation still requires one intrinsic static owner and a complete static ancestor chain.

## Graph and Relation ID boundary

The independent graph comparison retained 675 nodes, 253 unresolved records, 744 source-proven edges, and recorded the 5302-to-3046 edge change. Final Relation ID audit: 84 duplicate keys and 252 extra occurrences. All duplicate groups are `css-cascade` semantic candidates with selectorScope payload conflicts; no silent deduplication or renumbering is applied. GraphDigest compatibility is therefore rejected for D r3.

The ID is generated in `src/core/project.ts` inside the token-definition loop without definition identity. This is recorded as an audit finding, not changed by this archive.

## Formal status

- B1.1 static parsing slice: **ACCEPT WITH SCOPE**
- AC6.2: **PENDING**
- AC6.4: **PENDING**
- Relation ID uniqueness: **REJECT**
- Candidate / Scope / Verification / Approval / Apply / Rollback permissions: unchanged
- D runtime observation: remains locked

The SHA-256 manifest binds this archive's committed files and the raw independent evidence artifacts used to derive the matrix.
