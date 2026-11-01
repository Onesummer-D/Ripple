# Raw Graph, Producer Evidence, and Graph Digest Contract v0.3

Status: evidence-only contract supplement. Production implementation remains HOLD.

This document narrows the v0.3 ruling to the non-circular dependency chain used by
`sourcegraph-identity/v2`. It does not modify `Relation`, B v5, D, E, Runtime
Identity, or any authorization gate.

## 1. Dependency graph

The calculation order is fixed:

```text
raw analyzer output
  -> canonical raw graph artifact
  -> rawGraphArtifactSha256
  -> producer evidence (bound to the raw hash and exact analyzer build)
  -> producerEvidenceSha256
  -> policy manifest (bound to raw hash and producer evidence hash)
  -> policyManifestSha256
  -> final graph digest
```

`policyManifest` never contains `graphDigest` or `graphDigestSha256`. The final
digest never participates in either the producer evidence hash or the policy
manifest hash. This prevents a hash cycle.

## 2. Canonical raw graph artifact

`rawGraphArtifactSha256` is SHA-256 over the UTF-8 bytes of the canonical JSON
encoding of this envelope:

```json
{
  "artifactVersion": "raw-sourcegraph/v1",
  "nodes": [],
  "edges": [],
  "unresolved": [],
  "sourceBindings": []
}
```

The envelope contains the analyzer's graph content and source-file bindings only.
It excludes producer evidence, policy manifests, graph digests, and mutable run
timestamps. Every object is encoded with RFC 8785 JSON Canonicalization Scheme
(JCS): no Unicode normalization, UTF-8 output, finite JSON numbers only, and
lexicographic member ordering.

Before canonical encoding, arrays are sorted by explicit stable keys:

| Array | Sort key |
|---|---|
| `nodes` | `[id, kind, sourceRef ?? "", payloadSha256 ?? ""]` |
| `edges` | `[relationId, kind, from, to, certainty, payloadSha256, sourceUse.path ?? "", sourceUse.byteOffset ?? -1, sourceUse.charOffset ?? -1, selectorScope.raw ?? "", mediaContext ?? ""]` |
| `unresolved` | `[id, reason, sourceRef ?? "", byteOffset ?? -1, charOffset ?? -1]` |
| `sourceBindings` | `[role, path, sourceFileSha256]` |

The sort keys are comparison tuples, not serialized identity fields. Equal keys
remain repeated records; they are never silently collapsed. `charOffset` remains
the source primitive in UTF-16 code units and `byteOffset` remains the source
primitive in UTF-8 bytes. LF/CRLF and Unicode byte changes are therefore visible
through source bindings and the relevant span fields.

After sorting, the zero-based position of an edge in the canonical `edges` array
is its `occurrenceOrdinal`. This ordinal is an audit locator for one fixed raw
graph; it is not part of `relation-id/v1` and cannot establish source or runtime
identity by itself.

## 3. Producer evidence binding

The producer evidence artifact is hashed separately. Its required envelope is:

```json
{
  "evidenceVersion": "producer-evidence/v1",
  "graphIdentityVersion": "sourcegraph-identity/v2",
  "rawGraphArtifactSha256": "<raw hash>",
  "analyzerBuild": {
    "implementationSha": "<commit>",
    "implementationTree": "<tree>",
    "relevantBlobs": [{"path": "<path>", "blobSha": "<blob>"}],
    "toolVersion": "<exact tool version>",
    "lockfileSha256": "<lockfile hash>"
  },
  "edgeOccurrences": []
}
```

Each `edgeOccurrences` record contains:

```json
{
  "occurrenceOrdinal": 0,
  "relationId": "<relation id>",
  "payloadSha256": "<edge payload hash>",
  "producerPolicyId": "<policy id>",
  "producerIdentity": "<producer name>",
  "producerContractVersion": "<contract>",
  "policyVersion": "<policy version>"
}
```

The unique evidence lookup key is:

```text
[rawGraphArtifactSha256, occurrenceOrdinal, relationId, payloadSha256]
```

The analyzer build is trusted only when the implementation commit, tree, relevant
blob set, tool version, and lockfile hash are verified against the run that emitted
the raw graph. A producer evidence file that merely names a runner, path, or ID
prefix is insufficient.

Every canonical raw edge occurrence must appear exactly once in producer evidence.
Missing, duplicate, or conflicting records produce `graphDigestStatus=unavailable`
and `producerEvidenceStatus=rejected`; they never fall back to an ID prefix.

## 4. Policy manifest binding

The policy manifest is canonicalized and hashed without its own hash field. It
contains the raw hash and producer evidence hash, but never the final graph digest:

