import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import ts from 'typescript'
import type { ProjectRevision, Relation, SourceGraph, SourceNode } from './model'

export class ProjectReadError extends Error {
  constructor(message: string) { super(message); this.name = 'ProjectReadError' }
}

export interface ProjectSnapshot {
  root: string
  revision: ProjectRevision
  trackedFiles: string[]
}

const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
const normalize = (value: string) => path.resolve(value).replaceAll('\\', '/')
const runGit = (root: string, args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).trimEnd()

function gitRoot(input: string): string {
  const resolved = fs.realpathSync(input)
  let root: string
  try { root = runGit(resolved, ['rev-parse', '--show-toplevel']) }
  catch { throw new ProjectReadError('选定目录不是可读取的 Git 项目') }
  return fs.realpathSync(root)
}

function trackedFiles(root: string): string[] {
  const output = execFileSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  return output.split('\0').filter(Boolean).sort((a, b) => a.localeCompare(b, 'en'))
}

function fileBytes(root: string, relative: string): Uint8Array {
  const absolute = path.resolve(root, relative)
  const rel = path.relative(root, absolute)
  if (!rel || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw new ProjectReadError(`项目路径越界：${relative}`)
  const stat = fs.lstatSync(absolute)
  if (stat.isSymbolicLink()) return Buffer.from(`symlink:${fs.readlinkSync(absolute)}`)
  if (!stat.isFile()) return Buffer.from(`special-file:${stat.mode}`)
  return fs.readFileSync(absolute)
}

export function digestTrackedTree(root: string, files = trackedFiles(gitRoot(root))): string {
  const absoluteRoot = gitRoot(root)
  const hash = createHash('sha256')
  for (const relative of files) {
    const bytes = fileBytes(absoluteRoot, relative)
    hash.update(String(Buffer.byteLength(relative))).update(':').update(relative).update(':')
      .update(String(bytes.byteLength)).update(':').update(sha256(bytes)).update('\n')
  }
  return hash.digest('hex')
}

function runtimeFingerprint(root: string): string {
  const parts = [`node=${process.version}`, `typescript=${ts.version}`]
  for (const name of ['package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'bun.lock']) {
    const candidate = path.join(root, name)
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) parts.push(`${name}=${sha256(fs.readFileSync(candidate))}`)
  }
  return sha256(parts.sort().join('\n'))
}

export function readProjectSnapshot(input: string, requireClean = true): ProjectSnapshot {
  const root = gitRoot(input)
  if (requireClean && runGit(root, ['status', '--porcelain', '--untracked-files=normal'])) {
    throw new ProjectReadError('项目工作树不干净；先提交或收起现有改动，再创建候选')
  }
  const files = trackedFiles(root)
  const gitCommit = runGit(root, ['rev-parse', 'HEAD'])
  const revision: ProjectRevision = {
    projectId: `project:${sha256(normalize(root)).slice(0, 20)}`,
    sourceDigest: digestTrackedTree(root, files),
    gitCommit,
    ref: runGit(root, ['branch', '--show-current']) || gitCommit,
    runtimeFingerprint: runtimeFingerprint(root),
  }
  return { root, revision, trackedFiles: files }
}

interface ComponentInfo { id: string; name: string; file: string; node: ts.Node }
interface ImportTarget { file: string; exportName: string }

const sourceKindFor = (file: string) => /\.(tsx|jsx)$/i.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS
const parseErrors = (source: ts.SourceFile) => (source as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics
const hasJsx = (node: ts.Node): boolean => {
  if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) return true
  return node.forEachChild(hasJsx) ?? false
}
const nodeId = (file: string, kind: string, offset: number) => `${kind}:${file}#${offset}`
const relativeTo = (root: string, absolute: string) => path.relative(root, absolute).replaceAll('\\', '/')
const jsxTagName = (node: ts.JsxOpeningLikeElement) => ts.isIdentifier(node.tagName) ? node.tagName.text : undefined
const propertyName = (property: ts.ObjectLiteralElementLike) => property.name && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) || ts.isNumericLiteral(property.name)) ? property.name.text : undefined
const stringValue = (node: ts.Node | undefined): ts.StringLiteral | ts.NoSubstitutionTemplateLiteral | undefined => {
  if (!node) return undefined
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node
  if (ts.isJsxExpression(node) && node.expression && (ts.isStringLiteral(node.expression) || ts.isNoSubstitutionTemplateLiteral(node.expression))) return node.expression
  return undefined
}
const imageLike = (value: string) => /(?:\.(?:avif|gif|jpe?g|png|svg|webp)(?:[?#].*)?$|^https?:\/\/[^\s]+(?:images|photos|pexels)[^\s]*|^data:image\/)/i.test(value)

function componentInfos(root: string, sources: Map<string, ts.SourceFile>): ComponentInfo[] {
  const result: ComponentInfo[] = []
  for (const [absolute, source] of sources) {
    const file = relativeTo(root, absolute)
    const add = (name: string, node: ts.Node) => {
      if (hasJsx(node)) result.push({ id: nodeId(file, 'component', node.getStart(source)), name, file, node })
    }
    const visit = (node: ts.Node) => {
      if (ts.isFunctionDeclaration(node) && node.name) add(node.name.text, node)
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer &&
        (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) add(node.name.text, node)
      node.forEachChild(visit)
    }
    visit(source)
  }
  return result
}

function declarationComponentName(tag: string | undefined, localImports: Map<string, ImportTarget>, byExport: Map<string, ComponentInfo>): ComponentInfo | undefined {
  if (!tag) return undefined
  const target = localImports.get(tag)
  return target ? byExport.get(`${target.file}#${target.exportName}`) : undefined
}

export function analyzeProject(input: string): SourceGraph {
  const snapshot = readProjectSnapshot(input)
  const sourceFiles = new Map<string, ts.SourceFile>()
  const tracked = new Set(snapshot.trackedFiles.map(file => normalize(path.join(snapshot.root, file))))
  const codeFiles = snapshot.trackedFiles.filter(file => /\.(tsx?|jsx?)$/i.test(file) && !/(^|\/)(node_modules|dist|build|\.ripple)(\/|$)/.test(file))
  for (const relative of codeFiles) {
    const absolute = path.join(snapshot.root, relative)
    const stat = fs.lstatSync(absolute)
    if (stat.isSymbolicLink() || !stat.isFile()) continue
    const source = ts.createSourceFile(relative, fs.readFileSync(absolute, 'utf8'), ts.ScriptTarget.Latest, true, sourceKindFor(relative))
    if (parseErrors(source).length) throw new ProjectReadError(`TypeScript/JSX 解析失败：${relative}`)
    sourceFiles.set(normalize(absolute), source)
  }

  const compilerOptions: ts.CompilerOptions = { jsx: ts.JsxEmit.Preserve, moduleResolution: ts.ModuleResolutionKind.Bundler, allowJs: true }
  for (const configName of ['tsconfig.json', 'tsconfig.app.json', 'jsconfig.json']) {
    const configFile = path.join(snapshot.root, configName)
    if (!fs.existsSync(configFile)) continue
    const read = ts.readConfigFile(configFile, ts.sys.readFile)
    if (!read.error) Object.assign(compilerOptions, ts.parseJsonConfigFileContent(read.config, ts.sys, snapshot.root, undefined, configFile).options)
  }
  const program = ts.createProgram([...sourceFiles.keys()], compilerOptions)
  const checker = program.getTypeChecker()
  for (const absolute of sourceFiles.keys()) {
    const boundSource = program.getSourceFile(absolute)
    if (boundSource) sourceFiles.set(absolute, boundSource)
  }

  const nodes: SourceNode[] = []
  const edges: Relation[] = []
  const unresolved: string[] = []
  const nodeById = new Map<string, SourceNode>()
  const addNode = (node: SourceNode) => { if (!nodeById.has(node.id)) { nodes.push(node); nodeById.set(node.id, node) } }
  const addEdge = (from: string, to: string, kind: Relation['kind'], id: string, certainty: Relation['certainty'] = 'source-proven') => {
    edges.push({ id, from, to, kind, certainty, evidenceRefs: [] })
  }

  for (const relative of snapshot.trackedFiles) {
    addNode({ id: `file:${relative}`, kind: 'file', label: relative, location: { path: relative } })
  }
  const components = componentInfos(snapshot.root, sourceFiles)
  const byExport = new Map(components.map(component => [`${component.file}#${component.name}`, component]))
  for (const component of components) {
    const loc = { path: component.file, start: component.node.getStart(), end: component.node.getEnd() }
    addNode({ id: component.id, kind: 'component', label: component.name, location: loc })
    addEdge(component.id, `file:${component.file}`, 'imports', `source:${component.id}`)
  }

  const tokenNodes = new Map<string, SourceNode[]>()
  const mediaNodes = new Map<string, SourceNode[]>()
  const mediaBySource = new Map<string, SourceNode>()
  const addIndexedValue = (node: SourceNode, index: Map<string, SourceNode[]>, key: string) => {
    addNode(node)
    if (!index.has(key)) index.set(key, [])
    index.get(key)!.push(node)
    addEdge(`file:${node.location!.path}`, node.id, 'reads', `definition:${node.id}`)
  }
  for (const [absolute, source] of sourceFiles) {
    const file = relativeTo(snapshot.root, absolute)
    const addMedia = (property: string, literal: ts.StringLiteral | ts.NoSubstitutionTemplateLiteral) => {
      if (!imageLike(literal.text)) return
      const start = literal.getStart(source) + 1
      const end = literal.getEnd() - 1
      const media: SourceNode = { id: nodeId(file, 'media', start), kind: 'media', label: property, value: literal.text, location: { path: file, start, end } }
      addIndexedValue(media, mediaNodes, property)
      mediaBySource.set(`${file}#${start}`, media)
    }
    const scanValues = (node: ts.Node) => {
      if (ts.isPropertyAssignment(node)) {
        const name = propertyName(node)
        const value = stringValue(node.initializer)
        if (name && value && /^(src|srcSet|image|cover|poster|thumbnail|heroImage|avatar)$/i.test(name)) addMedia(name, value)
        if (name === 'colors' && ts.isObjectLiteralExpression(node.initializer) && /(?:tailwind|theme|tokens?)[^/\\]*\.(?:c?[jt]s|json)$/i.test(file)) {
          const walkPalette = (object: ts.ObjectLiteralExpression, parts: string[]) => {
            for (const entry of object.properties) {
              if (!ts.isPropertyAssignment(entry)) continue
              const segment = propertyName(entry)
              if (!segment) continue
              if (ts.isObjectLiteralExpression(entry.initializer)) { walkPalette(entry.initializer, [...parts, segment]); continue }
              const literal = stringValue(entry.initializer)
              if (!literal || !/^#[\da-f]{3,8}$/i.test(literal.text)) continue
              const token = [...parts, segment].join('.')
              const start = literal.getStart(source) + 1
              const end = literal.getEnd() - 1
              addIndexedValue({ id: nodeId(file, 'token', start), kind: 'token', label: token, value: literal.text, location: { path: file, start, end } }, tokenNodes, token)
            }
          }
          walkPalette(node.initializer, [])
        }
      }
      if (ts.isJsxAttribute(node) && node.name.getText(source) === 'src') {
        const literal = stringValue(node.initializer)
        if (literal) addMedia('src', literal)
      }
      node.forEachChild(scanValues)
    }
    scanValues(source)
  }
  for (const file of snapshot.trackedFiles.filter(candidate => /\.css$/i.test(candidate))) {
    const absolute = path.join(snapshot.root, file)
    if (fs.lstatSync(absolute).isSymbolicLink()) continue
    const css = fs.readFileSync(absolute, 'utf8')
    const definitions = /(--[\w-]+)\s*:\s*([^;{}]+)/g
    for (const match of css.matchAll(definitions)) {
      const raw = match[2]
      const value = raw.trim()
      const start = match.index! + match[0].indexOf(raw) + raw.indexOf(value)
      const token: SourceNode = { id: nodeId(file, 'token', start), kind: 'token', label: match[1], value, location: { path: file, start, end: start + value.length } }
      addIndexedValue(token, tokenNodes, match[1])
    }
    for (const match of css.matchAll(/var\((--[\w-]+)/g)) {
      const definitionsForToken = tokenNodes.get(match[1]) ?? []
      if (definitionsForToken.length === 1) addEdge(`file:${file}`, definitionsForToken[0].id, 'uses-token', `css-token-use:${file}:${match.index}`)
    }
  }

  const componentRenders = new Map<string, Set<string>>()
  const appDirect = new Set<string>()
  const pageTargets = new Map<string, Set<string>>()
  const appComponent = components.find(component => component.name === 'App')
  const pageStateNames = new Set<string>()
  if (appComponent) {
    const findState = (node: ts.Node) => {
      if (ts.isVariableDeclaration(node) && node.initializer && ts.isCallExpression(node.initializer) &&
        ts.isIdentifier(node.initializer.expression) && node.initializer.expression.text === 'useState') {
        if (ts.isIdentifier(node.name)) pageStateNames.add(node.name.text)
        if (ts.isArrayBindingPattern(node.name) && node.name.elements[0] && ts.isBindingElement(node.name.elements[0]) && ts.isIdentifier(node.name.elements[0].name)) {
          pageStateNames.add(node.name.elements[0].name.text)
        }
      }
      node.forEachChild(findState)
    }
    findState(appComponent.node)
  }

  for (const [absolute, source] of sourceFiles) {
    const relative = relativeTo(snapshot.root, absolute)
    const imports = new Map<string, ImportTarget>()
    const importedModules = new Map<string, string>()
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
      const specifier = statement.moduleSpecifier.text
      const scriptResolved = ts.resolveModuleName(specifier, absolute, compilerOptions, ts.sys).resolvedModule?.resolvedFileName
      const cssResolved = /\.css$/i.test(specifier) ? path.resolve(path.dirname(absolute), specifier) : undefined
      const resolved = scriptResolved ?? (cssResolved && tracked.has(normalize(cssResolved)) ? cssResolved : undefined)
      if (!resolved || !tracked.has(normalize(resolved))) {
        if ((specifier.startsWith('.') || specifier.startsWith('@/')) && !/\.css$/i.test(specifier)) unresolved.push(`${relative} → ${specifier}`)
        continue
      }
      const targetFile = relativeTo(snapshot.root, resolved)
      importedModules.set(specifier, targetFile)
      const clause = statement.importClause
      if (clause?.name) imports.set(clause.name.text, { file: targetFile, exportName: 'default' })
      if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const item of clause.namedBindings.elements) imports.set(item.name.text, { file: targetFile, exportName: item.propertyName?.text ?? item.name.text })
      }
      addEdge(`file:${relative}`, `file:${targetFile}`, 'imports', `import:${relative}:${statement.getStart()}`)
    }
    const owner = components.filter(component => component.file === relative)
    const visit = (node: ts.Node) => {
      const ownerComponent = owner.find(component => component.node.pos <= node.pos && component.node.end >= node.end)
      if (ownerComponent && ts.isPropertyAccessExpression(node)) {
        const symbol = checker.getSymbolAtLocation(node.name)
        const declaration = symbol?.valueDeclaration
        const literal = declaration && ts.isPropertyAssignment(declaration) ? stringValue(declaration.initializer) : undefined
        let linked = false
        if (literal && imageLike(literal.text)) {
          const sourcePath = relativeTo(snapshot.root, declaration!.getSourceFile().fileName)
          const media = mediaBySource.get(`${sourcePath}#${literal.getStart(declaration!.getSourceFile()) + 1}`)
          if (media) {
            addEdge(ownerComponent.id, media.id, 'asset-consumer', `asset:${ownerComponent.id}:${media.id}:${node.getStart(source)}`)
            linked = true
          }
        }
        if (!linked) {
          for (const media of mediaNodes.get(node.name.text) ?? []) {
            addEdge(ownerComponent.id, media.id, 'asset-consumer', `asset-candidate:${ownerComponent.id}:${media.id}:${node.getStart(source)}`, 'semantic-candidate')
          }
        }
      }
      if (ownerComponent && ts.isJsxAttribute(node) && node.name.getText(source) === 'src') {
        const literal = stringValue(node.initializer)
        if (literal && imageLike(literal.text)) {
          const media = mediaNodes.get('src')?.find(candidate => candidate.location?.path === relative && candidate.location.start === literal.getStart(source) + 1)
          if (media) addEdge(ownerComponent.id, media.id, 'asset-consumer', `asset:${ownerComponent.id}:${media.id}:${node.getStart(source)}`)
        }
      }
      if (ownerComponent && ts.isJsxAttribute(node) && node.name.getText(source) === 'className') {
        const classNames = stringValue(node.initializer)?.text ?? ''
        for (const [name, candidates] of tokenNodes) {
          if (candidates.length !== 1) continue
          const tailwindName = name.replace('.', '-')
          const pattern = new RegExp(`(?:^|\\s)(?:bg|text|border|ring|fill|stroke|from|to|via)-${tailwindName}(?:\\/[^\\s]+)?(?=\\s|$)`)
          if (pattern.test(classNames)) addEdge(ownerComponent.id, candidates[0].id, 'uses-token', `token-use:${ownerComponent.id}:${candidates[0].id}:${node.getStart(source)}`)
        }
      }
      if (ts.isJsxText(node) && node.text.trim()) {
        const start = node.getStart(source), end = node.getEnd()
        const parentElement = node.parent
        const rawValue = source.text.slice(start, end)
        const sourceNode: SourceNode = { id: nodeId(relative, 'literal', start), kind: 'data', label: rawValue.trim(), value: rawValue, location: { path: relative, start, end }, page: undefined }
        addNode(sourceNode)
        if (ownerComponent) addEdge(ownerComponent.id, sourceNode.id, 'reads', `literal-read:${sourceNode.id}`)
        if (ts.isJsxElement(parentElement)) {
          const elementId = nodeId(relative, 'jsx', parentElement.openingElement.getStart(source))
          addEdge(elementId, sourceNode.id, 'reads', `jsx-text:${elementId}:${sourceNode.id}`)
        }
      }
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tag = jsxTagName(node)
        if (tag && /^[a-z]/.test(tag)) {
          const start = node.getStart(source)
          const elementEnd = ts.isJsxOpeningElement(node) && ts.isJsxElement(node.parent) ? node.parent.getEnd() : node.getEnd()
          addNode({ id: nodeId(relative, 'jsx', start), kind: 'jsx-element', label: `<${tag}>`, location: { path: relative, start, end: elementEnd }, selector: `[data-ripple-source="jsx:${relative}#${start}"]` })
        }
        const target = declarationComponentName(tag, imports, byExport)
        if (target && ownerComponent) {
          if (!componentRenders.has(ownerComponent.id)) componentRenders.set(ownerComponent.id, new Set())
          componentRenders.get(ownerComponent.id)!.add(target.id)
          addEdge(ownerComponent.id, target.id, 'renders', `render:${ownerComponent.id}:${node.getStart(source)}`)
          if (appComponent?.id === ownerComponent.id) appDirect.add(target.id)
        }
      }
      if (relative === appComponent?.file && ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
        ts.isIdentifier(node.left) && pageStateNames.has(node.left.text) && ts.isStringLiteral(node.right)) {
        const state = node.right.text
        const targets = new Set<string>()
        const collectTags = (child: ts.Node) => {
          if (ts.isJsxOpeningElement(child) || ts.isJsxSelfClosingElement(child)) {
            const target = declarationComponentName(jsxTagName(child), imports, byExport)
            if (target) targets.add(target.id)
          }
          child.forEachChild(collectTags)
        }
        let conditional: ts.Node = node
        while (conditional.parent && !(ts.isBinaryExpression(conditional.parent) && conditional.parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken)) conditional = conditional.parent
        if (conditional.parent && ts.isBinaryExpression(conditional.parent)) collectTags(conditional.parent.right)
        pageTargets.set(state, targets)
        const pageId = `page:${state}`
        addNode({ id: pageId, kind: 'route', label: state, page: state, location: { path: relative, start: node.getStart(source), end: node.getEnd() } })
        for (const target of targets) addEdge(pageId, target, 'renders', `page-render:${state}:${target}`)
      }
      node.forEachChild(visit)
    }
    visit(source)
    void importedModules
  }

  const routedComponentIds = new Set([...pageTargets.values()].flatMap(targets => [...targets]))
  const sharedAppComponents = [...appDirect].filter(id => !routedComponentIds.has(id))
  for (const [state, targets] of pageTargets) {
    for (const global of appDirect) {
      if (!routedComponentIds.has(global)) addEdge(`page:${state}`, global, 'renders', `page-global:${state}:${global}`)
    }
    const queue = [...targets, ...sharedAppComponents]
    const visited = new Set<string>()
    while (queue.length) {
      const current = queue.shift()!
      if (visited.has(current)) continue
      visited.add(current)
      const node = nodeById.get(current)
      if (node?.kind === 'component') node.pages = [...(node.pages ?? []), state]
      for (const child of componentRenders.get(current) ?? []) queue.push(child)
    }
  }

  const endDigest = readProjectSnapshot(snapshot.root).revision.sourceDigest
  if (endDigest !== snapshot.revision.sourceDigest) throw new ProjectReadError('分析期间项目源码发生变化，请重新读取')
  return { id: `graph:${snapshot.revision.sourceDigest.slice(0, 20)}`, revision: snapshot.revision, nodes, edges, unresolved: [...new Set(unresolved)] }
}

export function resolveJsxSourceElement(graph: SourceGraph, sourceRef: string): { element: SourceNode; editableText: SourceNode[] } {
  const normalizedRef = sourceRef.startsWith('jsx:') ? sourceRef : `jsx:${sourceRef}`
  const element = graph.nodes.find(node => node.kind === 'jsx-element' && node.id === normalizedRef)
  if (!element) throw new ProjectReadError(`运行时元素没有已确认的源码映射：${sourceRef}`)
  const textRefs = new Set(graph.edges.filter(edge => edge.kind === 'reads' && edge.from === element.id).map(edge => edge.to))
  const editableText = graph.nodes.filter(node => node.kind === 'data' && textRefs.has(node.id))
  return { element, editableText }
}

export function resolveRuntimeElement(graph: SourceGraph, selection: { sourceRef: string; runtimeInstanceId: string }): { element: SourceNode; runtimeInstanceId: string; editableText: SourceNode[] } {
  if (!selection.runtimeInstanceId || selection.runtimeInstanceId === selection.sourceRef) throw new ProjectReadError('运行时实例标识必须与 JSX 源码锚点分离')
  const resolved = resolveJsxSourceElement(graph, selection.sourceRef)
  return { ...resolved, runtimeInstanceId: selection.runtimeInstanceId }
}
