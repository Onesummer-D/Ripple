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

`sourceRef` is the existing opaque source entity or graph-node ID. It is not a
path and is not derived from a browser selector.

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
mapping. `Relation.sourceIdentity` is an E-OBS-02 contract question for the
current SourceGraph schema; the evidence validator does not yet enforce its
presence. When present it must equal `sourceRef` exactly. Its absence remains
a pending `graph-schema-invalid` / `unavailable` case and never overrides a
missing node mapping. A declaration node (`token`, `file`,
`component`, `jsx-element` or any other non-`token-use` kind) is rejected with
`observation/declaration-node-not-source-use`.

For `partial`, `unknown`, `unavailable` and `stale` records, `relationId` may
be absent. A `complete` record must resolve exactly one relation in the side
graph and must provide `relationId`.

The host verifies, in order:

1. `sourceRef` resolves to the expected source entity in the selected side;
2. `graphNodeId` resolves to the source-use/token-use node, never only a declaration node;
3. if present, `relationId` resolves to exactly one relation in that side graph;
4. relation endpoints and `sourceUse.path/charOffset/byteOffset/offsetUnit` equal the submitted values;
5. the relation's `sourceUse` is the same occurrence as the `sourceUseRef` occurrence.

Missing `sourceRef` or `sourceUseRef` is not repaired from `recordId`, DOM
coordinates, selector text, source order or array position.

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

`graphDigest` is a digest of the static graph only. It excludes project/run
identity, URL, viewport, state, artifact paths, timestamps, browser/runtime
versions and temporary directories.

Relation identity is a separate relation-level tuple. Under
`relationIdentityVersion = relation-id/v1`, its normalized fields are
`kind`, `from`, `to`, `sourceUse`, `selectorScope`, `mediaContext`,
`producerIdentity` and `sourceIdentity` when those fields are present in the
relation payload. `sourceIdentity` is the relation-local source identity; it
is not the host project ID and does not contain a page tuple. The tuple is
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
  "sourceDigest": "<64 lowercase hex>",
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

The serializer exposes `validateGraphReference(envelope, sideGraph)` for the
side-local graph check. It rejects a top-level/source-use sourceRef mismatch,
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
| G0 | `ff8735ed6e3ff1f8321f66c2263d37c243ad7ec36616f28b98406fdc6ebcb9fe` |
| G1 | equal to G0 |
| G2 | `b4c30037e7ddfb236b41b6af674c89a5ebe4b6a6c1df878b793986686076639a` |
| B0 | `cb6e383888f1d9255a9612a3866b6ce4b6339517b94b92916d320ca2b4f08f56` |
| B1 | `2382cddcb7f942b368f1bc162c65e1f8b104d790586a5263fdf1008a111bb0ad` |
| G3 | reject with `observation/graph-schema-invalid` |
| B2 | complete without `relationId` rejects with `observation/relation-not-in-graph` |
| G4 | `04355c49b4382cb16624b259a48e726c2a869dafd1f3e20dced632470aa8d2de` (non-ASCII UTF-8 ordering) |

`run-final-observation-vectors.mjs` and the independent
`canonical-observation-digest.ps1` both recompute these values.
`compare-final-reports.mjs` compares complete canonical UTF-8 bytes (SHA and
base64) as well as domain-separated digests. The reports record both outputs
without relying on a production implementation.

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
