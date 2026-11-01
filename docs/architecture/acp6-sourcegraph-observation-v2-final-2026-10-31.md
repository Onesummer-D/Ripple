# AC-P6 SourceGraph Identity and Observation Binding v2

Status: **A/E final-review candidate; not frozen and not connected to production**

This document is an evidence-only contract revision. It changes no SourceGraph
generator, Relation ID generator, Runtime Identity v1.2, VerificationRun,
authorization gate, or production collector.

## 1. Version domains

| field | meaning | example |
| --- | --- | --- |
| `graphIdentityVersion` | binding protocol for a static graph identity | `sourcegraph-identity/v2` |
| `graphSchemaVersion` | node/relation/serialization shape | `acp6-sourcegraph/v1` |
| `relationIdentityVersion` | Relation ID canonicalization and duplicate rejection rules | `relation-id/v1` |
| `observationBindingVersion` | run-time envelope binding graph and capture tuple | `sourcegraph-observation-binding/v1` |

These versions are independent. `graphIdentityVersion` is not a schema version
and is not a Relation ID algorithm version.

## 2. Unified source fields

For this CSS source-use observation protocol, `sourceRef` is the side-local
`token-use` graph node ID and must equal `sourceUseRef.sourceRef` and
`sourceUseRef.graphNodeId`. This equality is not a rule for JSX/runtime
`sourceRef` values in Runtime Identity v1.2; those remain in their separate
namespace and are never converted into CSS observation mappings. `sourceRef`
is the existing graph-node ID. It is not a path and is not derived from a
browser selector.

`sourceUse` is a relation payload containing an exact source occurrence:

```ts
type SourceUse = {
  path: string
  charOffset: number       // zero-based UTF-16 code-unit offset
  byteOffset: number       // zero-based raw UTF-8 byte offset
  offsetUnit: 'code-unit'  // frozen literal; means UTF-16 code units
}
```

`sourceUseRef` is an observation reference, not a graph identity field:

```ts
type SourceUseRef = {
  sourceRef: string
  graphNodeId: string
  relationId?: string
  sourceUse: SourceUse
}
```

The side-local source mapping is explicit and deterministic: for an observation
reference, `sourceRef === sourceUseRef.sourceRef === sourceUseRef.graphNodeId`
and the selected side graph must contain exactly one node whose `id` equals
that value. The node must have the frozen SourceGraph kind `token-use`. This
is the only node-level sourceRef mapping used by this contract; an opaque
caller string, matching label, DOM selector or array position is not a source
mapping. The production `Relation` type currently has no `sourceIdentity`,
`sourceRef` or `sourceUseRef` field. V2 therefore requires an evidence-only,
host-built `sourceMappings[]` input constructed from independently verified
SourceGraph bytes and the trusted source snapshot. Each mapping contains
`projectId`, `sourceRef`, `graphNodeId`, `sourceAnchorRelationId`, a host-derived
`sourceIdentity`, and the exact `sourceUse`. It is valid only when its anchor
is a unique file-to-`token-use` `reads` / `source-proven` edge on the selected
side and its `projectId` equals the host-owned project identity in the
observation envelope. The source identity is
`source:<sourceDigest>:<path>:<charOffset>:<byteOffset>` and is included in the
graph canonical payload. A caller-provided opaque string never creates a
mapping. If the host mapping is absent, malformed, cross-side, or not backed by
the selected graph, the graph is `graph-schema-invalid` / unavailable and no
digest or trusted observation is produced. A declaration node (`token`, `file`,
`component`, `jsx-element` or any other non-`token-use` kind) is rejected with
`observation/declaration-node-not-source-use`.

For `partial`, `unknown`, `unavailable` and `stale` records, `relationId` may
be absent. A `complete` record must resolve exactly one relation in the side
graph and must provide `relationId`.

The host verifies, in order:

