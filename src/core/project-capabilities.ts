import * as fs from 'node:fs'
import * as path from 'node:path'
import type { SourceGraph } from './model'
import type { ProjectConfigGraph } from './project-config-resolver.mjs'
import { resolveProjectConfigGraph } from './project-config-resolver.mjs'
import ts from 'typescript'

export type CapabilityStatus = 'supported' | 'unsupported' | 'ambiguous'

export interface CapabilityResult<T> {
  status: CapabilityStatus
  reason: string
  value?: T
}

export interface ProjectCapabilities {
  schemaVersion: 'ripple-project-capabilities/v1'
  projectId: string
  sourceDigest: string
  runtimeFingerprint: string
  framework: CapabilityResult<'react-dom-spa'>
  entry: CapabilityResult<{ html: 'index.html'; modules: string[]; pageCount: number }>
  typescriptAliases: CapabilityResult<{ configPath?: string; rules: Array<{ pattern: string; target: string }> }>
  devPreview: CapabilityResult<{ adapter: 'ripple-bounded-react-vite'; dependencyDirectory: string }>
  projectViteConfig: CapabilityResult<{ loaded: false }>
  productionBuild: CapabilityResult<{ executed: false }>
  serverRendering: CapabilityResult<{ executed: false }>
}

function packageManifest(root: string): { status: 'supported'; value: Record<string, unknown> } | { status: 'unsupported' | 'ambiguous'; reason: string } {
  const file = path.join(root, 'package.json')
  if (!fs.existsSync(file) || !fs.lstatSync(file).isFile()) return { status: 'unsupported', reason: 'No project package.json is available for static dependency inspection.' }
  let parsed: unknown
  try { parsed = JSON.parse(fs.readFileSync(file, 'utf8')) }
  catch { return { status: 'ambiguous', reason: 'package.json is not valid JSON, so the framework cannot be identified.' } }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { status: 'ambiguous', reason: 'package.json must contain a JSON object.' }
  return { status: 'supported', value: parsed as Record<string, unknown> }
}

function declaredPackages(manifest: Record<string, unknown> | undefined): Set<string> {
  const names = new Set<string>()
  for (const section of ['dependencies', 'devDependencies', 'peerDependencies']) {
    const value = manifest?.[section]
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const name of Object.keys(value)) names.add(name)
    }
  }
  return names
}

function resolveEntryFiles(root: string, config: ProjectConfigGraph): string[] {
  return config.entries.map(file => path.relative(root, file).replaceAll('\\', '/'))
}

export function inspectProjectCapabilities(rootInput: string, graph: SourceGraph, platform = process.platform): ProjectCapabilities {
  const root = fs.realpathSync(rootInput)
  const config = resolveProjectConfigGraph(root, ts)
  const manifest = packageManifest(root)
  const packages = declaredPackages(manifest.status === 'supported' ? manifest.value : undefined)
  const pageCount = graph.nodes.filter(node => node.kind === 'route').length
  const moduleEntries = resolveEntryFiles(root, config)
  const entryIsSafe = moduleEntries.length === 1 &&
    !moduleEntries[0].startsWith('../') &&
    fs.existsSync(path.join(root, moduleEntries[0])) &&
    fs.lstatSync(path.join(root, moduleEntries[0])).isFile()

  const entry: CapabilityResult<{ html: 'index.html'; modules: string[]; pageCount: number }> = moduleEntries.length > 1
    ? { status: 'ambiguous', reason: 'index.html declares multiple local module entry points; the bounded adapter does not choose one.' }
    : !entryIsSafe
      ? { status: 'unsupported', reason: 'A single existing, project-local module entry in root index.html is required.' }
      : { status: 'supported', reason: 'One local module entry was found in root index.html.', value: { html: 'index.html', modules: moduleEntries, pageCount } }

  const framework: CapabilityResult<'react-dom-spa'> = manifest.status === 'ambiguous'
    ? { status: 'ambiguous', reason: manifest.reason }
    : !packages.has('react') || !packages.has('react-dom')
      ? { status: 'unsupported', reason: 'The project does not declare both React and React DOM.' }
    : pageCount === 0
      ? { status: 'ambiguous', reason: 'React dependencies exist, but the static SourceGraph did not identify a React DOM page state.' }
      : { status: 'supported', reason: `React and React DOM are declared; the static graph found ${pageCount} page state(s).`, value: 'react-dom-spa' }

  const aliases: ProjectCapabilities['typescriptAliases'] = config.aliases.status === 'ambiguous'
    ? { status: 'ambiguous', reason: config.aliases.reason }
    : config.aliases.status === 'supported'
      ? { status: 'supported', reason: 'Path aliases resolve from the app config selected by its HTML entry and TypeScript project graph.', value: { configPath: config.aliases.configPath, rules: config.aliases.rules } }
      : { status: 'supported', reason: 'No TypeScript path aliases are declared; no alias mapping is required.', value: { rules: [] } }

  const dependencyDirectory = path.join(root, 'node_modules')
  const prepared = fs.existsSync(dependencyDirectory) && fs.statSync(dependencyDirectory).isDirectory()
  const viteConfig = ['vite.config.ts', 'vite.config.js', 'vite.config.mts', 'vite.config.mjs', 'vite.config.cjs'].find(name => fs.existsSync(path.join(root, name)))
  const devPreview: ProjectCapabilities['devPreview'] = platform !== 'linux'
    ? { status: 'unsupported', reason: 'Candidate preview currently requires the Linux/Docker runtime; Windows-native and unverified WSL integrations are not supported.' }
    : !prepared
      ? { status: 'unsupported', reason: 'Project dependencies must already be prepared in node_modules; Ripple will not run install scripts.' }
      : framework.status !== 'supported' || entry.status !== 'supported'
        ? { status: 'unsupported', reason: 'The React DOM and single HTML module-entry preconditions are not both proven.' }
        : { status: 'supported', reason: 'The fixed Ripple React/Vite dev adapter can be attempted; this is static compatibility, not a successful preview run.', value: { adapter: 'ripple-bounded-react-vite', dependencyDirectory } }

  return {
    schemaVersion: 'ripple-project-capabilities/v1',
    projectId: graph.revision.projectId,
    sourceDigest: graph.revision.sourceDigest,
    runtimeFingerprint: graph.revision.runtimeFingerprint,
    framework,
    entry,
    typescriptAliases: aliases,
    devPreview,
    projectViteConfig: {
      status: 'unsupported',
      reason: viteConfig ? `${viteConfig} is intentionally not loaded; project plugins and custom startup behavior are unsupported.` : 'Project Vite configuration is not executed; Ripple supplies its own fixed adapter.',
      value: { loaded: false },
    },
    productionBuild: { status: 'unsupported', reason: 'Project build scripts are not executed by the bounded preview runner.', value: { executed: false } },
    serverRendering: { status: 'unsupported', reason: 'SSR and framework server runtimes are outside the React DOM SPA adapter.', value: { executed: false } },
  }
}
