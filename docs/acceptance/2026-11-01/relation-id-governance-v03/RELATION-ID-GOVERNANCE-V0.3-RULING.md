# Relation ID Governance v0.3 Supplementary Ruling

Status: evidence-only design. Production Relation ID generation remains HOLD.

## Evidence binding

- v0.3 design archive: dd9ebde720e345ae05e7459c8e8706c1a0835ae9
- v0.3 source snapshot: 98ee336016c7d403e8e042f75e6e8505ad9be953
- v0.3 design document blob: 86fe58ab58e8c81bd4e5d234f27e7f2e06e9451e
- B source audit: b906f2b353e18991d9a09596419f7fca60c4c621
- current graph diagnosis: 84 duplicate Relation ID keys and 252 extra occurrences
- duplicated producer: css-selector-candidate / css-cascade / semantic-candidate

This supplement resolves the source-file digest choice and the mixed-producer identity policy. It does not change SourceGraph, Relation, B v5, D, E, or authorization contracts.

## 1. Source-file digest decision

Two executable schemes were evaluated.

| Case | A: digest in Graph Identity and migration Manifest | B: digest in Relation ID |
|---|---|---|
| Same span, declaration value changes | Relation ID stable; payload and graph digest change | Relation ID changes for every relation anchored in the file |
| Other file content after the span changes | Relation ID stable; source-file and graph digest change | All relations anchored in the file change ID |
| Other file content before the span changes | charOffset or byteOffset may change; affected IDs change | All file relations change, including unaffected spans |
| LF/CRLF change | Graph digest changes; only anchors whose offsets change get new IDs | Every relation in the file gets a new ID |
| UTF-8 multibyte text changes before a span | byteOffset changes for affected anchors; migration is local | Every relation in the file gets a new ID |
| Source position moves | Exact span changes, so the affected ID changes | File digest and span both change |
| Graph digest | Includes source-file digest and relation payload | Includes source-file digest, relation payload, and churned IDs |
| Migration cost | Limited to changed spans, moved anchors, and producer changes | Potentially all relations in every changed file |

### Recommended decision: Scheme A

The canonical Relation ID tuple includes exact declaration identity, exact sourceUse, selectorScope, media context, endpoints, and offset units. It excludes the whole source-file digest.

The exact source-file digest is still mandatory in:

- the Graph Identity envelope;
- the migration Manifest;
- source-span evidence and artifact binding;
- graphDigest input.

This keeps relation identity stable when a declaration value changes at the same span or when unrelated bytes after an anchor change. It still creates a new relation identity when the actual declaration or sourceUse span changes. A source-file digest mismatch never proves that an old relation belongs to a new source snapshot; the Graph Identity and migration checks must report the version change.

Scheme B remains a possible future contract if A/E decide that every file-byte change must invalidate every relation anchored in that file. It is not the selected v0.3 design.

## 2. Recommended relation tuple

The selected tuple is:

    relationIdentityVersion
    producerIdentity.name
    producerIdentity.contractVersion
    kind
    from
    to
    definitionIdentity.id
    definition token name
    definition tokenOrigin
    definition source path
    definition charOffset
    definition byteOffset
    definition offsetUnit
    definition raw selectorScope
    definition canonical selectorScope
    definition selector parser version
    definition mediaContext
    sourceUse path
    sourceUse charOffset
    sourceUse byteOffset
    sourceUse offsetUnit
    relation raw selectorScope
    relation canonical selectorScope
    relation selector parser version
    relation mediaContext

The tuple does not contain declaration value, sourceRef trust, runtime route, viewport, or observation state. Those remain graph payload or runtime evidence.

The Graph Identity binding separately carries source file digests for every span used to construct the tuple:

    sourceBindings:
      - role: definition
        path
        sourceFileSha256
      - role: sourceUse
        path
        sourceFileSha256
      - role: consumer-source
        path
        sourceFileSha256

Missing consumer sourceRef remains missing. A source binding is provenance evidence; it is not a replacement for sourceRef.

## 3. Mixed producer policy

The formal graph envelope name is:

    graphIdentityVersion: sourcegraph-identity/v2

The policy schema is evidence metadata until A/E freeze a public contract:

    {
      "graphIdentityVersion": "sourcegraph-identity/v2",
      "policyManifestSha256": "...",
      "producerPolicies": [
        {
          "producerIdentity": "css-selector-candidate",
          "relationIdentityVersion": "relation-id/v1",
          "relationKinds": ["css-cascade"],
          "certaintySet": ["semantic-candidate"],
          "mode": "governed",
          "producerEvidenceRef": "..."
        },
        {
          "producerIdentity": "legacy-default",
          "relationIdentityVersion": "legacy",
          "relationKinds": ["imports", "reads", "renders", "uses-token", "token-reference", "asset-consumer", "same-copy", "semantic-link"],
          "mode": "legacy",
          "producerEvidenceRef": "..."
        }
      ]
    }

### Producer determination

The current Relation shape has no producerIdentity field. A Relation ID prefix alone is not trusted.

Producer identity must come from an independently bound producer evidence artifact generated by the exact analyzer build. The artifact must contain, for every edge occurrence:

    graphSha256
    relationId
    occurrenceOrdinal
    payloadSha256
    producerIdentity
    producerImplementationSha
    producerImplementationTree
    producerContractVersion
    policyVersion

The edge occurrence key is:

    graphSha256 + relationId + occurrenceOrdinal + payloadSha256

The validator checks that every graph edge occurrence appears exactly once in the producer evidence artifact. An unmapped or multiply mapped edge makes identity validation unavailable.