1. `sourceRef` resolves to one host mapping in the selected side;
2. `graphNodeId` resolves to the source-use/token-use node, never only a declaration node;
3. if present, `relationId` resolves to exactly one relation in that side graph;
4. relation endpoints and `sourceUse.path/charOffset/byteOffset/offsetUnit` equal the submitted values;
5. the relation's `sourceUse` is the same occurrence as the `sourceUseRef` occurrence;
6. the mapping project identity equals the envelope project registry identity.

The `trusted` result from this evidence-only helper is limited to the CSS
source-use mapping and its exact source span. It is not a JSX consumer proof.
In particular, a `reads`/`source-proven` relation whose target node is
`jsx-element` is rejected as `observation/non-strict-consumer-edge`; a static
source-use anchor cannot establish runtime DOM ownership, computed style,
cascade or JSX consumer strictness. Such consumer claims require a separate
runtime observation contract and remain fail-closed here.

The host trust root is the independently read and byte-verified side SourceGraph
and source snapshot. `sourceMappings[]` is a host-derived artifact, not a caller
trust root. The host constructs each mapping only after checking the side graph
digest, source digest, source snapshot bytes and the unique file → token-use
`reads` / `source-proven` anchor. A caller-supplied array is a claim and is
rejected when it is missing, forged, opaque, cross-project, stale, cross-side,
non-unique or inconsistent with the verified source location. The mapping
collection is included in graph canonical bytes, so replacing it changes the
graph digest and invalidates any binding that still names the old digest.

Missing `sourceRef` or `sourceUseRef` is not repaired from `recordId`, DOM
coordinates, selector text, source order or array position.

The validator receives a separate `HostSideBindingV1` from the host registry:

```ts
type HostSideBindingV1 = {
  side: 'baseline' | 'candidate'
  projectId: string
  graphIdentityVersion: 'sourcegraph-identity/v2'
  graphSchemaVersion: string
  relationIdentityVersion: string
  sourceMappingVersion: 'sourcegraph-source-mapping/v1'
  sourceDigest: Sha256
  graphDigest: Sha256
}
```

This binding is selected from the host-owned project/source-snapshot registry,
not from the observation envelope or caller-supplied graph. The host first
recomputes the selected side graph and source snapshot, then compares every
identity/version field and both digests to this binding. A caller that supplies
a self-consistent forged graph, mapping array and envelope still fails because
its graph digest is not the registered side digest. The evidence serializer
cannot manufacture a registry binding; an implementation that accepts a
caller-created binding without an external registry lookup is not a trusted
integration.

The field checks are exact and side-local. `sourceRef` must identify the same
source entity used by the selected graph, `graphNodeId` must identify the
source-use node, `relationId` (when present) must resolve to one relation, and
the relation's `from`, `to`, `sourceUse.path`, `charOffset`, `byteOffset` and
`offsetUnit` must equal the submitted reference. A relation with the same
endpoints but a different source span, selector scope or producer is not an
equal relation. A partial record may omit `relationId`; a complete record may
not.

## 3. Static graph identity

```ts
type GraphIdentityV2 = {
  graphIdentityVersion: 'sourcegraph-identity/v2'
  graphSchemaVersion: string
  relationIdentityVersion: string
  sourceMappingVersion: 'sourcegraph-source-mapping/v1'
  projectId: string
  sourceDigest: Sha256
  graphDigest: Sha256
}
```

`projectId` is issued by the host project registry. The browser, collector,
temporary worktree, URL, DOM and caller payload cannot create or replace it.

`sourceDigest` and `graphDigest` are side-specific. Baseline and candidate
must each be independently read and recomputed; copying one side's digest to
the other is invalid.

`graphDigest` is a digest of the static graph and the host-registered logical
project identity. It excludes run identity, URL, viewport, state, artifact
paths, timestamps, browser/runtime versions and temporary directories. The
host-side registry digest is checked before any record can be trusted; an
envelope digest claim is never accepted as its own trust root.

