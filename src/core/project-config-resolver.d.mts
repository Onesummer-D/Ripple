import type ts from 'typescript'

export interface ProjectConfigRecord {
  configPath: string
  raw: Record<string, unknown>
  parsed: ts.ParsedCommandLine
}

export type ProjectConfigAliasRule =
  | { kind: 'alias'; pattern: string; target: string }
  | { kind: 'existence-fallback'; pattern: string; target: string }

export interface ProjectConfigGraph {
  root: string
  entries: string[]
  configs: ProjectConfigRecord[]
  application: {
    status: 'supported'
    configPath: string
    parsed: ts.ParsedCommandLine
  } | {
    status: 'unsupported' | 'ambiguous'
    reason: string
  }
  aliases: {
    status: 'supported'
    configPath: string
    rules: ProjectConfigAliasRule[]
  } | {
    status: 'unsupported' | 'ambiguous'
    reason: string
    rules: []
  }
}

export function resolveProjectConfigGraph(root: string, typescript: typeof ts): ProjectConfigGraph
export function toViteAliasRules(graph: ProjectConfigGraph): Array<{ find: string | RegExp; replacement: string }>
export function toViteExistenceFallbackPrefixes(graph: ProjectConfigGraph): string[]
export function probeExistenceFallback(prefixDir: string, specifier: string, fileExists?: (candidate: string) => boolean): string | null
