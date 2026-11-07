# E-H0 P0/P1 adjustment report

## Exact local source state

- Base: `ed58cfdc2892acaa9b97363a3414b1c219d07053`
- Source adjustment commit: `bc0dd673d3e209cffc186ab25c4503648a901cd1`
- Source adjustment tree: `5f48b145e6f8feeabeb9c93eb3241b5683ab09de`
- Runtime Identity v1.2 frozen blob: `8bbecf6e3f64db2b68506eedaa8eea709d1167de`

## P0 reproductions and fixes

| Vector | Before | Adjustment | Result |
|---|---|---|---|
| Public factory with self-consistent forged state | Could receive the factory brand | Public factory now creates a frozen non-authoritative registry; only the Vitest-gated host-owned test issuer is accepted | PASS: H0-01c rejects `registry-unavailable` |
| Custom graph hash input | Did not match D canonical contract | Uses `ripple/sourcegraph-identity/v2/graphDigest\0`, UTF-8 byte key ordering, frozen graph/version whitelist, sorted set arrays and duplicate/unsafe rejection | PASS: golden digest `48ec3e0130910c3b95e04ce39265de92b16f50c5f24d41f4e69694cf9dff13f5` |
| Generic mapping relation existence | Could be treated as a mapping anchor | Requires `sourceRef === graphNodeId`, `token-use`, unique `file -> token-use` `reads` + `source-proven` relation, exact sourceUse, `code-unit`, host-derived sourceIdentity and unique anchor IDs | PASS: five strict mapping negatives |
| Static relation aimed at JSX | Could be mistaken for consumer proof | Kept outside runtime proof; result remains `runtimeProof=none`, `authorizationEligible=false` | PASS |

## P1 safety cases

- Illegal artifact paths, malformed page/route tuples and invalid source paths reject before registry use.
- Missing/null host snapshot, missing run-point arrays and malformed graph data return fail-closed results without rendering exceptions.
- Registry object and its methods are frozen; caller replacement is rejected.
- Source, Graph and artifact bytes are held in a deep-frozen snapshot, so digest and use observe the same content.
- All non-`complete` statuses remain untrusted; `complete` is only an input to the full validation sequence and never a standalone proof.

## Independent execution

- Wrapper Vitest: `36/36`, exit `0` (`wrapper-vitest.log`).
- Typecheck: exit `0` (`typecheck.log`).
- Build: exit `0` (`build.log`).
- Frozen Node/PowerShell/Schema/Dual: all exit `0`; Dual required negatives `63/63` (`offline-*.log`).
- Windows full Vitest: exit `1` remains preserved in `full-vitest-windows.log`; the failures are the previously recorded local Chromium, symlink/hard-link, temporary Git and loopback restrictions.

## Boundary

The accepted registry issuer is still a test double because no production host integration is authorized in E-H0. This report does not unlock E-H1 or D-P1 and does not change Runtime Identity v1.2, VerificationRun, Assessment or authorization gates.