The canonical graph input includes `projectId`, `sourceMappingVersion` and the complete,
UTF-8-byte-sorted `sourceMappings[]` collection. Mapping entries are sorted by
`sourceRef`; each mapping includes `projectId`, `sourceRef`, `graphNodeId`,
`sourceAnchorRelationId`, `sourceIdentity` and exact `sourceUse`. Their
host-derived identity and source location therefore change the graph digest. A
graph without this collection is legacy/unavailable and cannot be upgraded by
copying a caller string.

Relation identity is a separate relation-level tuple. Under
`relationIdentityVersion = relation-id/v1`, its normalized fields are
`kind`, `from`, `to`, `sourceUse`, `selectorScope`, `mediaContext`,
`producerIdentity` and `sourceIdentity` when those fields are present in the
relation payload. `sourceIdentity` is the relation-local source identity; it
is not the host project ID and does not contain a page tuple. In the current
production model this `sourceIdentity` member is absent; if a future graph
includes it, it is only a consistency claim and must exactly equal the
host-built mapping identity. It never creates a mapping or trust by itself.
The tuple is
encoded with the same canonical serializer and never receives an emission
index or random suffix. Equal normalized tuples cannot emit two relations;
the same ID with a different payload is a hard `graph-schema-invalid` failure. `projectId`,
`runId`, route, page tuple and viewport belong to the graph or observation
binding and are never placed in a Relation ID.

## 4. Observation binding

```ts
type ObservationBindingV1 = {
  observationBindingVersion: 'sourcegraph-observation-binding/v1'
  graph: GraphIdentityV2
  sourceRef?: string
  sourceUseRef?: SourceUseRef
  runId: string
  checkId: string
  side: 'baseline' | 'candidate'
  route: string
  page: { pathname: string; search: string; hash: string }
  viewport: { width: number; height: number; deviceScaleFactor?: number }
  state: { id: string; digest?: Sha256 }
  artifact: {
    kind: 'observation-json' | 'runtime-snapshot' | 'mapping'
    path: string
    sha256: Sha256
    sizeBytes: number
  }
  status: 'complete' | 'partial' | 'unknown' | 'unavailable' | 'stale'
  proof: 'not-proven' | 'runtime-observed'
  primaryReasonCode: ObservationReasonCode
  secondaryReasonCodes: ObservationReasonCode[]
  observationBindingDigest: Sha256
}
```

`route` is the expected route from the trusted check plan. `page` is the
browser's actual full namespace. `pathname`, `search` and `hash` are checked
independently and are never reduced to pathname-only matching.

Capture formatting is strict: `pathname` is non-empty and starts with `/`,
contains no `?`, `#`, whitespace or control byte; `search` is empty or begins
with `?` and has at least one non-control character; `hash` is empty or begins
with `#` and has at least one non-control character. `route` is exactly
`pathname[?search][#hash]` under the same rules. Width and height are positive
safe integers with minimum `1`. These checks are identical in the JSON Schema,
Node serializer and PowerShell serializer.

`observationBindingDigest` is computed over the canonical input envelope
containing the graph identity, source references, run/check/side, route, full
page tuple, viewport, state and artifact. It excludes itself and all derived
validation fields (`status`, `proof`, reason codes and diagnostic text), so a
caller cannot self-authorize by changing the digest or result.

The binding contains the graph identity, top-level `sourceRef` and
`sourceUseRef`, trusted `runId/checkId/side`, expected `route`, the complete
`pathname/search/hash` tuple, viewport, state and the host-verified artifact
metadata. The artifact `sha256` is an input claim after byte verification; it
is not derived from, or allowed to include, `observationBindingDigest`.
`observationBindingDigest` itself and all derived status/proof/reason fields
are excluded from the digest input. This is the self-reference break.

`complete` requires a valid artifact, valid graph/source binding, complete
page tuple, exact viewport/state and exactly one resolvable `relationId` when a
source-use observation is claimed. `partial` may lack a strict relation but
has a usable target. `unknown` represents ambiguity or conflict.

