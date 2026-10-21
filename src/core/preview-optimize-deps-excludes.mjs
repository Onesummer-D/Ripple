// Workspace-linked packages (symlinked into node_modules, e.g. pnpm/workspace
// layouts) are project source, not third-party deps: prebundling them would
// bypass sourceAnnotationPlugin and drop SourceGraph bindings and Runtime
// Identity for the user's own code. Vite's optimizer classifies by resolved
// path and, with preserveSymlinks on, cannot tell these apart from real deps —
// so we detect them deterministically at config time. A package qualifies
// only if it is a symbolic link inside root/node_modules; everything else in
// node_modules stays eligible for prebundling. Returns bare package names;
// Vite's exclude matching covers subpath imports (linkedpkg/helper) via
// prefix match (moduleListContains: m === id || id.startsWith(m + '/')).
import * as fs from 'node:fs'
import * as path from 'node:path'

export function symlinkedWorkspaceExcludes(root) {
  try {
    const nm = path.join(root, 'node_modules')
    const out = []
    const walk = (dir, prefix) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) out.push(prefix + entry.name)
        else if (!prefix && entry.isDirectory() && entry.name.startsWith('@')) walk(path.join(dir, entry.name), entry.name + '/')
      }
    }
    walk(nm, '')
    return out
  } catch {
    return []
  }
}
