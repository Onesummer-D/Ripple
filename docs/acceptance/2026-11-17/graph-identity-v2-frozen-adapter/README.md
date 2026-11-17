# GraphDigestV2 Frozen Analyzer Adapter — C implementation evidence

This is the C Phase 1B-b implementation slice built on E's frozen snapshot foundation. The PR is intentionally based on E's open PR #76 head `667ed54d2999e8f6e3ebaa1012165144015a9894`; E's snapshot module and tests are inherited unchanged and are not part of the C diff.

## Scope and trust boundary

- `captureFrozenSourceSnapshot()` captures the exact tracked Git blob set at HEAD/Root Tree, rejects unclean or mismatched worktrees, symlinks, submodules, unmerged index entries, unsupported object formats, and rechecks HEAD/tree/index/status before returning.
- `analyzeProject()` now accepts either its original project-root string or a branded frozen snapshot. In frozen mode, TypeScript, config, module resolution, route, CSS, HTML, and page-override reads use the snapshot-backed TypeScript system. The existing string API remains available.
- `adaptSourceGraph()` validates the graph with the frozen GraphDigestV2 pure module, binds the graph to the exact captured snapshot, requires a caller-supplied registry tuple to match the snapshot, and validates a one-to-one mapping for every `token-use` node through a unique `reads/source-proven` file anchor and frozen source bytes.
- The registry is an unattested test input. Successful output is `available-content-only`; trust remains `content-only`, host provenance remains `unverified`, and no runtime proof or authorization is produced.
- Malformed mapping candidates are `rejected`; absent, incomplete, duplicate, or non-unique evidence is `unavailable`. Per-record `mapping-rejected` is diagnostic only. Aggregate status priority is `rejected > unavailable > available-content-only`.
- GraphDigestV2 pure code and D G0 are unchanged. Producer provenance, a real host issuer/registry, production GraphDigest wiring, E-H1, D-P1, and authorization integration remain out of scope.

## Reproduction

From the repository root, with lockfile dependencies installed:

```powershell
npm ci --no-audit --no-fund
npx vitest run src/core/frozen-source-snapshot.test.ts src/core/frozen-project-snapshot.test.ts src/core/graph-identity-v2-adapter.test.ts src/core/graph-identity-v2.test.ts --reporter=dot
npm run typecheck
npm run build
node --experimental-transform-types --loader ./scripts/ts-extension-loader.mjs docs/acceptance/2026-11-17/graph-identity-v2-frozen-adapter/real-sourcegraph-positive.mjs
```

The positive fixture executes the real `analyzeProject(FrozenSourceSnapshot)` path and then the adapter. It is a controlled test repository, not the fixed third-party sample and not an attested host registry. Current output is 8 nodes, 18 edges, 2 unresolved, 2 token-use nodes and 2 accepted content mappings. Canonical bytes SHA-256 is `c86a750686001efeca4f6992a5cf54e23d2f7d01a6d46415613fa6fb460f8b9b`; GraphDigestV2 is `af9082ccb4a0f5e53eacf4d8c5febc83bdbf6ae7bfd27ecfd9b59b7d37be66fd`.

`replay.mjs <project-root> <output-dir>` is prepared for the fixed `allanhue/webportflio@b244f857457d2a07f118155602eef9097fd322bd` project. It checks exact HEAD and independently requires the snapshot digest to equal the existing `digestTrackedTree()` result before analyzing. The fixed-project replay was not run in this local environment; B's exact-PR-head replay remains pending and must be reported separately.

## Local verification record

See `local-validation.json` for exact commands and observed exit codes. Focused tests passed 57/57; Typecheck and Build passed. The full Windows Vitest run exited 1 (74 files: 67 passed, 7 failed; 1,054 passed, 5 failed, 9 skipped). It encountered browser hook timeouts, a browser performance threshold miss, and a Windows symlink `EPERM`; this is recorded as a failure, not waived as an environment pass. Exact Linux CI on implementation head `ac5fc1c28ae82a933466dedf9e27fce85a23fa6e` passed: 74/74 Vitest files, 1,068/1,068 tests, Build, Docker/runtime smoke, and Chromium E2E (87 passed, 1 skipped). See the linked run/artifact in `local-validation.json`.

The fixed third-party project replay remains pending B's independent run. Do not use this content-only fixture as proof of host identity or strict consumer provenance.