Observation reasons use an independent namespace. Every reason value is
prefixed with the literal `observation/`, for example
`observation/complete`, `observation/missing-source-ref` and
`observation/graph-digest-mismatch`. These values are not members of
`RuntimeIdentityReason` or `RuntimeIdentityArchiveFailureReason`.

## 5. Canonical serialization

### 5.1 Graph digest input

The canonical graph input is:

```json
{
  "graphIdentityVersion": "sourcegraph-identity/v2",
  "graphSchemaVersion": "acp6-sourcegraph/v1",
  "relationIdentityVersion": "relation-id/v1",
  "sourceMappingVersion": "sourcegraph-source-mapping/v1",
  "projectId": "<host-registered-project-id>",
  "sourceDigest": "<64 lowercase hex>",
  "sourceMappings": [],
  "nodes": [],
  "edges": [],
  "unresolved": []
}
```

The serializer is a fixed JSON serializer: UTF-8 bytes, no whitespace,
recursive UTF-8 byte-order object keys, omission of absent optional members,
and rejection of explicit `null` or `undefined` in a digest input. Numbers are
finite; integer fields are safe non-negative integers and `-0` is rejected.
No text normalization, trimming, newline conversion or Unicode case folding
occurs. Hash input is domain separated with the exact byte prefixes
`ripple/sourcegraph-identity/v2/graphDigest\0` and
`ripple/sourcegraph-observation-binding/v1/observationBindingDigest\0`.

Nodes and edges are sorted by unique `id` using UTF-8 byte ordering. `pages`,
`evidenceRefs`, `mediaContext` and `unresolved` are set-valued arrays and are
sorted by UTF-8 bytes with duplicate members rejected. Any array with order
semantics is preserved in its declared order. `pageOverrides` object keys are
sorted recursively.

Unknown graph fields, unknown node/relation kinds, missing required
`edge.evidenceRefs`, duplicate node IDs, duplicate Relation IDs, duplicate set
members, non-empty-key violations in `pageOverrides`, unsafe integers above
`Number.MAX_SAFE_INTEGER` (`9007199254740991`) and unknown relation endpoints
are rejected before hashing with `graph-schema-invalid`; no digest is emitted.
The frozen node-kind enum is `file | symbol | component | route | data | media |
token | token-use | jsx-element | state`; the frozen edge-kind enum is
`imports | reads | renders | uses-token | token-reference | asset-consumer |
css-cascade | same-copy | semantic-link`. The Node validator, PowerShell
validator and Graph JSON Schema use these same enums and required fields.

### 5.2 Observation binding digest input

The serializer receives the observation envelope without
`observationBindingDigest`, `status`, `proof`, `primaryReasonCode`,
`secondaryReasonCodes` or diagnostic text. It canonicalizes the remaining
fields with the same JSON rules and computes SHA-256 over UTF-8 bytes. The
artifact SHA is an input claim and is not recomputed into itself; the host
first verifies the artifact bytes and then hashes the envelope that contains
the verified artifact SHA.

This prevents artifact self-reference and prevents a caller from making a
digest agree with a forged status or reason.

`graphIdentityVersion` names this binding protocol. `graphSchemaVersion` names
the graph node/edge shape, and `relationIdentityVersion` names the relation
tuple and duplicate rejection algorithm. They are independently versioned and
all three are included in the graph identity envelope. The host-owned
`projectId` comes only from its project registry; a temporary worktree path or
browser payload cannot establish project equivalence.

## 6. Reason/status mapping for missing source data