```json
{
  "policyManifestVersion": "producer-policy/v1",
  "graphIdentityVersion": "sourcegraph-identity/v2",
  "rawGraphArtifactSha256": "<raw hash>",
  "producerEvidenceSha256": "<producer evidence hash>",
  "producerPolicies": [
    {
      "policyId": "governed-css-selector-candidate-v1",
      "producerIdentity": "css-selector-candidate",
      "relationIdentityVersion": "relation-id/v1",
      "relationKinds": ["css-cascade"],
      "certaintySet": ["semantic-candidate"],
      "mode": "governed",
      "producerEvidenceRef": "<evidence artifact ref>"
    },
    {
      "policyId": "legacy-default-v1",
      "producerIdentity": "legacy-default",
      "relationIdentityVersion": "legacy",
      "relationKinds": ["imports", "reads", "renders", "uses-token", "token-reference", "asset-consumer", "same-copy", "semantic-link"],
      "mode": "legacy",
      "producerEvidenceRef": "<evidence artifact ref>"
    }
  ]
}
```

`producerPolicies` are sorted by `policyId`; nested arrays are sorted by their
canonical string values. The validator checks that every evidence record's
`producerPolicyId`, identity, contract version, relation kind, and certainty are
accepted by exactly one manifest policy. No policy is inferred from the relation
ID prefix, endpoint shape, or certainty alone.

## 5. Final graph digest

`graphDigestSha256` is computed only after the three prior artifacts validate. Its
canonical input envelope is:

```json
{
  "graphIdentityVersion": "sourcegraph-identity/v2",
  "rawGraphArtifactSha256": "<raw hash>",
  "producerEvidenceSha256": "<producer evidence hash>",
  "policyManifestSha256": "<policy hash>",
  "sourceBindings": [],
  "nodes": [],
  "edgeOccurrences": [],
  "unresolved": []
}
```

`edgeOccurrences` are sorted by the same canonical edge tuple plus
`occurrenceOrdinal`; repeated occurrences remain repeated. `sourceBindings`, nodes,
and unresolved records use the raw artifact ordering rules above. The final digest
therefore changes for graph content, source bytes, producer build/evidence, or
policy changes, but not for input array order or JSON member order.

| Change | Raw hash | Producer evidence hash | Policy hash | Final graph digest |
|---|---:|---:|---:|---:|
| Edge/node/source content changes | changes | must be regenerated | may stay valid only if hashes are updated | changes |
| Producer implementation/evidence changes | unchanged if raw graph is unchanged | changes | must be regenerated | changes |
| Policy mapping/version changes | unchanged | unchanged | changes | changes |
| Input ordering/member ordering only | unchanged | unchanged | unchanged | unchanged |
| Missing/multiple/conflicting producer mapping | unchanged | may hash, but status is rejected | not accepted | `unavailable` |

The last row is a validation outcome, not a digest value. A consumer must not treat
an unavailable digest as a graph identity proof.

## 6. Migration decisions

The migration manifest binds each old occurrence to the old graph and payload:

```json
{
  "oldGraphSha256": "<old raw graph hash>",
  "oldRelationId": "<old id>",
  "oldOccurrenceOrdinal": 0,
  "oldPayloadSha256": "<old payload hash>",
  "newRelationIds": ["<new id>"],
  "status": "retained|renamed|split|unresolved",
  "reason": "<machine reason>",
  "newPayloadSha256": ["<new payload hash>"]
}
```

Machine rules:

- `retained`: exactly one new occurrence, same canonical ID, exact required tuple
  and payload compatibility, and the policy explicitly permits retaining the old
  string.
- `renamed`: exactly one new occurrence, different ID, with one-to-one endpoint,
  sourceUse, sourceRef, selectorScope, media, and producer-policy agreement.
- `split`: one old `oldRelationId` group has multiple old occurrences and the
  validated mapping assigns each occurrence to a distinct new ID; no occurrence is
  dropped or merged.
- `unresolved`: no unique mapping, missing/contradictory old hash or payload,
  missing source span or producer policy, or ambiguous candidates. An unresolved
  record remains fail-closed.

`oldOccurrenceOrdinal` is only an index in the fixed old graph. It is never a new
ID and cannot restore sourceRef trust, source-proven status, or runtime identity.

## 7. A/E sign-off items

A must approve:

1. The raw artifact envelope and explicit array sort keys.
2. The canonical occurrence ordinal and evidence lookup key.
3. The analyzer build fields required for producer evidence.
4. The policy manifest fields and its non-circular hash boundary.
5. The final digest input envelope and unavailable result for missing, duplicate,
   or conflicting producer evidence.
6. The migration status rules and old occurrence binding.

E must confirm that producer evidence and graph digests do not imply `sourceRef`
trust, `source-proven`, or `runtime-observed` evidence.

## Scope lock

This supplement changes no production code, `model.ts`, public Schema, B v5
matcher/probe/thresholds, D implementation, E runtime pairing, Runtime Identity,
Candidate, Scope, Verification, Approval, Apply, or Rollback gate.
