# Relation ID v0.3 third-round evidence on fb2 base

## Bindings

- A review base: `6388abec96183cc28824dc2b7fa486e4e944d305`, tree `8455bfc0c6f2ff5491dad8a418c8b8a7bc78ba2e`.
- Integration base: `fb2efe35c447eadf262d55f1d9755bb26cecabda`, tree `e942bf8d12e3c7224b79d673705fdc253c0cf552`.
- Current source implementation before evidence commit: `f6d1edf286d40314e83aa3121214dcf85d824fc0`, tree `2e0eb49b3dcb8adf09b0cdb1312bbd3b65c0adf3`.
- Previous source implementation: `93d528fce7a329c3e35c62d013dfaa1675cfc3fa`.

The production diff is limited to `src/core/relation-id-v1.ts`, `src/core/relation-id-v1.test.ts`, and the minimal `src/core/project.ts` call site. The fb2 B1.1 evidence documents remain unchanged.

The source tree is unchanged between archive parent `b2c33056a0d67841a4b8fd08f16b35ab93d0df48` and archive tip `f8c0bb3969eadf8fda7bba3a1711f46e0edd3ce8`; the intervening commit is evidence-only.

The source-level audit is reproducible from `source-diff-fb2-evidence.json`,
`source-safety-diff-93-to-f6.patch`, and
`source-integration-diff-fb2-to-f6.patch`. These bind reviewed commit
`93d528fce7a329c3e35c62d013dfaa1675cfc3fa`, integration base
`fb2efe35c447eadf262d55f1d9755bb26cecabda`, and implementation commit
`f6d1edf286d40314e83aa3121214dcf85d824fc0` without treating the later
evidence archive commit as a production implementation.

## Safety changes

The governed identity validator now rejects absolute paths, `../` and `.` segments, Windows drive prefixes, backslashes, NUL bytes, duplicate separators, placeholders, unsafe offsets, and unknown fields in the top level, sourceUse, definition, and media arrays. No fallback identity, silent cleanup, renumbering, or certainty upgrade was added.

## Structural graph result

The fixed project is `allanhue/webportflio@b244f857457d2a07f118155602eef9097fd322bd`. The checkout is a structural reproduction because the exact third-party binary checkout is unavailable.

- Base and final: 675 nodes, 3,046 edges, 253 SourceGraph unresolved.
- Relation ID duplicate keys: 84 → 0.
- Extra occurrences: 252 → 0.
- Payload multiset: equal.
- Source-proven payload: 744 unchanged.
- Certainty counts: source-proven 744, semantic-candidate 2,050, unknown 252.
- Graph digest: unavailable.

Migration records remain separate from SourceGraph unresolved records:

- retained 2,710;
- renamed 168;
- unresolved 168;
- missingMapping 168;
- SourceGraph unresolved 253.

The old-to-new records and the explicit new-to-old projection are archived in
`relation-id-v1-migration-manifest-fb2.json` and
`relation-id-v03-fb2-bidirectional-audit.json`. Every old occurrence carries
the old graph SHA, payload SHA, old ID, candidate new ID (or null), source span
and an ambiguity reason. The reverse projection reports 614 uniquely mapped,
19 payload-only unresolved, and 2,413 orphaned final occurrences. The latter
is a provenance mismatch between the historical B1.1 graph and the current
structural reproduction, not a deletion claim.

Historical payload comparison is exactly 2,413 mismatches in each direction
and is explicitly `not-proven`; the exact third-party checkout is unavailable.

## Tests

- Relation ID targeted Vitest: 27 passed.
- SourceGraph targeted Vitest: 5 passed, 30 skipped.
- Typecheck: pass.
- Build: pass.
- Windows full Vitest: 70 files; 876 passed, 67 failed, 68 skipped, 4 errors. Raw output is preserved. The failures are not declared environment-only by this archive.

Exact fixed-project B v5, Linux CI, Docker/runtime, Chromium, and remote Draft PR remain UNVERIFIED.