| missing or invalid data | primary reason | status |
| --- | --- | --- |
| all required evidence present and independently rechecked | `observation/complete` | `complete` |
| no `sourceRef` but no target ambiguity | `observation/missing-source-ref` | `partial` |
| no `sourceUseRef` for an observation that claims a source target | `observation/missing-source-use-ref` | `partial` |
| `sourceUseRef` exists but `sourceUse` is absent | `observation/missing-source-use` | `unknown` |
| `graphNodeId` not found | `observation/source-ref-not-in-graph` | `unknown` |
| sourceRef is not the selected side node id | `observation/source-ref-not-in-graph` | `unknown` |
| graphNodeId resolves to a declaration/non-source-use node | `observation/declaration-node-not-source-use` | `unknown` |
| more than one node has the graphNodeId | `observation/graph-node-not-unique` | `unavailable` |
| `relationId` absent on a partial record | `observation/missing-relation-id` | `partial` |
| `relationId` missing on a complete claim | `observation/relation-not-in-graph` | `unknown` |
| relation resolves more than once | `observation/duplicate-relation-id` | `unavailable` |
| host `sourceMappings[]` absent, malformed, or not derivable from the verified side graph | `observation/graph-schema-invalid` | `unavailable` |
| sourceUse fields differ from graph relation | `observation/source-use-ref-mismatch` | `unknown` |
| source/graph digest differs from host recomputation | `observation/source-digest-mismatch` or `observation/graph-digest-mismatch` | `stale` |

The reason names are a closed lower-case kebab-case set under the literal
`observation/` namespace. Free-form text is diagnostic only and cannot
introduce new authorization semantics.

`observation/missing-source-ref` and `observation/missing-source-use-ref` are partial only when the
trusted run plan still identifies an unambiguous target. Missing `sourceUse`
or a graph lookup failure is `unknown`; duplicate relation resolution is
`unavailable`; a complete claim without a unique `relationId` is `unknown`.
No missing field is inferred from array order, DOM coordinates or a matching
label.

The serializer exposes `validateGraphReference(envelope, sideGraph,
hostSideBinding)` for the side-local graph check. It rejects a top-level/source-use sourceRef mismatch,
a missing or non-unique graphNodeId, a missing or duplicate relationId, a
relation endpoint mismatch, and any sourceUse path/charOffset/byteOffset/
offsetUnit mismatch. A partial envelope without relationId returns partial and
never complete; a complete envelope without one unique relation returns
`observation/relation-not-in-graph`.

Nested objects are closed: `location` only permits
`path/start/end/offset/byteOffset`; `pageOverrides` permits non-empty page keys
whose values are strings; page, viewport, state and artifact have their listed
fields only. Unknown nested fields fail before hashing.

Artifact paths are relative POSIX paths inside the trusted archive. UNC paths,
backslashes, drive letters, NUL bytes, absolute paths, repeated separators,
`.` and `..` segments are rejected in all three validators.

The complete reproducible vectors are archived in
`docs/acceptance/2026-10-31/vectors/`: `g0.json` (G0 graph identity input),
`g1-shuffled.json` (same semantics and digest), `g2-byte-offset-changed.json`
(digest change), `g3-duplicate-relation.json` (required rejection),
`b0-observation.json` (full binding input), and `b1-partial-no-relation.json`
(partial relation omission), plus `g4-nonascii.json` and the negative fixtures.
The expected digests are:

| vector | expected result |
| --- | --- |
| G0 | `4b061992d5b8d61732d1c9da093dd643523c9a841dd8a86d9feeeaedb6f1627b` |
| G1 | equal to G0 |
| G2 | `f3ecbcbb7d8b5208a5a74a625a2896b7c54de13602870225fde55d1ebfbe398b` |
| B0 | `f61c320837b4739922b238973db6a33fa84d6a08e03e1ed0a5aafdf3fdcb85341` |
| B1 | `8cd557c6b8102d7482c1bdfd0a717437e17205eb9f7c73aa641726e12e96172b` |
| G3 | reject with `observation/graph-schema-invalid` |
| B2 | complete without `relationId` rejects with `observation/relation-not-in-graph` |
| G4 | `61a63dbcf688144e5181ad379dde80a330911e52186a1709a336b4bbc39b265f` (non-ASCII UTF-8 ordering) |

