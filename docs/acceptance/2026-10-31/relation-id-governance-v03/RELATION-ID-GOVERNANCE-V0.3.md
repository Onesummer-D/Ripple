# Relation ID Governance Candidate v0.3

Status: evidence-only design. Production implementation is HOLD pending A contract freeze and E V2 approval.

## Evidence binding

This document is based on the independent B1.1 Relation ID diagnostic snapshot:

- evidence base commit: 98ee336016c7d403e8e042f75e6e8505ad9be953
- evidence base tree: 6ff0b99d187e3d42468ef3a423834683a511d500
- production implementation audited by B: 34d2a22e696c9eb1af15d5cd9800cf76b7cf7883
- source audit reviewed: b906f2b353e18991d9a09596419f7fca60c4c621
- fixed project: allanhue/webportflio@b244f857457d2a07f118155602eef9097fd322bd
- current graph fact: 84 duplicate Relation ID keys and 252 extra occurrences, all css-cascade / semantic-candidate

The B source audit confirms that token-use source anchors, JSX consumer nodes, and runtime evidence are separate layers. Relation ID uniqueness does not create sourceIdentity, sourceRef trust, or runtime-observed evidence.

## 1. Version and producer scope

### Selected v0.3 scope

relation-id/v1 applies only to the currently duplicated producer:

    producer = css-selector-candidate
    relation kind = css-cascade
    certainty = semantic-candidate

All other existing Relation IDs retain their legacy strings and producer rules in this slice. No global regeneration is promised, and no claim is made that all historical IDs remain canonical forever.

### Mixed-producer graph declaration

A future graph envelope may declare the mixed policy without changing the public Relation shape:

    graphIdentityVersion: graph/v2
    relationIdentityPolicies:
      - producer: css-selector-candidate
        relationIdentityVersion: relation-id/v1
        mode: governed
      - producer: '*'
        relationIdentityVersion: legacy
        mode: legacy

Validation requires every governed producer to satisfy its declared algorithm, legacy producers to retain unique IDs, and the policy map to be bound to the graph artifact. Missing, contradictory, or unknown policy entries make identity validation unavailable; they do not upgrade evidence. graphIdentityVersion is the graph envelope version and is never reused as relationIdentityVersion.

### Alternative all-producer migration

Regenerating every Relation would require a separate contract and graph version, a complete old-to-new manifest, source-proven payload and endpoint equality checks, legacy aliases, graphDigest versioning, and downstream compatibility review. That alternative is outside v0.3 and is not authorized.

## 2. Candidate relation tuple

    relationIdentityVersion: relation-id/v1
    producerIdentity:
      name: css-selector-candidate
      contractVersion: css-cascade-producer/v1
    kind: css-cascade
    from: token-use:src/css/footer.css#952
    to: jsx:src/layouts/Footer.jsx#620
    definitionIdentity:
      id: token:src/css/style.css#297
      token: --accent
      tokenOrigin: css-custom-property
      sourceSpan:
        path: src/css/style.css
        charOffset: 297
        byteOffset: 297
        offsetUnit: code-unit
        sourceFileSha256: exact source bytes
      selectorScope:
        raw: :root
        canonical: :root
        parserVersion: selector-subset-v1
      mediaContext: []
    sourceUse:
      path: src/css/footer.css
      charOffset: 952
      byteOffset: 952
      offsetUnit: code-unit
      sourceFileSha256: exact source bytes
    selectorScope:
      raw: .footer-cta
      canonical: .footer-cta
      parserVersion: selector-subset-v1
    mediaContext: []

The declaration value is excluded from identity. A value edit keeps relation identity and changes graph payload/digest. sourceRef is not inferred from this tuple; absent sourceRef remains absent.

## 3. Deterministic generation

    makeRelationId(input):
      require producerIdentity, kind, from, to
      require exact sourceUse, definition identity, selectorScope, and media context
      tuple = validateAndFreeze(input)
      tuple = recursivelySortObjectKeys(tuple)
      bytes = UTF8(canonicalJson(tuple))
      return rel:relation-id/v1:css-selector-candidate:SHA256(bytes)

Rules:

- No emission order, array index, random value, timestamp, or process identity.
- Repository-relative slash paths; preserve path case.
- Do not apply Unicode NFC or NFD conversion.
- Do not normalize LF or CRLF in source fields.
- Reject unpaired surrogates and invalid scalar values.
- Preserve raw selector and media prelude; canonical data is additive.
- Keep UTF-16 charOffset and UTF-8 byteOffset distinct.
- Do not convert offsets between platforms.
- sourceFileSha256 binds exact source bytes.
- Semantic arrays preserve order; unordered metadata is sorted.

The same source bytes yield the same ID on Linux and Windows. A LF/CRLF change or any other source-byte change creates a new source binding and therefore a new relation identity.

## 4. Producer and definition identity

Producer identity is a stable logical contract name, not a module path or source line:

| producer | relation kind | role |
|---|---|---|
| css-token-reference | token-reference | declaration to token-use |
| css-token-use | uses-token | token-use to declaration |
| css-selector-candidate | css-cascade | token-use to JSX host |
| css-token-consumer | uses-token | JSX host to declaration |

