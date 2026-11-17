# FrozenSourceSnapshot E handoff

## Ownership

E owns `src/core/frozen-source-snapshot.ts`, its focused tests, and this handoff. C owns `src/core/project.ts` and the final analyzer call path. The isolated E branch does not edit `project.ts` or change SourceGraph, Runtime Identity, VerificationRun, or authorization contracts.

The E module stores copied byte buffers and derives `sourceDigest`, per-file SHA-256, and `trackedSetSha256` from those same bytes. Optional Git HEAD and Root Tree fields are descriptive metadata supplied by the caller; the factory does not prove that the caller selected a trusted project or host registry entry.

## Consumer contract for C

1. Build the snapshot once from the host-selected tracked set and the byte buffers bound to the chosen HEAD/Root Tree. A missing tracked file, duplicate path, absolute/traversal path, backslash path, or non-byte entry must stop analysis.
2. Use `createFrozenTypeScriptSystem(snapshot, ts, externalRoots)` for config parsing, `readConfigFile`, route/config discovery, and module resolution. Use `createFrozenTypeScriptHost(snapshot, ts, options, externalRoots)` for `createProgram`.
3. Route every project-root read through the snapshot: TS/JS/JSX/TSX, CSS, HTML, JSON config, page overrides, and route files. Do not fall back to `ts.sys` or `fs` for a path under `snapshot.root`. Explicit external roots are only for toolchain libraries/dependencies and cannot be used for project files.
4. Do not call `git status` or another command that writes `.git/index.lock` while analyzing a frozen snapshot. Read revision metadata from the snapshot object. The E module itself performs no Git subprocess and no filesystem writes.
5. A successful Graph remains content analysis only. This module has no host registry issuer and exports no `trusted`, `runtimeProof`, or authorization result.

The module's TypeScript system blocks `writeFile`, `createDirectory`, and `deleteFile`. It cannot intercept a separate Git child process; C must remove Git-based working-tree checks from the frozen-input call path.

## JSX TypeChecker incident

At the original Linux run, TypeScript 5.9.3 reported `Cannot read properties of undefined (reading '0')` from `getJSXRuntimeImportSpecifier`, reached through `checker.getSymbolAtLocation` in `declarationComponentName`. The analyzer had parsed TSX into a separate `sourceFiles` map before constructing a second TypeScript `Program`, then queried the checker using nodes from that map unless a Program-owned SourceFile was found. This is consistent with a SourceFile ownership mismatch (a checker receiving a node from a SourceFile that is not the Program's bound SourceFile), rather than a snapshot-specific parser failure. The E test creates a TypeScript Program using the frozen CompilerHost, resolves a JSX symbol with automatic JSX runtime enabled, and verifies that the exception does not occur. C should eliminate the duplicate parse and use Program-owned SourceFiles for all checker queries.

This diagnosis is tied to the recorded stack and the focused host test. The old end-to-end Analyzer has not yet been integrated with this module; a real `analyzeProject(snapshot)` result and Graph counts remain a C integration acceptance requirement.

## Host trust boundary

An absent Host Registry remains `unavailable`. Snapshot metadata, a successful TypeScript Program, graph counts, sourceDigest, or a changed live checkout cannot issue host trust, Runtime Identity proof, or authorization. Existing H0 tests in the isolated wrapper branch pass 36/36, including registry-unavailable and `runtimeProof: 'none'` / `authorizationEligible: false` outcomes.

## Acceptance status

- Snapshot and TypeScript host focused tests: 4/4 pass in the repository dependency worktree.
- Repository Typecheck: pass.
- Host Trust Wrapper tests: 36/36 pass.
- Full `analyzeProject()` against FrozenSourceSnapshot and an emitted SourceGraph: pending C integration.
