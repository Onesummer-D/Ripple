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

Targeted module tests are green: 34/34. Full project typecheck, build, Linux CI, Docker/Chromium, and full dependency-backed Vitest remain unverified in this clean environment because dependencies are not installed and registry resolution is unavailable. The exact commands and exit codes are recorded in the test log.

B independent exact-vector review is the next gate. Phase 1B-b is not authorized.