Relation kind, certainty, endpoint shape, or ID prefix can be consistency checks, but none is sufficient to assign a trusted producer policy without the exact producer evidence artifact.

### Policy validation

1. Verify the graph artifact SHA-256 and source commit/tree.
2. Verify the producer evidence artifact SHA-256 and exact analyzer implementation.
3. Resolve every edge occurrence to exactly one producer policy.
4. For governed css-selector-candidate edges, recompute relation-id/v1.
5. For legacy edges, enforce legacy ID uniqueness and preserve their payload.
6. Reject a policy map that assigns one edge occurrence to multiple producers.
7. Reject an edge with no policy mapping; do not fall back to the ID prefix.

## 4. Policy impact on graphDigest

The canonical graph digest input includes:

    sourcegraph-identity/v2
    policyManifestSha256
    producer implementation identities
    relationIdentityVersion for each governed policy
    sorted edge occurrences
    node payloads
    source-file bindings

Therefore:

- changing a producer policy changes graphDigest even if edge payloads are unchanged;
- changing relation-id/v1 to another relation version changes graphDigest;
- changing producer implementation evidence changes graphDigest;
- changing only an unrelated edge ordering does not change graphDigest;
- missing or contradictory policy evidence yields graphDigestStatus=unavailable;
- duplicate legacy IDs still fail uniqueness validation;
- policy metadata never upgrades semantic-candidate, source-proven, UNKNOWN, or runtime-observed certainty.

## 5. Migration impact matrix

| Change | Relation ID under A | Graph Identity / Manifest | Migration |
|---|---|---|---|
| Declaration value at same span | stable | payload and source-file digest change | no ID migration; payload audit required |
| Unrelated bytes after span | stable | source-file and graph digest change | no ID migration |
| Unrelated bytes before span | affected charOffset/byteOffset may change | digest changes | migrate affected spans only |
| LF/CRLF before span | affected offsets change | digest changes | migrate affected spans only |
| LF/CRLF after span | ID stable if offsets stay stable | digest changes | no ID migration |
| UTF-8 multibyte text before span | byteOffset changes | digest changes | migrate affected spans only |
| UTF-8 multibyte text after span | ID stable if span unchanged | digest changes | no ID migration |
| Declaration/sourceUse moved | span tuple changes | digest changes | deterministic rename |
| SelectorScope changes | selector identity changes | digest changes | deterministic rename or split |
| Media context changes | media identity changes | digest changes | deterministic rename or split |
| Producer policy changes | governed IDs may change | policy and graph digest change | manifest required |

## 6. Migration status rules

- retained: one old occurrence, exact tuple and payload compatibility, and the selected contract explicitly permits retaining the old canonical string.
- renamed: one old occurrence maps to one new ID; endpoints, sourceUse, sourceRef payload, certainty, and required source bindings agree.
- split: one old ID has multiple occurrences and each occurrence has a complete, distinct tuple.
- ambiguous: more than one new candidate remains possible for an old occurrence.
- unresolved: source span, old graph hash, payload digest, producer mapping, selectorScope, or policy evidence is missing or contradictory.
- orphaned: a verified producer change removes an old occurrence and no new relation corresponds to it.

oldOccurrenceOrdinal remains an audit index inside one fixed old graph only. It is never used to construct a new ID and cannot recover sourceRef or runtime identity.

## 7. Key regression vectors

### Determinism

- Same source bytes on Linux and Windows produce the same ID.
- Chinese, emoji, and other non-ASCII text retain exact UTF-16 and UTF-8 offsets.
- No NFC/NFD conversion occurs.
- LF/CRLF changes affect source-file binding and only affect IDs whose spans move.
- Object key and input array order changes do not affect IDs.

### Identity separation

- Same endpoint with different definition identity produces different IDs.
- Same endpoint with different raw selectorScope produces different IDs even when canonical selector text matches.
- Same selector and endpoint under different media context produces different IDs.
- Same ID with different payload is rejected.
- Same ID with equal payload is also rejected; no silent collapse.

### Mixed producer policy

- A css-selector-candidate edge without producer evidence is unavailable, not governed.
- A legacy edge with duplicate ID fails legacy uniqueness validation.
- A policy swap without edge changes changes graphDigest.
- An ID prefix that claims css-selector-candidate but lacks matching producer evidence is rejected.
- An edge mapped to two policies is rejected.
- An edge mapped to no policy remains unresolved.

### Existing semantics

- Source-proven payload and endpoint sets remain equal.
- Existing sourceRef values remain unchanged; missing sourceRef remains missing.
- B v5 matcher, probe, thresholds, exit codes, and UNKNOWN rows remain unchanged.
- semantic-candidate never becomes source-proven.
- AC6.2 rowId and AC6.4 pairId meanings remain unchanged.
- sourceUse, charOffset, byteOffset, and source span semantics remain unchanged.

## 8. A sign-off items

A must explicitly approve:

1. Scheme A as the relation identity rule.
2. Exclusion of whole sourceFileSha256 from relation-id/v1.
3. Inclusion of source-file digests in sourcegraph-identity/v2 and migration manifests.
4. The producer evidence artifact and edge occurrence key.
5. The mixed governed/legacy policy schema.
6. Legacy uniqueness validation for all non-governed producers.
7. graphDigestStatus=unavailable for missing, contradictory, or duplicate policy evidence.
8. The proposed future production file whitelist.

E must sign that static Relation ID and Graph Identity do not imply sourceRef trust or runtime-observed evidence.

## 9. Scope lock

This supplementary ruling changes no production code, public Schema, B v5 matcher or threshold, D graphDigest implementation, E observation binding, Runtime Identity, Candidate, Scope, Verification, Approval, Apply, or Rollback gate.
