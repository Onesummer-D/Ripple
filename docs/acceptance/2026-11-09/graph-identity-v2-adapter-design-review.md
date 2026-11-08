# GraphDigestV2 Phase 1B-b：真实 SourceGraph 适配设计评审

状态：`evidence-only / design-review`

本批只描述只读适配器和验证流程，不修改 `src/`，不接线 `analyzeProject()`，不改变 PR #72、PR #75、Runtime Identity、D/E 合同、B v5 或任何授权门控。

## 1. 证据基线

| 项目 | 精确引用 |
| --- | --- |
| PR #72 SourceGraph 基线 | `d1c941da77d4ab4bbcd7ae557052557628bcb27c` |
| PR #72 tree | `46049ba554a9e7c3ef9048924607a5025342496f` |
| PR #75 pure module | `30030cd10c4eefbd976749be1b2b5df800bbf200` |
| A Phase 1B-a final acceptance | `142d1aacf398b58b047e3a91d1046c6297d41650` |
| D Golden commit | `e1834d683fb0e3c56e856f5ba2922404912b3e76` |
| E Host Binding reference | PR #73 `44649afa1d698fd77fd0e445e473e135995dc5c3` |
| fixed project | `allanhue/webportflio@b244f857457d2a07f118155602eef9097fd322bd` |
| GraphDigestV2 canonical bytes SHA | `8301d143ef0409e613f5e37d665011343787917c902478de65a18dab4b8ea87e` |
| GraphDigestV2 G0 SHA | `4b061992d5b8d61732d1c9da093dd643523c9a841dd8a86d9feeeaedb6f1627b` |

PR #72 `ProjectRevision.projectId` is derived from the local absolute root path. It is useful for the existing graph, but it is not a host-issued identity and must not be promoted to a trusted GraphDigest identity. The adapter therefore requires a separate registry record that binds a project id to the exact checkout and source snapshot. Without that record the result is `unavailable`.

## 2. Existing construction chain

`readProjectSnapshot()` resolves the Git root, checks cleanliness, enumerates tracked files, reads bytes, and computes `revision.sourceDigest`. `analyzeProject()` parses TS/JSX and CSS, emits nodes and relations, then repeats the source digest check before returning `{ id, revision, nodes, edges, unresolved }`. The returned `SourceGraph` has no GraphDigest or producer-evidence field.

CSS `token-use` nodes are created from `parseCssTokenSource()` with:

- `id = token-use:<path>#<code-unit offset>`;
- `location.path = path`, `location.offset = use.offset`;
- `byteOffset = use.byteOffset`;
- a source-proven `reads` edge from `file:<path>` with the same `sourceUse`.

That edge is the only static anchor eligible for a source mapping. CSS consumer and cascade edges remain `semantic-candidate`; they cannot be upgraded by this adapter.

## 3. Adapter decision

### Recommended: A — independent read-only adapter

Future implementation (not authorized in this review) would live in a dedicated adapter module and test. It accepts an immutable `SourceGraph`, a frozen source snapshot, and a host registry record; it validates mappings, builds the ten-field GraphDigestV2 input, then calls the already accepted pure module. It never mutates `SourceGraph` or re-runs the analyzer.

Proposed API shape:

```ts
type AdapterInput = {
  graph: SourceGraph
  snapshot: FrozenSourceSnapshot
  projectRegistry: HostProjectRegistryRecord | undefined
  mappingCandidates: readonly MappingCandidate[]
}

type AdapterResult =
  | { status: 'available-content-only'; graph: GraphDigestV2; digest: string; diagnostics: readonly Diagnostic[] }
  | { status: 'unavailable'; diagnostics: readonly Diagnostic[] }
  | { status: 'rejected'; diagnostics: readonly Diagnostic[] }
```

The content result is never called trusted, source-proven, runtime-proven, or authorized. Host trust is a later evidence layer.

### Alternative: B — producer call-point change

Changing `project.ts` to emit a GraphDigest sidecar would be needed only if a host must bind the registry record during the same analysis transaction. It would widen the SourceGraph producer contract, increase TOCTOU and regression surface, and make B v5 comparison harder. It is not the first slice and requires a new A whitelist and D/E sign-off.

## 4. Snapshot and TOCTOU contract

