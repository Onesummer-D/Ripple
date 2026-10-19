# ProjectRunner / VerificationRunner capability boundary

Status: Linux/Docker preview adapter, 2026-10-19

## Supported today

The built-in adapter is for a dependency-prepared React DOM single-page site served from a Vite-style root `index.html`. It uses Ripple's fixed Vite setup and React plugin; it does not run project package lifecycle scripts. JavaScript, JSX, TypeScript and TSX source imports are supported when the dependencies are already available in the isolated candidate runtime.

TypeScript and JavaScript path aliases are read as data, not executed. Discovery starts at the conventional root `tsconfig.json` or `jsconfig.json`; referenced project configs are followed recursively, while `extends` is resolved by the TypeScript config parser. The selected application config must be identifiable from the HTML module entry or a single unambiguous JSX config. Alias patterns with multiple targets or ambiguous conflicting application maps are not guessed.

External resources used by verification remain explicitly authorized and content-snapshotted; the candidate container does not receive general internet access.

## Explicitly unsupported

The runner sets `configFile: false`, so project `vite.config.*`, its custom plugins, server hooks, environment-dependent startup logic and build commands are not loaded. The adapter does not claim support for SSR or framework runtimes such as Next.js/Remix, non-React Vite plugins, custom backend services, arbitrary application startup scripts, or projects that need custom Vite transforms. Unsupported/ambiguous behavior must remain unavailable or UNKNOWN; it is not emulated by project-specific branches.

The fixed adapter is not a universal framework sandbox. A Git worktree and an internal Docker network are not equivalent to a VM or an OS-level security sandbox. Only run source that the user has explicitly chosen to preview. The current Vite CSS pipeline can discover PostCSS configuration from the project root; projects with executable PostCSS/Tailwind configuration therefore remain trusted-project previews, not untrusted-upload support. A separately reviewed static CSS adapter is required before claiming that boundary is closed.

## Adapter policy

Add support only through reusable capability declarations or bounded adapters shared by a class of projects. Do not key behavior on a project/repository name, and do not execute arbitrary project Vite configuration to discover capabilities. Keep actual verified capabilities distinct from planned adapters.
