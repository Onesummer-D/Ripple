# GraphDigestV2 Phase 1B-a implementation report

## Scope

This commit implements only the authorized pure `GraphDigestV2` computation module. It validates the ten-field graph envelope, canonicalizes UTF-8 JSON, rejects malformed or duplicate identities, and computes the domain-separated SHA-256 digest. It does not connect `analyzeProject`, derive producer evidence, assert host trust, or change any authorization path.

## Authorization and base

- Authorization: `graph-identity-phase1b-a-authorization-20261108.json`
- Authorization commit: `0c7eee6a5913b5aa6ec78c1c4053083b9ec76928`
- Authorization SHA-256: `234f02a2ff732ab94513a74f7d56277fb93f05d7be22dd48391fe23b90d4f875`
- Required base: `d1c941da77d4ab4bbcd7ae557052557628bcb27c`
- Implementation branch: `feat/c-graph-identity-v2-pure-20261108`
- First implementation commit: `d3038fabd99cb92ac5eb44885f0ae48e040bb94e`
- Remote Draft PR: `https://github.com/Onesummer-D/Ripple/pull/75`
- Code remote HEAD used by CI: `68939a8d9408575c5703b3b67cc8a899a7e12c9c`
- Version-fix implementation commit: `b234138e708eb956f2714b2380427297e85bbd24`
- Version-fix implementation Tree: `4ba744f6a58b977e52682a671aa03cee2aab28eb`
- Evidence archive HEAD: `0a29a480fca17e77c7a56a49226adc481fa61ef1`
- Evidence archive Tree: `480dd410524d3a9a1d42b7e6959144334878dd02`
- Final PR HEAD after evidence handoff: `9ddfd9828d6a0c1286d60773c80613ef36f45a81`
- Final PR Tree: `4047ccfec17f5697515418f8f539d9395a2c6b08`
- Exact PR base branch: `base/c-graph-identity-v2-20261108` at `d1c941da77d4ab4bbcd7ae557052557628bcb27c`

## Contract implemented

The canonical input has exactly these fields:

`graphIdentityVersion`, `graphSchemaVersion`, `relationIdentityVersion`, `sourceMappingVersion`, `projectId`, `sourceDigest`, `sourceMappings`, `nodes`, `edges`, `unresolved`.

The digest is SHA-256 of:

`UTF-8("ripple/sourcegraph-identity/v2/graphDigest\\0") || UTF-8(canonicalJson(graph))`

Canonicalization sorts object keys by UTF-8 bytes, sorts node/edge/mapping/unresolved set arrays by stable identity, sorts nested string sets, preserves source spans and strings without Unicode normalization, and rejects duplicate IDs, duplicate set members, unknown fields, unsafe values, invalid relative POSIX paths, invalid offsets, invalid source mappings, and unknown endpoints.

`canonicalGraph()` returns `sourceTrust: "content-only"`. This output is not host proof, runtime proof, authorization, or producer evidence.

## G0 and D/E comparison

D Golden commit: `e1834d683fb0e3c56e856f5ba2922404912b3e76`.

G0 result:

- canonical bytes SHA-256: `8301d143ef0409e613f5e37d665011343787917c902478de65a18dab4b8ea87e`
- GraphDigestV2: `4b061992d5b8d61732d1c9da093dd643523c9a841dd8a86d9feeeaedb6f1627b`
- domain: `ripple/sourcegraph-identity/v2/graphDigest\\0`

The E H0 reference replay produces the same vector. E's V1 HostBinding helper remains a separate compatibility layer and is not imported or treated as GraphDigestV2.

## Files

- `src/core/graph-identity-v2.ts`
- `src/core/graph-identity-v2.test.ts`
- `docs/acceptance/2026-11-08/graph-identity-v2-implementation-authorization.json`
- `docs/acceptance/2026-11-08/graph-identity-v2-implementation-test-log.txt`
- `docs/acceptance/2026-11-08/graph-identity-v2-implementation-report.md`
- `docs/acceptance/2026-11-08/graph-identity-v2-implementation-manifest.json`

No other source, model, package, lockfile, Runtime Identity, D/E, B v5, or gate file is in scope.

## Verification status

Targeted module tests are green: 36/36, including exact rejection of non-frozen graphSchemaVersion and relationIdentityVersion. This patch is a minimal validation tightening; G0 bytes and digest are unchanged. The prior exact-head CI runs remain valid for the pre-fix code, while the version-fix commit requires fresh CI before acceptance.

The local clean environment still records project `npm run typecheck` and `npm run build` exit 1 because dependencies were unavailable; those are superseded for acceptance by the exact-head Linux CI result above. B independent exact-vector review remains pending. Phase 1B-b is not authorized.

B independent exact-vector review is the next gate. Phase 1B-b is not authorized.

