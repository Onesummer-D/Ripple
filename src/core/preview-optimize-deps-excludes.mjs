// Dependency-origin classification for the restricted optimizeDeps experiment
// (coordinator approval 2026-10-22, review round 2).
//
// Rule set:
// - Project / workspace source must NEVER be prebundled: prebundling bypasses
//   sourceAnnotationPlugin and drops SourceGraph bindings and Runtime Identity
//   for the user's own code.
// - Confirmed third-party installed deps MAY be prebundled.
// - When origin cannot be determined, exclude conservatively.
// - When the node_modules scan itself fails, do NOT fall back to an empty
//   exclude list (that would open every dependency to prebundling): report
//   ok:false so the caller refuses optimization / falls back to noDiscovery.
//
// Classification per top-level package entry (including one @scope level):
// - not a symbolic link  -> a real directory inside node_modules -> third-party
// - symlink whose realpath still contains a node_modules segment -> installed
//   by a symlinked store layout (pnpm .pnpm) -> third-party
// - symlink whose realpath has no node_modules segment -> the package really
//   lives inside the project (workspace source) -> exclude from prebundling
// - symlink whose realpath cannot be resolved -> origin unknown -> exclude
import * as fs from 'node:fs'
import * as path from 'node:path'

// Result shape: { ok, reason?, excludes, thirdParty } — ok:false means the
// caller must refuse optimization (fall back to noDiscovery).

const isNodeModulesPath = (resolved) => resolved.split(path.sep).includes('node_modules')

export function analyzeNodeModulesDeps(root) {
  const nm = path.join(root, 'node_modules')
  let entries
  try {
    entries = fs.readdirSync(nm, { withFileTypes: true })
  } catch (error) {
    // A project without node_modules has nothing to classify; that is a
    // complete answer, not a scan failure. Anything else (permissions, a
    // non-directory node_modules, ...) means origins are UNKNOWN and the
    // caller must refuse optimization rather than open every dependency.
    if (error && error.code === 'ENOENT') {
      return { ok: true, excludes: [], thirdParty: [] }
    }
    return { ok: false, reason: `cannot scan ${nm}: ${error && error.message ? error.message : String(error)}`, excludes: [], thirdParty: [] }
  }
  const excludes = []
  const thirdParty = []
  const classifyEntry = (dir, entry, prefix) => {
    const name = prefix + entry.name
    if (!entry.isSymbolicLink()) {
      thirdParty.push(name)
      return
    }
    let real
    try {
      real = fs.realpathSync(path.join(dir, entry.name))
    } catch {
      // Origin unresolvable: conservative exclusion.
      excludes.push(name)
      return
    }
    if (isNodeModulesPath(real)) thirdParty.push(name)
    else excludes.push(name)
  }
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name.startsWith('@')) {
      for (const scoped of fs.readdirSync(path.join(nm, entry.name), { withFileTypes: true })) {
        classifyEntry(path.join(nm, entry.name), scoped, `${entry.name}/`)
      }
    } else if (entry.isDirectory() || entry.isSymbolicLink()) {
      classifyEntry(nm, entry, '')
    }
  }
  return { ok: true, excludes: excludes.sort(), thirdParty: thirdParty.sort() }
}
