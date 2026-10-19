import path from 'node:path'

function parseConfig(configPath, ts) {
  const absolutePath = path.resolve(configPath)
  const read = ts.readConfigFile(absolutePath, ts.sys.readFile)
  if (read.error) return undefined
  const parsed = ts.getParsedCommandLineOfConfigFile(absolutePath, {}, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: () => {},
  })
  return parsed ? { configPath: absolutePath, raw: read.config, parsed } : undefined
}

function applicationEntries(root, ts) {
  const htmlPath = path.join(root, 'index.html')
  if (!ts.sys.fileExists(htmlPath)) return []
  const html = ts.sys.readFile(htmlPath) ?? ''
  return [...html.matchAll(/<script\b[^>]*\btype=["']module["'][^>]*>/gi)]
    .map(match => match[0])
    .map(tag => tag.match(/\bsrc=["']([^"']+)["']/i)?.[1])
    .filter(source => source && !/^(?:[a-z]+:|\/\/)/i.test(source))
    .map(source => path.resolve(root, source.replace(/^\/+/, '').split(/[?#]/, 1)[0]))
}

function collectConfigs(root, ts) {
  const pending = ['tsconfig.json', 'jsconfig.json']
    .map(name => path.join(root, name))
    .filter(file => ts.sys.fileExists(file))
  const visited = new Set()
  const configs = []
  while (pending.length) {
    const configPath = path.resolve(pending.shift())
    if (visited.has(configPath)) continue
    visited.add(configPath)
    const config = parseConfig(configPath, ts)
    if (!config) continue
    configs.push(config)
    const references = Array.isArray(config.raw.references) ? config.raw.references : []
    for (const reference of references) {
      if (typeof reference?.path !== 'string') continue
      const referencePath = path.resolve(path.dirname(configPath), reference.path)
      const target = ts.sys.directoryExists(referencePath) ? path.join(referencePath, 'tsconfig.json') : referencePath
      if (ts.sys.fileExists(target)) pending.push(target)
    }
  }
  return configs
}

function configSignature(config) {
  const options = config.parsed.options
  const signature = {
    jsx: options.jsx,
    moduleResolution: options.moduleResolution,
    allowJs: options.allowJs,
  }
  signature.baseUrl = options.baseUrl ?? (Object.keys(options.paths ?? {}).length ? options.pathsBasePath ?? path.dirname(config.configPath) : undefined)
  signature.paths = options.paths ?? {}
  return JSON.stringify(signature)
}

function chooseConfig(candidates, entries) {
  if (!candidates.length) return { status: 'unsupported', reason: 'No TypeScript project config was discovered.' }
  const containingEntry = candidates.filter(config => config.parsed.fileNames.some(file => entries.includes(path.resolve(file))))
  const jsxConfigs = candidates.filter(config => config.parsed.options.jsx !== undefined)
  const selected = containingEntry.length ? containingEntry : jsxConfigs.length ? jsxConfigs : candidates
  const signatures = new Set(selected.map(config => configSignature(config)))
  if (signatures.size > 1) return { status: 'ambiguous', reason: 'Several referenced application configs contain conflicting compiler or path-alias settings.', candidates: selected }
  return { status: 'supported', config: [...selected].sort((a, b) => a.configPath.localeCompare(b.configPath, 'en'))[0] }
}

function aliasRules(config) {
  const options = config.parsed.options
  if (!Object.keys(options.paths ?? {}).length) return { status: 'unsupported', reason: 'The selected application config declares no TypeScript path aliases.', rules: [] }
  const baseUrl = options.baseUrl ?? options.pathsBasePath ?? path.dirname(config.configPath)
  const rules = []
  for (const [pattern, destinations] of Object.entries(options.paths ?? {})) {
    if (destinations.length !== 1) return { status: 'ambiguous', reason: `Alias ${pattern} has multiple destinations.`, rules: [] }
    const target = destinations[0]
    const wildcardCount = value => [...value].filter(char => char === '*').length
    if (wildcardCount(pattern) > 1 || wildcardCount(target) > 1 || (pattern.includes('*') !== target.includes('*'))) {
      return { status: 'ambiguous', reason: `Alias ${pattern} cannot be represented by the bounded preview resolver.`, rules: [] }
    }
    rules.push({ pattern, target: path.resolve(baseUrl, target) })
  }
  return { status: 'supported', rules }
}

export function resolveProjectConfigGraph(inputRoot, ts) {
  const root = path.resolve(inputRoot)
  const entries = applicationEntries(root, ts)
  const configs = collectConfigs(root, ts)
  const application = chooseConfig(configs, entries)
  let aliases
  if (application.status !== 'supported') aliases = { status: application.status, reason: application.reason, rules: [] }
  else aliases = aliasRules(application.config)
  return {
    root,
    entries,
    configs,
    application: application.status === 'supported'
      ? { status: 'supported', configPath: application.config.configPath, parsed: application.config.parsed }
      : { status: application.status, reason: application.reason },
    aliases: aliases.status === 'supported'
      ? { status: 'supported', configPath: application.config.configPath, rules: aliases.rules }
      : aliases,
  }
}

export function toViteAliasRules(graph) {
  if (graph.aliases.status !== 'supported') return []
  return graph.aliases.rules.map(({ pattern, target }) => {
    const wildcard = pattern.indexOf('*')
    if (wildcard < 0) return { find: pattern, replacement: target }
    const prefix = pattern.slice(0, wildcard).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const suffix = pattern.slice(wildcard + 1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const targetWildcard = target.indexOf('*')
    const targetPrefix = target.slice(0, targetWildcard)
    const targetSuffix = target.slice(targetWildcard + 1)
    return {
      find: new RegExp(`^${prefix}(.*)${suffix}$`),
      replacement: `${targetPrefix}$1${targetSuffix}`,
    }
  })
}