1. Resolve and realpath the repository root; require the exact fixed checkout and root tree.
2. Enumerate tracked files and capture immutable byte buffers. A source binding contains a repository-relative POSIX path and the SHA-256 of those exact bytes.
3. Compute `sourceDigest` from the same byte buffers used for mapping checks. Do not re-read live files while constructing mappings.
4. Reject symlinks, special files, path escape, absolute paths, drive-letter paths, backslashes, NULs, duplicate separators, and missing tracked bytes.
5. Run the existing analyzer against the snapshot. Its before/after digest guard remains necessary but is not sufficient; the adapter also compares every bound file hash to the frozen buffer.
6. A changed byte buffer, changed checkout tree, registry mismatch, or missing host-issued project id produces `unavailable`; malformed graph or mapping data produces `rejected`.

`projectId` may be accepted only from a host registry record that binds at least `{ projectId, repository, commit, rootTree, sourceDigest }`. A caller-supplied string without that record is not evidence.

## 5. GraphDigest availability states

| State | Meaning | Digest emitted? | Trust meaning |
| --- | --- | --- | --- |
| `available-content-only` | ten fields, mappings, exact bytes and registry binding validate | yes | pure content result only |
| `unavailable` | evidence is missing, stale, incomplete, or host identity is not proven | no | fail-closed; preserve diagnostics/unresolved |
| `rejected` | malformed/unknown/duplicate/conflicting input | no | caller must fix input; no fallback |

The adapter preserves all existing `unresolved` entries. It never removes an unresolved item to make a digest available.

## 6. What remains unproven

- PR #72's path-derived project id is not host-issued.
- CSS cascade, inheritance, theme activation, media activation, dynamic class names, pseudo-elements, portals, and runtime DOM consumers are not statically proven.
- `semantic-candidate` edges remain candidates. A mapping for a `token-use` source anchor does not prove a CSS declaration is the final computed value.
- Multiple declarations with the same token name remain separate nodes; no cascade winner is inferred.
- GraphDigestV2 proves canonical content shape and byte-bound source anchors only. Producer evidence, policy, host observation and authorization are separate contracts.

## 7. Collaboration and acceptance order

1. C adapter validates the frozen source bytes and produces only the ten-field input.
2. The accepted pure module computes canonical bytes and the domain-separated digest.
3. B runs the unmodified v5 matcher/probe on the exact fixed project and compares AC6.2/AC6.4 counts; the adapter must not change thresholds or consumer semantics.
4. D verifies canonical bytes, mapping completeness, and unavailable behavior.
5. E may bind a verified GraphDigest in a later host evidence record; E must not redefine or recompute GraphDigestV2.
6. A reviews the adapter whitelist and the final evidence manifest before any production call point is authorized.

## 8. Future file whitelist (design only)

Recommended first implementation whitelist, pending A approval:

- `src/core/graph-identity-v2-adapter.ts`
- `src/core/graph-identity-v2-adapter.test.ts`
- `docs/acceptance/**/graph-identity-v2-adapter-*`

`src/core/project.ts` and `src/core/project.test.ts` are excluded unless option B is separately approved. No model, route, Runtime Identity, D/E, Candidate, Scope, Verification, Approval, Apply, Rollback, B v5, or deployment file is in scope.

## 9. Identity-layer separation

The remote PR #75 candidate is `30030cd10c4eefbd976749be1b2b5df800bbf200` (tree `f49b9800a433c44c298a330aa70ebce0d95d50f6`). Its pure module computes the canonical ten-field GraphDigestV2 with the `ripple/sourcegraph-identity/v2/graphDigest\0` domain. E PR #73 at `44649afa1d698fd77fd0e445e473e135995dc5c3` defines the Host Binding side. Its Host Binding Digest V1 is an observation/host envelope; it is not a second serializer for the canonical graph and must reference a verified GraphDigestV2 value instead of redefining its fields.

The following values stay outside GraphDigestV2: `runId`, `checkId`, `side`, browser/page tuple, host artifact id, analyzer evidence hash, policy hash, and host registry issuance. They belong to Observation/ProducerEvidence/ProvenanceAttestation layers. A mismatch or absent reference at those later layers makes the attestation unavailable; it does not alter the GraphDigestV2 bytes.

The local design parent is `33d10616615f71e78e521671dc8df5547ed6a1ef`, a clean local inspection snapshot. It is not presented as the remote PR commit; the remote PR #75 HEAD and tree above are the authority for the pure-module contract. Before any implementation, the adapter worktree must be rebuilt from the remote candidate or a verified equivalent bundle.