Only css-selector-candidate is governed by relation-id/v1 here.

Definition identity must distinguish token name, tokenOrigin, definition file, charOffset, byteOffset, offsetUnit, exact source-file digest, raw/canonical selectorScope, and media context. definition.id remains an audit input and is not the sole identity unless those fields validate. Token value is payload data, not identity data. Unsupported selectors cannot gain trusted CSS consumer evidence from having a stable-looking ID.

## 5. Duplicate handling

### Same ID and same payload

Classify as duplicate-same-payload. Keep every historical occurrence, compare complete payload digests, reject strict uniqueness validation, and leave migration unresolved until an explicit equivalence contract exists.

### Same ID and different payload

Classify as duplicate-conflicting-payload. Compare endpoint, kind, certainty, sourceUse, selectorScope, media context, and evidence references. If the complete tuple separates occurrences, map them as deterministic split; missing or contradictory identity fields remain unresolved. Never select by array order.

## 6. Migration Manifest

    schemaVersion: 1
    kind: sourcegraph-relation-id-migration
    relationIdentityVersionFrom: legacy
    relationIdentityVersionTo: relation-id/v1
    graphIdentityVersion: graph/v2
    oldGraph: { commit, tree, sha256 }
    newGraph: { commit, tree, sha256 }
    producerPolicy: [{ producer: css-selector-candidate, from: legacy, to: relation-id/v1 }]
    entries:
      - oldGraphSha256
        oldRelationId
        oldOccurrenceOrdinal
        oldOccurrenceCount
        oldPayloadSha256
        oldPayloadClass
        candidateTupleSha256
        newRelationIds
        mappingStatus
        reasonCode
        sourceProvenCompatibility
        sourceRef
        sourceUse
        selectorScope
        mediaContext
    summary: { retained, renamed, split, ambiguous, unresolved, orphaned }

oldOccurrenceOrdinal is only an audit index inside one fixed old graph. It is bound to oldGraphSha256 + oldRelationId + oldOccurrenceOrdinal + oldPayloadSha256; it is never a new Relation ID and never proves source identity, sourceRef, or runtime identity.

Machine statuses:

- retained: one old occurrence, exact tuple and payload compatibility, canonical ID intentionally preserved.
- renamed: one old occurrence maps deterministically to one new ID.
- split: one old ID has multiple occurrences and each maps deterministically to a distinct new ID.
- ambiguous: multiple new candidates remain possible.
- unresolved: required span, declaration, scope, payload, or graph binding is missing or contradictory.
- orphaned: no corresponding new relation after a verified producer change.

Same-payload duplicates default to unresolved. Different-payload duplicates can be split only when the complete tuple distinguishes every occurrence.

## 7. Compatibility and tests

### RI-DET

- Chinese and other non-ASCII selector/token text without NFC/NFD conversion.
- UTF-16 code-unit offsets and UTF-8 byte offsets verified independently.
- LF and CRLF source snapshots produce different file bindings and IDs.
- Identical source bytes on Linux and Windows produce identical IDs.
- Shuffled input arrays and reordered object keys produce identical IDs.
- Different source bytes with equal visible text do not merge.
- Different raw selectorScope with equal canonical selector produces different IDs.
- Different media nesting order produces different IDs.

### RI-DUP

- Same ID/same payload is rejected.
- Same ID/different selectorScope is rejected and classified as payload conflict.
- Same ID/different endpoint is rejected as identity collision.
- Missing sourceUse cannot produce a fallback ID.
- Four-occurrence legacy groups keep every occurrence in the manifest.
- Reordered legacy graphs match by fixed graph binding and payload digest, never ordinal alone.

### Regression contracts

- Existing source-proven payload and endpoint sets remain equal.
- Existing sourceRef values remain unchanged; missing sourceRef remains missing.
- B v5 matcher, probe, thresholds, exit codes, and UNKNOWN rows remain unchanged.
- semantic-candidate never becomes source-proven.
- AC6.2 row IDs and AC6.4 pair IDs remain unchanged.
- sourceUse, sourceRef, rowId, pairId, charOffset, and byteOffset retain their current meanings.
- Duplicate IDs keep strict graph identity unavailable until governed migration completes.

## 8. Future production whitelist

After A/E authorization, proposed whitelist:

- src/core/project.ts
- new src/core/source-graph-relation-id.ts
- new src/core/source-graph-relation-id.test.ts
- src/core/project.test.ts
- offline migration generator under scripts/
- evidence-only migration manifest and contract documents

Excluded until separately authorized:

- src/core/model.ts
- Runtime Identity
- B v5 matcher/probe/thresholds
- D graphDigest implementation
- Candidate, Scope, Verification, Approval, Apply, Rollback
- E runtime pairing and observation binding

## 9. Contract gates

Production work remains blocked until:

1. A freezes relation-id/v1 tuple and mixed-producer declaration rules.
2. E signs the V2 observation contract and confirms that static Relation ID does not imply runtime-observed evidence.
3. B coverage evidence remains bound to exact source and graph artifacts.
4. A provides the explicit production file whitelist.

No production code, public Schema, B v5 threshold, Relation ID strategy, sourceRef semantics, or Runtime Identity contract is changed by this document.
