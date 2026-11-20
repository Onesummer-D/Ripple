# Graph Producer Evidence v1

This module binds a replayable Analyzer execution to the exact build pin and project snapshot selected by the verifier. The Adapter still returns its original GraphDigestV2. This evidence has its own version and SHA-256 domain.

| Record | Meaning |
| --- | --- |
| Analyzer build identity | Digest of exact Analyzer and Adapter source files, Node loader and launch entry, installed versions and dependency bytes, lockfile, and Node executable and toolchain identity. |
| Source binding | Expected project ID, repository, captured HEAD, root tree, tracked set, and source digest. The C API accepts the same tuple as E's issuer. Issuer verification belongs to the trusted composition caller. |
| Raw graph artifact SHA-256 | Exact UTF-8 bytes from the measured execution's `JSON.stringify(SourceGraph)`, with no trailing newline. Paths, revision ref, build platform and runtime fingerprint can affect raw output. |
| GraphDigestV2 | Canonical content digest and canonical byte hash from the existing Adapter, produced during that same execution. |
| Producer Evidence SHA-256 | SHA-256 over UTF-8 `ripple/graph-producer-evidence/v1`, one NUL byte, and canonical JSON of all evidence fields except `evidenceSha256`. |

The verifier stages the measured files in a fresh private temporary directory and executes the Analyzer in a fresh Node process. It captures the committed input again and checks it against the selected snapshot before analysis. A checkout that drifts or cannot be recaptured leaves evidence unavailable. The supported build profile is an isolated Node source build installed with the repository lockfile. It requires a trusted host, an independently provisioned build pin, and a local Git checkout. The build pin is specific to the installed bytes and toolchain. The API produces replay evidence for that profile. Registry authentication, policy attestation and runtime observation are separate layers.

Reproduce the scoped tests and fixed-project run from the repository root with the pinned dependencies and an exact clean `allanhue/webportflio@b244f857457d2a07f118155602eef9097fd322bd` checkout.

```powershell
npm ci
npm run typecheck
npx vitest run src/core/graph-producer-evidence-v1.test.ts src/core/graph-identity-v2.test.ts src/core/graph-identity-v2-adapter.test.ts
node --experimental-transform-types --loader ./scripts/ts-extension-loader.mjs docs/acceptance/2026-11-20/graph-producer-evidence-replay.mjs <fixed-project-path> <output-directory>
```

The replay command explicitly uses a controlled registry and a locally measured build pin. It compares the worker output to a direct Analyzer run, checks the signed-off graph counts and GraphDigestV2, then replays against the selected snapshot and checks four negative cases. It emits the exact raw graph bytes plus the archived JSON report. Reconstruct the raw artifact using the same checkout location and runtime when comparing its SHA-256.
