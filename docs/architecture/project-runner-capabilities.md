# ProjectRunner / VerificationRunner capability boundary

Status: Linux/Docker preview adapter, 2026-10-19

## Supported today

The built-in adapter is for a dependency-prepared React DOM single-page site served from a Vite-style root `index.html`. It uses Ripple's fixed Vite setup and React plugin; it does not run project package lifecycle scripts. JavaScript, JSX, TypeScript and TSX source imports are supported when the dependencies are already available in the isolated candidate runtime.

The analyze API returns `ripple-project-capabilities/v1`, tied to the source digest and runtime fingerprint. These are static preflight results, not evidence that a preview, build or browser test has run. `supported`, `unsupported` and `ambiguous` each carry a reason; actual run success remains a separate VerificationRunner result.

TypeScript and JavaScript path aliases are read as data, not executed. One shared config-graph resolver starts from conventional root `tsconfig.json` / `jsconfig.json`, follows standard project references to arbitrarily named application configs, and relies on TypeScript's parser for `extends`. Both SourceGraph's compiler options and the preview's Vite aliases consume this same resolution. The application config must be identifiable from the HTML module entry or an unambiguous JSX config. Multiple alias destinations, conflicting maps and unprefixed wildcards such as `* → src/*` are reported ambiguous. Unprefixed mappings need TypeScript's file-existence fallback for package imports; ordinary Vite aliases would incorrectly rewrite dependencies such as React. Preview is unavailable for this known unsupported mapping until a bounded fallback-aware resolver is implemented.

External resources used by verification remain explicitly authorized and content-snapshotted; the candidate container does not receive general internet access.

The selected application's parsed TypeScript options remain available to SourceGraph, including valid path mappings that the bounded Vite adapter cannot represent. Preview ambiguity does not erase static compiler resolution or promote it into browser evidence. Both consumers use the same selected config; their execution capabilities differ explicitly.

## Explicitly unsupported

The runner sets `configFile: false`, so project `vite.config.*`, its custom plugins, server hooks, environment-dependent startup logic and build commands are not loaded. The adapter does not claim support for SSR or framework runtimes such as Next.js/Remix, non-React Vite plugins, custom backend services, arbitrary application startup scripts, or projects that need custom Vite transforms. Unsupported/ambiguous behavior must remain unavailable or UNKNOWN; it is not emulated by project-specific branches.

Capability output marks project Vite configuration, production builds and SSR as unsupported even when a matching file or script exists. A supported dev-preview preflight means only that React/React DOM, one local HTML module entry, prepared dependencies and the Linux runner boundary match; the real preview still has to start and render successfully.

The fixed adapter is not a universal framework sandbox. A Git worktree and an internal Docker network are not equivalent to a VM or an OS-level security sandbox. Only run source that the user has explicitly chosen to preview. The current Vite CSS pipeline can discover PostCSS configuration from the project root; projects with executable PostCSS/Tailwind configuration therefore remain trusted-project previews, not untrusted-upload support. A separately reviewed static CSS adapter is required before claiming that boundary is closed.

## Adapter policy

Add support only through reusable capability declarations or bounded adapters shared by a class of projects. Do not key behavior on a project/repository name, and do not execute arbitrary project Vite configuration to discover capabilities. Keep actual verified capabilities distinct from planned adapters.
