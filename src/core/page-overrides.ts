import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import ts from 'typescript'

export interface PageOverrideRegistry {
  schemaVersion: 2
  targets: Record<string, { original: string }>
  pages: Record<string, Record<string, string>>
}

export interface PageOverrideMarker {
  id: string
  fallback: string
  start: number
  end: number
  fallbackInitializer: { start: number; end: number }
}

export class PageOverrideError extends Error {
  constructor(message: string) { super(message); this.name = 'PageOverrideError' }
}

export const emptyPageOverrideRegistry = (): PageOverrideRegistry => ({ schemaVersion: 2, targets: {}, pages: {} })
export const newPageOverrideTargetId = () => `override:${randomUUID()}`

const validTargetId = (value: string) => /^override:[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value)

function validateRegistry(value: unknown): PageOverrideRegistry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PageOverrideError('覆盖注册表必须是 JSON 对象')
  const registry = value as Partial<PageOverrideRegistry>
  if (registry.schemaVersion !== 2 || !registry.targets || typeof registry.targets !== 'object' || Array.isArray(registry.targets) ||
    !registry.pages || typeof registry.pages !== 'object' || Array.isArray(registry.pages)) {
    throw new PageOverrideError('现有 .ripple/overrides.json 不符合稳定目标 ID v2 契约')
  }
  for (const [id, target] of Object.entries(registry.targets)) {
    if (!validTargetId(id) || !target || typeof target.original !== 'string') throw new PageOverrideError(`覆盖目标身份无效：${id}`)
  }
  for (const [pageRef, entries] of Object.entries(registry.pages)) {
    if (!pageRef || !entries || typeof entries !== 'object' || Array.isArray(entries) || !Object.keys(entries).length) {
      throw new PageOverrideError(`页面覆盖规则无效：${pageRef}`)
    }
    for (const [id, value] of Object.entries(entries)) {
      if (!validTargetId(id) || !(id in registry.targets!) || typeof value !== 'string') throw new PageOverrideError(`页面覆盖引用了无效目标：${pageRef} → ${id}`)
    }
  }
  return registry as PageOverrideRegistry
}

export function readPageOverrideRegistry(root: string): PageOverrideRegistry {
  const directory = path.join(root, '.ripple')
  const registryPath = path.join(directory, 'overrides.json')
  if (!fs.existsSync(directory)) return emptyPageOverrideRegistry()
  const directoryStat = fs.lstatSync(directory)
  if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) throw new PageOverrideError('本地覆盖目录必须是普通目录')
  if (!fs.existsSync(registryPath)) return emptyPageOverrideRegistry()
  const fileStat = fs.lstatSync(registryPath)
  if (fileStat.isSymbolicLink() || !fileStat.isFile()) throw new PageOverrideError('覆盖注册表必须是普通文件')
  try { return validateRegistry(JSON.parse(fs.readFileSync(registryPath, 'utf8'))) }
  catch (error) {
    if (error instanceof PageOverrideError) throw error
    throw new PageOverrideError('现有 .ripple/overrides.json 无法解析')
  }
}

export function writePageOverrideRegistry(root: string, registry: PageOverrideRegistry): void {
  const directory = path.join(root, '.ripple')
  if (fs.existsSync(directory) && (fs.lstatSync(directory).isSymbolicLink() || !fs.lstatSync(directory).isDirectory())) {
    throw new PageOverrideError('本地覆盖目录必须是普通目录')
  }
  fs.mkdirSync(directory, { recursive: true })
  const registryPath = path.join(directory, 'overrides.json')
  if (fs.existsSync(registryPath) && (fs.lstatSync(registryPath).isSymbolicLink() || !fs.lstatSync(registryPath).isFile())) {
    throw new PageOverrideError('覆盖注册表必须是普通文件')
  }
  fs.writeFileSync(registryPath, `${JSON.stringify(validateRegistry(registry), null, 2)}\n`, 'utf8')
}

const attribute = (node: ts.JsxOpeningLikeElement, name: string) => node.attributes.properties.find(item =>
  ts.isJsxAttribute(item) && item.name.getText() === name) as ts.JsxAttribute | undefined

const staticString = (node: ts.JsxAttribute | undefined): ts.StringLiteral | ts.NoSubstitutionTemplateLiteral | undefined => {
  const initializer = node?.initializer
  if (initializer && ts.isStringLiteral(initializer)) return initializer
  if (initializer && ts.isJsxExpression(initializer) && initializer.expression &&
    (ts.isStringLiteral(initializer.expression) || ts.isNoSubstitutionTemplateLiteral(initializer.expression))) return initializer.expression
  return undefined
}