`run-final-observation-vectors.mjs` and the independent
`canonical-observation-digest.ps1` both recompute these values.
`compare-final-reports.mjs` compares complete canonical UTF-8 bytes (SHA and
base64) as well as domain-separated digests. The reports record both outputs
without relying on a production implementation.

## 6.1 SourceMappings trust-root audit matrix

| case | required host check | expected result |
| --- | --- | --- |
| missing `sourceMappings` | side graph schema and mapping version | `graph-schema-invalid` / unavailable |
| caller-forged array or opaque `sourceRef` | sourceRef = token-use node plus host mapping lookup | reject before digest |
| wrong project or old sourceDigest | project registry and side digest equality | `logical-project-mismatch` or `graph-schema-invalid` |
| mapping from the other side | baseline/candidate side-local graph and source snapshot | reject; no cross-side borrow |
| non-token-use node | frozen source-use node kind `token-use` | `declaration-node-not-source-use` |
| missing or non-unique file anchor | one file → token-use `reads`/`source-proven` edge | `graph-schema-invalid` |
| modified source location | path, UTF-16 `charOffset`, UTF-8 `byteOffset`, `code-unit` | `graph-schema-invalid` or location mismatch |
| valid source mapping with `semantic-candidate` consumer edge | relation certainty must be `source-proven` | `relation-not-in-graph`; strict proof remains false |
| `reads`/`source-proven` edge targeting `jsx-element` | CSS source-use validator rejects consumer upgrade | `non-strict-consumer-edge`; strict proof remains false |

The host-binding regression set also executes envelope source/graph digest,
version and side mismatches, a self-consistent forged graph against the real
host binding, a source-proven `uses-token` consumer, and a complete record
without `sourceUseRef`. All are required to fail closed in Node, PowerShell
and Schema parity.

The current vectors execute these cases in Node, PowerShell and Schema parity;
the dual report requires all implementations to agree. The historical E-OBS-02
fixture that referred to missing `Relation.sourceIdentity` remains in
`docs/acceptance/2026-11-01/legacy-history/` and is not relabeled. Its host
mapping equivalents are listed in
`docs/acceptance/2026-11-01/sourceidentity-v2-migration-record.json`.

## 7. Compatibility and evidence isolation

| artifact | graph identity | relation identity | observation binding | compatibility |
| --- | --- | --- | --- | --- |
| legacy B v5 | legacy/unversioned | legacy/unversioned | none | read-only historical input; no upgrade |
| B1.1 structural result | candidate | legacy or pending | none | static evidence only |
| v2 static graph | `sourcegraph-identity/v2` | `relation-id/v1` | optional reference | new evidence namespace |
| v1 observation envelope | v2 graph | `relation-id/v1` | `sourcegraph-observation-binding/v1` | read-only sidecar only |
| Runtime Identity v1.2 | unchanged | unchanged | unchanged | no model/reason/pairing changes |

Old reports, old graphs and old Relation IDs are never upgraded or backfilled.
Existing `sourceRef`, `sourceUse`, `rowId`, `pairId` and byte offsets retain
their original meaning. An old graph with duplicate IDs or only summary counts
cannot produce a trusted v2 digest.

Legacy input is quarantined as an independent structure:

```ts
type LegacyInput = {
  legacyKind: 'b-v5-report' | 'legacy-sourcegraph' | 'legacy-relation-id'
  legacyVersion: string
  payload: unknown
}
```

The V2 schemas require their exact version literals and reject legacy
`schemaVersion`, protocol or Relation ID shapes. The V2 parser performs no
conversion, re-numbering, backfill or trust upgrade.

## 8. Evidence and release boundary

This contract is evidence-only until E signs the exact revision. It does not
authorize Relation ID production changes, D collector wiring, VerificationRun
integration, E pairing changes, F display changes, merge, deployment or Bolt.

