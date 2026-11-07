# E-H0 Host Trust Wrapper v1 isolated implementation review

## Provenance

- Base: `ed58cfdc2892acaa9b97363a3414b1c219d07053`
- Base tree: `24de55f8bc1d8146b12b42b8bfdd4b24d5f41f6c`
- Implementation commit: `fe541ab5177b7d8512d27989fa08a60bec8952a3`
- Implementation tree: `2b2047c138471a5432a4a4e10b74b57af710bd71`
- Branch: `e/h0-host-trust-wrapper-v1`
- Runtime Identity v1.2 frozen blob: `8bbecf6e3f64db2b68506eedaa8eea709d1167de`

## Whitelist diff

The implementation commit changes exactly these three files:

- `src/core/observation-host-registry-v1.ts`
- `src/core/observation-host-trust-v1.ts`
- `src/core/observation-host-trust-v1.test.ts`

The follow-up evidence commit adds only files under this `e-h0-wrapper-v1/` acceptance directory.
Runtime Identity v1.2, VerificationRun, Assessment, D/C/B contracts, Scope, Candidate, Approval, Apply, Rollback and the seven Verification assertions are untouched.

## Registry ownership and non-injection boundary

- `createHostTrustRegistryV1()` deep-clones and freezes the host snapshot.
- The returned registry exposes read methods only: `readProject`, `readRunPoint`, `readSideBinding`, and `readArtifact`.
- There is no write or update method on the returned object.
- A private `WeakSet` brand rejects a caller-created lookalike registry before any read occurs.
- H0-02 verifies both the absence of write/update properties and rejection of a replacement object.
- The host snapshot is immutable after construction; callers cannot mutate the bytes used for digesting or lineage validation.

## Validation flow

1. Validate the observation envelope shape.
2. Reject caller-supplied authority claims for Graph, sourceMappings, host binding or runtime proof.
3. Read one authoritative project, run point and side binding from the host registry.
4. Compare project, run, check, side, route, pathname/search/hash, viewport, state and version claims.
5. Recompute `sourceDigest` from the immutable host source snapshot.
6. Validate Graph endpoints, unique IDs, evidenceRefs and mapping anchors; recompute side-specific `graphDigest`.
7. Read one immutable artifact and verify path, bytes, SHA-256, size and complete lineage.
8. Only `status=complete` plus all checks passing yields `trustState=host-bound-complete`.
9. Every other status is fail-closed. `runtimeProof` remains `none` and `authorizationEligible` is always `false`.

The result is a discriminated union with boolean `trusted`, not a truthy string:

- success: `ok=true`, `trusted=true`, `trustState='host-bound-complete'`, `runtimeProof='none'`, `authorizationEligible=false`;
- failure: `ok=false`, `trusted=false`, diagnostic `reasonCode`, and no authorization capability.

Static `reads + source-proven` evidence is retained as static evidence only; it cannot produce Runtime Identity strict proof, Verification PASS, Scope, Approval, Apply or Rollback authority.

## H0-01 to H0-15 results

The dedicated Vitest file ran 22 assertions because H0-09 and H0-11 are parameterized.

| Case | Result | Assertion |
|---|---:|---|
| H0-01 | PASS | Caller Graph digest mutation rejected |
| H0-01b | PASS | Self-consistent forged Graph/mapping/binding claims rejected |
| H0-02 | PASS | Registry replacement rejected; no write/update capability |
| H0-03 | PASS | Cross-project reuse rejected |
| H0-04 | PASS | Baseline/candidate side reuse rejected |
| H0-05 | PASS | Old Graph digest rejected |
| H0-06 | PASS | Source digest claim mismatch rejected |
| H0-07 | PASS | Mapping not anchored in host Graph rejected |
| H0-08 | PASS | Unregistered run/check rejected |
| H0-09 | PASS | Route, page tuple, viewport and state replacements rejected |
| H0-10 | PASS | Duplicate and conflicting bindings rejected |
| H0-11 | PASS | unknown/partial/unavailable/stale remain untrusted |
| H0-12 | PASS | Historical artifact replay rejected |
| H0-13 | PASS | Static source proof does not become runtime proof or authorization |
| H0-14 | PASS | Artifact byte/SHA/size and duplicate archive failures rejected |
| H0-15 | PASS | Missing/non-proving RI claims cannot be supplied by caller |

Dedicated result: `22/22` assertions, exit code `0`.

## Command results

- Wrapper targeted test: exit `0`, `22/22` passed (`wrapper-vitest.log`).
- Typecheck: exit `0` (`typecheck.log`).
- Build: exit `0` (`build.log`).
- Frozen Node validator: exit `0` (`offline-node.log`).
- Frozen PowerShell validator: exit `0` (`offline-powershell.log`).
- Frozen Schema parity: exit `0` (`offline-schema.log`).
- Frozen Dual report: exit `0`, required negatives `63/63` (`offline-dual.log`).
- Previous independent adversarial probe replay: exit `0`; its known evidence-only acceptance gaps remain recorded in `adversarial-probe-replay.log` and are the cases rejected by this wrapper's H0 suite.

## Full Windows Vitest note

The requested full `npm test -- --run` was executed. The wrapper test passed, but the Windows run exited `1` because this environment cannot launch the Playwright executable and denies symlink, hard-link, temporary Git initialization and some loopback operations. The exact summary and failure categories are retained in `full-vitest-windows-summary.md`; these failures are outside the three whitelist source files. Linux CI remains required for authoritative full-suite acceptance.

Dependency restoration via `npm ci` also hit Windows npm `Exit handler never called` and EPERM directory creation. Typecheck/build and the targeted test were run with the already available workspace dependency tree; the environment and versions are recorded in `environment.txt`.

## Current boundary

This is **E-H0 ISOLATED IMPLEMENTATION REVIEW** only. No production host integration was added. E-H1 and D-P1 remain locked; Runtime Identity v1.2 and all authorization gates remain unchanged.
