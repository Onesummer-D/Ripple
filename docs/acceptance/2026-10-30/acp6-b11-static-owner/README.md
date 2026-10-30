# AC-P6 B1.1 Static JSX Owner Evidence

## Scope and approval

This evidence records the first B1.1 implementation slice after A's formal sign-off. The implementation is limited to conservative static JSX owner matching for CSS `var()` uses. It does not change public model fields, SourceGraph authorization, Runtime Identity, B v5 matcher/probe/thresholds, or Candidate/Scope/Verification/Approval/Apply/Rollback gates.

- Base: `5b75fe699afce98638e6fd6ad110911d83389dc8`
- Base tree: `ede999bd2eb1507ac03b55762c94d489b93d9965`
- Fixed project: `allanhue/webportflio@b244f857457d2a07f118155602eef9097fd322bd`
- Implementation branch: `feat/cd-acp6-b11-static-owner-20261030`
- Review status: Draft; Linux CI is UNVERIFIED until the remote Draft PR run completes.

## Implementation

`parseCssSelectorStructure()` accepts only a conservative static subset: tag names, class names, and descendant whitespace. Selector lists, attributes, IDs, escapes, pseudo states/elements, and unsupported combinators remain unresolved. The original `selectorScope` and source-use anchors remain unchanged.

`project.ts` records internal JSX opening-element facts (tag, static classes, dynamic-class marker, and parent chain). A CSS use receives a `css-cascade` edge only when the full supported selector matches exactly one static JSX owner. Zero matches, multiple matches, dynamic class names, and unsupported selector syntax remain unresolved. The edge certainty is always `semantic-candidate`.

## Fixed third-party four-row result

The four required rows retain their original source identity and anchors:

| rowId | source use | selector | byteOffset | candidate edges | result |
| --- | --- | --- | ---: | ---: | --- |
| `acp6-gap-1027a7455bb3d74f` | `src/css/footer.css#952` `var(--accent)` | `.footer-cta` | 952 | 0 | UNKNOWN/unresolved |
| `acp6-gap-e5fd86b599c27aa2` | `src/css/footer.css#687` `var(--text-secondary)` | `.footer-tagline` | 687 | 0 | UNKNOWN/unresolved |
| `acp6-gap-193ee5fb755f60b5` | `src/css/style.css#8978` `var(--text-secondary)` | `.title` | 8978 | 0 | UNKNOWN/unresolved |
| `acp6-gap-98288a263b162995` | `src/css/footer.css#977` `var(--background)` | `.footer-cta` | 977 | 0 | UNKNOWN/unresolved |

The fixed project places the apparent `footer-tagline`, `footer-cta`, and Home `.title` JSX in comments. TypeScript therefore produces no real JSX host node for these locations. The collector does not invent a host from the B regex candidate list. This is the required fail-closed outcome; the rows are not claimed as closed by this slice.

The machine-readable details are in [`b11-four-row-sourcegraph.json`](./b11-four-row-sourcegraph.json).

## Regression fixture

The new project tests exercise:

1. one exact static owner for each selector;
2. two token uses on one `.footer-cta` host;
3. duplicate owners, missing owners, dynamic class names, and an incomplete descendant selector;
4. preservation of `sourceUse.path`, code-unit `charOffset`, UTF-8 `byteOffset`, selector scope, and existing token-use node IDs.

Only the positive fixture creates semantic candidate edges. No fixture upgrades an edge to `source-proven`.

## B v5 comparison

The frozen B v5 probe was run against the fixed project without changing its matcher or thresholds. The report is [`b11-v5-current.json`](./b11-v5-current.json); the old/new comparison is [`b11-v5-comparison.json`](./b11-v5-comparison.json).

| metric | Phase 0 frozen input | B1.1 run |
| --- | ---: | ---: |
| graph nodes | 675 | 675 |
| graph edges | 5302 | 3070 |
| unresolved | 253 | 253 |
| raw var uses | 252 | 252 |
| source uses-token edges | 961 | 473 |
| dist uses-token edges | 1447 | 819 |
| pages | 7 | 7 |
| acceptance | 3 PASS / 2 PENDING / 0 ERROR | 3 PASS / 2 PENDING / 0 ERROR |

The edge reduction is a consequence of replacing broad class-token attachment with exact unique static-owner matching. It does not change B thresholds and does not turn the four fixed-project rows into proven consumers. AC6.2 and AC6.4 remain PENDING.

## Commands and results

Executed in the clean B1.1 worktree:

```text
npx vitest run src/core/css-token-source.test.ts src/core/project.test.ts -t "B1.1|selector structure|selector forms"  # PASS: 2 files, 3 passed, 36 skipped
npm run typecheck                                                                            # PASS
npm run build                                                                                 # PASS
node --experimental-transform-types --loader ./scripts/ts-extension-loader.mjs scripts/b-css-token-probe.mjs <fixed-project> --acceptance --json docs/acceptance/2026-10-30/acp6-b11-static-owner/b11-v5-current.json  # exit 2: expected pending
```

The full two-file Vitest run completed with 38 passed and 1 skipped test, but Vitest also reported one worker `onTaskUpdate` timeout and returned exit 1 on this Windows worktree. The B1.1 filtered run completed cleanly with exit 0. This local worker transport issue is recorded rather than treated as a pass. Remote Linux CI, Docker/Chromium, and the final B v5 rerun on the remote commit remain UNVERIFIED until the Draft PR is available.

## Files

Production and tests are limited to:

- `src/core/css-token-source.ts`
- `src/core/project.ts`
- `src/core/css-token-source.test.ts`
- `src/core/project.test.ts`

The JSON files in this directory are evidence outputs only. No model, route, Runtime Identity, gate, B v5 tool, or authorization contract was changed.
