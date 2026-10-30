# AC-P6 B1.1 Static JSX Owner Evidence

## Scope and approval

This evidence covers the A-approved B1.1 slice: conservative static JSX owner matching for CSS `var()` uses. It does not change public model fields, SourceGraph authorization, Runtime Identity, B v5 matcher/probe/thresholds, or Candidate/Scope/Verification/Approval/Apply/Rollback gates.

- Production base: `5b75fe699afce98638e6fd6ad110911d83389dc8`
- Exact implementation HEAD under review: `45555a3c8a4f7663b36a47c7ee0d990c88699724`
- Implementation tree: `7fad41423cb10603bb193d74913b19259f3f4b32`
- Fixed project: `allanhue/webportflio@b244f857457d2a07f118155602eef9097fd322bd`
- Draft PR: [#70](https://github.com/Onesummer-D/Ripple/pull/70)
- Exact-head manifest: [`b11-rebind-manifest.json`](./b11-rebind-manifest.json)

The original dirty worktree is preserved separately. This worktree is clean except for the review remediation files before commit.

## Implementation and conservative boundaries

`parseCssSelectorStructure()` accepts only a conservative static subset: tag names, class names, and descendant whitespace. Selector lists, attributes, IDs, escapes, pseudo states/elements, and unsupported combinators remain unresolved. JSX host facts now retain whether the tag is intrinsic. Candidate edges are rejected across custom React component boundaries and for `html`, `body`, and global selectors. The original `selectorScope`, source-use anchors, node IDs, code-unit offsets, and UTF-8 byte offsets remain unchanged.

A `css-cascade` edge is emitted only when the complete supported selector matches exactly one intrinsic static JSX owner. The edge certainty remains `semantic-candidate`; no source-proven edge is created.

## Fixed third-party four-row result

| rowId | source use | selector | byteOffset | candidate edges | result |
| --- | --- | --- | ---: | ---: | --- |
| `acp6-gap-1027a7455bb3d74f` | `src/css/footer.css#952` `var(--accent)` | `.footer-cta` | 952 | 0 | UNKNOWN/unresolved |
| `acp6-gap-e5fd86b599c27aa2` | `src/css/footer.css#687` `var(--text-secondary)` | `.footer-tagline` | 687 | 0 | UNKNOWN/unresolved |
| `acp6-gap-193ee5fb755f60b5` | `src/css/style.css#8978` `var(--text-secondary)` | `.title` | 8978 | 0 | UNKNOWN/unresolved |
| `acp6-gap-98288a263b162995` | `src/css/footer.css#977` `var(--background)` | `.footer-cta` | 977 | 0 | UNKNOWN/unresolved |

The fixed project places the apparent owners in comments, so no executable JSX host is available. The collector does not invent a host from the B regex candidate list.

## Independent AC6.4 evidence

[`b11-ac64-four-pair-evidence.json`](./b11-ac64-four-pair-evidence.json) records the four original pair IDs independently from AC6.2. All four remain `UNKNOWN`, with before/after `edgeCount: 0`, `anchored: false`, exact JSX file/offset, CSS source-use and the conservative reason. No AC6.2 candidate result is used as AC6.4 proof.

## Base versus exact-head graph comparison

The same fixed project and probe version produced:

| metric | Base | Exact implementation | Delta |
| --- | ---: | ---: | ---: |
| graph nodes | 675 | 675 | 0 |
| graph edges | 5302 | 3070 | -2232 |
| unresolved | 253 | 253 | 0 |
| source-proven edges | 744 | 744 | 0 |
| unknown `uses-token` edges | 252 | 252 | 0 |

The complete machine diff is [`b11-graph-diff.json`](./b11-graph-diff.json). The -2232 change is entirely within semantic-candidate token relations:

- `token-reference`: 964 → 684 (−280)
- `uses-token` semantic-candidate: 2156 → 1040 (−1116)
- `css-cascade` semantic-candidate: 1184 → 348 (−836)

No source-proven relation was removed or added; node IDs and unknown edge counts are unchanged. The reduction includes unsupported/ambiguous selector pruning as well as stricter intrinsic-owner matching, so it is not described as only consumer-owner pruning. No authorization relation is modified.

## Negative coverage

The new regression fixture covers a unique tag-only intrinsic owner (`dialog`), global selectors (`*`, `:root`, `html`, `body`), a custom-component boundary (`Card` → child), duplicate owners, missing owners, dynamic class names, pseudo selectors, and incomplete/complex descendant selectors. Only the unique intrinsic owner creates a semantic candidate; all other cases remain unresolved.

## Frozen B v5 rebind

The exact-head report is [`b11-v5-head45555.json`](./b11-v5-head45555.json). It contains `aCore.sha === aCore.expectedSha === 45555a3c8a4f7663b36a47c7ee0d990c88699724`, fixed project SHA `b244f857457d2a07f118155602eef9097fd322bd`, graph `675/3070/253`, and `3 PASS / 2 PENDING / 0 ERROR` with exit code 2. The base comparison report is [`b11-v5-base-5b75fe.json`](./b11-v5-base-5b75fe.json), also exit 2 with `675/5302/253`.

B v5 matcher/probe and thresholds were not modified. AC6.2 and AC6.4 remain PENDING.

## Commands and local results

```text
npx vitest run src/core/project.test.ts -t "tag-only"  # PASS: 1 passed, 34 skipped
npm run typecheck                                      # pending final rerun
npm run build                                          # pending final rerun
node --experimental-transform-types --loader ./scripts/ts-extension-loader.mjs scripts/b-css-token-probe.mjs <fixed-project> --acceptance --expect-core-sha 45555a3c8a4f7663b36a47c7ee0d990c88699724 --json docs/acceptance/2026-10-30/acp6-b11-static-owner/b11-v5-head45555.json  # exit 2
```

Remote Linux CI for the remediation commit must be recorded after the evidence commit is pushed. Until then it is UNVERIFIED.

## Files

Allowed production/test changes are limited to `src/core/project.ts` and `src/core/project.test.ts` in this remediation. Evidence outputs are under this directory. No model, route, Runtime Identity, B v5 tool, or authorization contract was changed.
