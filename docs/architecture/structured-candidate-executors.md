# Structured Candidate executor integration

Status: A implementation for B integration review. The frozen
`ripple-edit-operation-session/v1` fields are unchanged. No MEDIA handler is
registered by default; this extension does not certify MEDIA browser evidence.

## Public seam

Import the types from `src/core/candidate-operation-executors.ts`:

```ts
interface CandidateOperationExecutor<O extends StructuredEditOperation> {
  readonly kind: O['kind']
  readonly action: O['action']
  validate(operation: unknown): operation is O
  plan(input: CandidateOperationContext<O>): CandidateOperationPlan
}

interface CandidateOperationPlan {
  sourceEdits?: readonly CandidateSourceEdit[]
  fileWrites?: readonly { path: string; bytes: Uint8Array }[]
}
```

`plan` is synchronous and returns data. Its context contains the typed operation,
current target, SourceGraph, ScopeDecision and `readStagedAsset(sha256)`. The byte
reader is supplied by the trusted application; Candidate recomputes SHA-256 before
returning a copied byte array. Prepare uploads, decoding and asynchronous work
before candidate creation. The executor remains responsible for its action's
semantics, including relating any transformed output to the payload and evidence.

Pass one registry to `stageOperations(session, operations, executors)` and
`createCandidate({ ..., executors, readStagedAsset })`. The local application uses
`localProjectApiPlugin({ candidateOperationExecutors, readStagedAsset })` to inject
both dependencies into the existing API flow. Neither dependency is user JSON or
persisted as executable session state. Restoring an existing patch does not rerun
its executor.

## Enforced limits and failures

- Session validates the existing action/payload union, then requires one matching
  registered `kind`/`action` whose validator accepts it. Duplicate registrations,
  missing handlers and unknown/malformed actions are refused. Payloadless edits
  retain their existing path. There is no structured-to-literal fallback.
- Candidate requires a current source-proven target with a source location and
  checks included/excluded/protected targets and page propagation before planning.
  The current page-override strategy remains TEXT-only.
- Each source edit has `path`, `start`, `end`, `before`, and `after`; it must stay
  within the authorized target's source range. Candidate checks original bytes,
  overlap and resulting source syntax, and batches edits against one baseline.
  Import insertion or edits to additional existing source ranges are not granted
  implicitly by this seam.
- `fileWrites` only creates new files. Existing files, duplicate destinations,
  absolute/traversing paths and symlink traversal are refused. An asset swap can
  create a new immutable asset and update its authorized source reference; it
  cannot replace a shared binary in place and bypass consumer Scope checks.
- Candidate performs writes, registers added files with Git, generates the real
  binary patch and hashes the actual resulting tree bytes. Integrity checks reject
  changed asset bytes, patch artifacts and unregistered worktree changes.
- Verification, approval, apply and rollback use the existing CandidatePatch.
  Apply checks the approved patch and baseline; rollback refuses later user edits.
  A successful planner does not produce passed VerificationRun evidence.

## Ownership and acceptance

A owns this registry/plan seam, shared Session validation, Candidate integrity,
Project API injection, and core contract tests. B owns the independent asset-swap
module, upload/staging storage, image decoding/transforms and MEDIA assertions.
B should review whether the source-range restriction covers each supported source
form before registering the handler. Unsupported forms must fail explicitly.

Core tests cover binary addition, input/worktree/patch tampering, unknown and
malformed actions, protected Scope, path escape, symlinks, unregistered changes,
and same-patch apply/rollback. Their test executor and trusted test receipt are
unit fixtures, not acceptance of the production MEDIA handler or browser evidence.
Asset upload UI, production staging, cropping, responsive variants and MEDIA
Evidence still need B's implementation and real browser acceptance.
