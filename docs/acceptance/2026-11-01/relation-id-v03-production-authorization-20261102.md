# Ripple A · C Relation ID v0.3 Production Slice Authorization

Status: **AUTHORIZED AS A SEPARATE, MINIMAL DRAFT SLICE**

This authorization follows the evidence-only freeze in
`v2-contract-freeze-ruling-20261102.md`. It does not authorize D observation
wiring, Runtime Identity changes, VerificationRun changes or any authorization
gate change.

## Exact development base

- Candidate base commit: `6388abec96183cc28824dc2b7fa486e4e944d305`
- Candidate base Tree: `8455bfc0c6f2ff5491dad8a418c8b8a7bc78ba2e`
- Candidate base Parent: `6a6dba09d35efc8f80ea1d0ab0875c245f0197d6`
- Proposed branch: `feat/c-relation-id-v03-production-20261102`
- PR Base: exact `6388abec...` candidate branch, never `main`

Before coding, C must prove in a networked checkout that the exact base object
and Tree are available remotely, and that the new branch is descended from that
commit. If the object cannot be resolved, implementation remains HOLD.

## Production file whitelist

Allowed in the first PR:

- a dedicated Relation ID canonicalization module under `src/core/`;
- minimal Relation ID producer call-site hunks in `src/core/project.ts`;
- dedicated Relation ID tests and fixtures;
- the v0.3 contract, migration and evidence documents.

Forbidden:

- `src/core/model.ts` and Runtime Identity model/reason enums;
- `runtime-identity-*`, `verification-runner`, `verification-execution`;
- D observation/collector files;
- E pairing or F/UI files;
- Candidate, ScopeDecision, Verification, Approval, Apply and Rollback gates;
- B v5 matcher/probe or thresholds;
- `package.json`, `package-lock.json`, deployment and workflow files.

## Required implementation checks

1. Scheme A tuple excludes the whole source-file SHA.
2. Kind, endpoints, producer identity, definition identity, sourceUse,
   selectorScope, media context and offset units are deterministic.
3. Same normalized tuple cannot emit multiple occurrences.
4. Same Relation ID with equal or different payload fails closed.
5. `rawGraphArtifactSha256 → producerEvidenceSha256 → policyManifestSha256 → final graphDigest`
   is non-circular and canonical bytes exclude self-reference.
6. Every edge occurrence maps exactly once to governed or legacy producer policy.
7. Missing/duplicate/conflicting producer evidence produces unavailable status.
8. Existing sourceRef/sourceUse/rowId/pairId/byteOffset semantics remain unchanged.
9. Static relations never upgrade semantic-candidate, unknown or JSX consumer proof.

## Independent B acceptance

B must run the frozen v5 matcher/probe without modifying it, against the exact
C implementation SHA and Tree. The report must include duplicate-ID rejection,
same/different payload collisions, selectorScope/media/source-span identity,
producer evidence missing/duplicate/conflict cases, retained/renamed/split/
unresolved migration cases and unchanged historical threshold results.

## HOLD and rollback conditions

Keep the PR HOLD or revert the slice if any of these occur:

- base SHA/Tree or producer implementation identity is not exact;
- a Relation ID depends on emission order, array position or random data;
- source-file SHA is inserted into the Relation ID tuple contrary to Scheme A;
- producer evidence is caller-authored, missing, multiply mapped or ambiguous;
- graphDigest can be computed from inconsistent raw/policy inputs;
- B v5 results or source-proven payloads regress;
- any Runtime Identity, VerificationRun, D, E, Scope or authorization file is touched;
- a semantic-candidate or JSX consumer relation is upgraded to strict proof.

The first C PR remains Draft until A and B independently review the exact
implementation SHA. This authorization is not a merge approval.