export function findPageOverrideMarkers(sourceText: string, fileName: string): { markers: PageOverrideMarker[]; invalid: string[] } {
  const kind = /\.jsx$/i.test(fileName) ? ts.ScriptKind.JSX : ts.ScriptKind.TSX
  const source = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, kind)
  const markers: PageOverrideMarker[] = []
  const invalid: string[] = []
  const visit = (node: ts.Node) => {
    if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && ts.isIdentifier(node.tagName) && node.tagName.text === 'RippleText') {
      const id = staticString(attribute(node, 'targetRef'))?.text
      const fallback = staticString(attribute(node, 'fallback'))
      const fallbackAttribute = attribute(node, 'fallback')
      if (!id || !validTargetId(id) || !fallback || !fallbackAttribute?.initializer) {
        invalid.push(`${fileName}#${node.getStart(source)} has a malformed RippleText marker`)
      } else {
        const initializer = fallbackAttribute.initializer
        markers.push({ id, fallback: fallback.text, start: node.getStart(source), end: node.getEnd(), fallbackInitializer: { start: initializer.getStart(source), end: initializer.getEnd() } })
      }
    }
    node.forEachChild(visit)
  }
  visit(source)
  return { markers, invalid }
}

export function ensureRuntimeImports(sourceText: string, fileName: string, specifier: string, required: string[]): string {
  const source = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, /\.(tsx|jsx)$/i.test(fileName) ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const declarations = source.statements.filter(ts.isImportDeclaration).filter(item => ts.isStringLiteral(item.moduleSpecifier) && item.moduleSpecifier.text === specifier)
  const present = new Set(declarations.flatMap(item => item.importClause?.namedBindings && ts.isNamedImports(item.importClause.namedBindings)
    ? item.importClause.namedBindings.elements.map(element => element.propertyName?.text ?? element.name.text)
    : []))
  const missing = [...new Set(required)].filter(name => !present.has(name))
  if (!missing.length) return sourceText

  const named = declarations.find(item => item.importClause?.namedBindings && ts.isNamedImports(item.importClause.namedBindings))
  if (named?.importClause?.namedBindings && ts.isNamedImports(named.importClause.namedBindings)) {
    const bindings = named.importClause.namedBindings
    const insertion = bindings.getEnd() - 1
    const prefix = bindings.elements.length ? ', ' : ''
    return sourceText.slice(0, insertion) + `${prefix}${missing.join(', ')}` + sourceText.slice(insertion)
  }

  const statement = `import { ${missing.join(', ')} } from ${JSON.stringify(specifier)};`
  let directiveEnd: number | undefined
  for (const item of source.statements) {
    if (!ts.isExpressionStatement(item) || !ts.isStringLiteral(item.expression)) break
    directiveEnd = item.getEnd()
  }
  const firstAfterDirectives = source.statements.find(item => item.getStart(source) >= (directiveEnd ?? 0))
  const insertion = firstAfterDirectives?.getStart(source) ?? sourceText.length
  return sourceText.slice(0, insertion) + `${statement}\n` + sourceText.slice(insertion)
}

export function removeRuntimeImports(sourceText: string, fileName: string, specifier: string, names: string[]): string {
  const source = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, /\.(tsx|jsx)$/i.test(fileName) ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const removals: Array<{ start: number; end: number; text: string }> = []
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || statement.moduleSpecifier.text !== specifier) continue
    const bindings = statement.importClause?.namedBindings
    if (!bindings || !ts.isNamedImports(bindings)) continue
    const kept = bindings.elements.filter(element => !names.includes(element.propertyName?.text ?? element.name.text))
    if (kept.length === bindings.elements.length) continue
    if (kept.length === 0 && !statement.importClause?.name) {
      const lineBreak = sourceText.startsWith('\r\n', statement.getEnd()) ? 2 : sourceText[statement.getEnd()] === '\n' ? 1 : 0
      removals.push({ start: statement.getStart(source), end: statement.getEnd() + lineBreak, text: '' })
      continue
    }
    const text = `{ ${kept.map(element => element.getText(source)).join(', ')} }`
    removals.push({ start: bindings.getStart(source), end: bindings.getEnd(), text })
  }
  let result = sourceText
  for (const edit of removals.sort((left, right) => right.start - left.start)) result = result.slice(0, edit.start) + edit.text + result.slice(edit.end)
  return result
}
