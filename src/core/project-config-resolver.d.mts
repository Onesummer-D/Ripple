import type ts from 'typescript'

export interface ProjectConfigRecord {
  configPath: string
  raw: Record<string, unknown>
  parsed: ts.ParsedCommandLine
}

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
    rules: Array<{ pattern: string; target: string }>
  } | {
    status: 'unsupported' | 'ambiguous'
    reason: string
    rules: []
  }
}

export function resolveProjectConfigGraph(root: string, typescript: typeof ts): ProjectConfigGraph
export function toViteAliasRules(graph: ProjectConfigGraph): Array<{ find: string | RegExp; replacement: string }>
