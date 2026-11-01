# Ripple A · SourceGraph Observation v2 Evidence Contract Freeze

Status: **FROZEN FOR EVIDENCE-ONLY VALIDATION; HOST PRODUCTION WIRING HOLD**

## Signed inputs

- A evidence source candidate: `2ee08975c891abb1df5ff38881326e78ead28076`
- A source candidate Tree: `60e397f075f8a1d62226d6a736993580b48df9ad`
- E exact revalidation target: `2ee08975c891abb1df5ff38881326e78ead28076`
- D detached offline revalidation archive: `544fbdcc`
- C Relation ID / raw graph supplement: [`f574c5650694ab9f57b1a40d129730e8cfdb2e9b`](https://github.com/Onesummer-D/Ripple/commit/f574c5650694ab9f57b1a40d129730e8cfdb2e9b)

## Frozen versions

| Domain | Frozen value | Scope |
| --- | --- | --- |
| Graph identity | `sourcegraph-identity/v2` | Static graph identity envelope and canonical graph digest |
| Observation binding | `sourcegraph-observation-binding/v1` | Run/check/side/page/viewport/state/artifact binding |
| Source mapping | `sourcegraph-source-mapping/v1` | Host-derived file → token-use source mapping |
| Relation identity | `relation-id/v1` | Deterministic relation tuple and duplicate rejection |
| Producer policy | C v0.3 governed/legacy policy | Evidence-only mixed producer rules from `f574c565` |

This freeze covers the evidence-only contract, schemas, canonical serializers,
offline validators, negative vectors and digest calculation rules. It does not
freeze or authorize a production collector, host registry implementation,
VerificationRun field, Runtime Identity upgrade, E pairing change or UI wiring.

## Host trust boundary

`hostSideBinding` is trusted only when selected from the production host project
registry and independently verified source snapshot/side-graph artifacts. A
caller cannot register, replace or self-approve a host binding. A self-consistent
caller graph, `sourceMappings[]`, `sourceIdentity` and envelope remains a claim;
it is rejected when its digest does not match the registered side graph.

`projectId`, `sourceDigest`, `graphDigest`, graph versions and `side` are checked
against the selected host binding before source-use validation. Baseline and
candidate bindings are independent.

## Proof boundary

Static graph identity and a file → token-use `reads` / `source-proven` anchor
prove only the CSS source-use location. They do not prove JSX ownership, runtime
DOM ownership, computed style, cascade or consumer strictness.

The evidence validator therefore rejects a `reads` / `source-proven` relation
whose target is a `jsx-element` with
`observation/non-strict-consumer-edge`. The regression is covered in Node,
PowerShell, Schema and Dual reports. `semantic-candidate`, `unknown` and
unresolved relations remain non-strict.

## C mixed producer contract

The accepted dependency order is:

```text
rawGraphArtifactSha256
  -> producerEvidenceSha256
  -> policyManifestSha256
  -> final graphDigest
```

`rawGraphArtifactSha256` names the raw graph artifact and is not the final
`graphDigest`. Producer evidence must be bound to the exact analyzer build,
source commit/tree, raw graph hash, relation occurrence and payload hash.
Missing, duplicate or conflicting producer evidence yields
`graphDigestStatus=unavailable`. The policy manifest's canonical bytes exclude
its own outer `policyManifestSha256` value.

Scheme A is accepted: the whole source-file SHA is excluded from the Relation ID
tuple and remains in graph identity/source bindings/migration manifests.
`retained`, `renamed`, `split` and `unresolved` mappings are historical evidence
states; no old ID is silently re-numbered, upgraded or backfilled.

## Frozen compatibility boundaries

- Runtime Identity v1.2, RuntimeIdentityReason and archive failure reasons remain unchanged.
- E pairing semantics remain unchanged.
- VerificationRun, host Assessment and all Scope/Approval/Apply/Rollback gates remain unchanged.
- B v5 matcher/probe, thresholds and historical reports remain read-only.
- This freeze does not authorize D production observation wiring.

The freeze is an evidence-contract decision only. C production Relation ID work
requires the separate authorization record in this directory.
