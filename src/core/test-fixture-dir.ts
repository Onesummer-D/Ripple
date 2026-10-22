import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

// Vitest provides __dirname (CJS-style transform); Playwright transpiles to
// real ESM where only import.meta.url exists. Support both.
const here = typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url))

/**
 * Creates a unique fixture project directory under a `.ripple-fixtures`
 * sibling of the repository root (never inside it).
 *
 * Fixture projects must not live under the OS temp directory: Vite's esbuild
 * transform runs tsconfig discovery (tsconfck) upward from every served file,
 * and a stray or broken tsconfig.json in a temp ancestor directory — observed
 * on Windows developer machines — fails every TS/TSX transform with a 500.
 * They must also not live under the repository root: tsconfck then discovers
 * the repo's own tsconfig chain from served fixture files, mixing real
 * project config into fixture transforms, and `.tmp` fixture trees risk being
 * swept into Docker build contexts and git operations. They must also not
 * live under node_modules: dependency-origin classifiers treat any realpath
 * containing a node_modules segment as an installed third-party package. A
 * repo-sibling directory keeps discovery inside the fixture's own tsconfig
 * chain (or none) and realpaths stay clean.
 */
export function makeFixtureRoot(prefix: string): string {
  const base = path.resolve(here, '..', '..', '..', '.ripple-fixtures')
  fs.mkdirSync(base, { recursive: true })
  return fs.mkdtempSync(path.join(base, `${prefix}-`))
}

/**
 * Removes a symlink/junction itself (never its target). `fs.rmSync` can
 * silently leave a dangling junction behind on Windows (the reparse point
 * survives while stat-based checks report it gone), so unlink first.
 */
export function removeLink(linkPath: string): void {
  try { fs.unlinkSync(linkPath) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      fs.rmSync(linkPath, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 })
    }
  }
}

/**
 * Removes a fixture tree. Git fixture repositories contain read-only object
 * files, and Windows refuses to delete a read-only file (EPERM) — chmod
 * everything writable first. Windows also holds file and directory handles
 * briefly after a test's browser or git child process exits; retry transient
 * EPERM/EBUSY instead of flaking the whole suite.
 */
export function removeTree(target: string): void {
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue
      const child = path.join(dir, entry.name)
      try { fs.chmodSync(child, entry.isDirectory() ? 0o777 : 0o666) } catch { /* keep walking */ }
      if (entry.isDirectory()) walk(child)
    }
  }
  try { walk(target) } catch { /* target may already be gone */ }
  fs.rmSync(target, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 })
}
