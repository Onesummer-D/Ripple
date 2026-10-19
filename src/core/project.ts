import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import ts from 'typescript'
import type { ProjectRevision, Relation, RuntimeElementObservation, RuntimeSourceMap, SourceGraph, SourceNode } from './model'
import { findPageOverrideMarkers, readPageOverrideRegistry } from './page-overrides'

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

export function trackedProjectFiles(root: string): string[] { return trackedFiles(gitRoot(root)) }

export function isProjectWorkingTreeClean(input: string): boolean {
  return runGit(gitRoot(input), ['status', '--porcelain', '--untracked-files=normal']) === ''
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
  for (const relative of [...new Set(files)].sort((left, right) => left.localeCompare(right, 'en'))) {
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
  if (requireClean && !isProjectWorkingTreeClean(root)) {
    throw new ProjectReadError('项目工作树不干净；先提交或收起现有改动，再创建候选')
  }
  const files = trackedFiles(root).filter(file => fs.existsSync(path.join(root, file)))
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
const jsxTagName = (node: ts.JsxOpeningLikeElement): { name: string; namespace?: string } | undefined => {
  if (ts.isIdentifier(node.tagName)) return { name: node.tagName.text }
  // `<Cards.ProductCard />` — a namespace-qualified tag is only resolvable when the
  // qualifier is a namespace import (`import * as Cards`). Returning the qualifier
  // keeps the usage visible instead of silently dropping the consumer (P1-1).
  if (ts.isPropertyAccessExpression(node.tagName) && ts.isIdentifier(node.tagName.expression)) {
    return { name: node.tagName.name.text, namespace: node.tagName.expression.text }
  }
  return undefined
}
const propertyName = (property: ts.ObjectLiteralElementLike) => property.name && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) || ts.isNumericLiteral(property.name)) ? property.name.text : undefined
const stringValue = (node: ts.Node | undefined): ts.StringLiteral | ts.NoSubstitutionTemplateLiteral | undefined => {
  if (!node) return undefined
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node
  if (ts.isJsxExpression(node) && node.expression && (ts.isStringLiteral(node.expression) || ts.isNoSubstitutionTemplateLiteral(node.expression))) return node.expression
  return undefined
}
const imageLike = (value: string) => /(?:\.(?:avif|gif|jpe?g|png|svg|webp)(?:[?#].*)?$|^https?:\/\/[^\s]+(?:images|photos|pexels)[^\s]*|^data:image\/)/i.test(value)
const assetFileLike = (file: string) => /\.(avif|gif|jpe?g|png|svg|webp)$/i.test(file)

type DrilledProperty = { kind: 'value'; text: string } | { kind: 'asset'; assetFile: string }

const IMAGE_PROPERTY = /^(src|srcSet|image|cover|poster|thumbnail|heroImage|avatar)$/i

/** Values of `property` across object literals in an array literal (bounded, syntactic only).
 *  Identifier initializers are resolved through `resolveAsset` (imported-image bindings).
 *  Conservative by design: literals containing a spread, or a duplicated property key, are
 *  skipped — their runtime value cannot be proven from syntax alone. */
/** Drilled value of ONE object literal element for `property`, with the same soundness
 *  rules as the array-wide scan: spread / duplicated key / non-literal → undefined. */
function objectLiteralPropertyValue(element: ts.ObjectLiteralExpression, property: string, resolveAsset: (name: string, sourceFile: ts.SourceFile) => string | undefined): DrilledProperty | undefined {
  if (element.properties.some(ts.isSpreadAssignment)) return undefined
  const byName = new Map<string, ts.PropertyAssignment[]>()
  for (const entry of element.properties) {
    if (!ts.isPropertyAssignment(entry)) continue
    const name = propertyName(entry)
    if (!name) continue
    if (!byName.has(name)) byName.set(name, [])
    byName.get(name)!.push(entry)
  }
  const entries = byName.get(property)
  // Duplicated key: runtime keeps the last value but provenance of which is "live" is
  // not ours to guess — skip rather than emit a possibly-dead edge.
  if (!entries || entries.length !== 1) return undefined
  const initializer = entries[0].initializer
  const literal = stringValue(initializer)
  if (literal) return { kind: 'value', text: literal.text }
  if (initializer && ts.isIdentifier(initializer)) {
    const assetFile = resolveAsset(initializer.text, element.getSourceFile())
    if (assetFile) return { kind: 'asset', assetFile }
  }
  return undefined
}

/** In-place mutating array methods. A reference to the drilled binding on the receiver
 *  side of one of these calls makes every literal element value unreliable. */
const MUTATING_ARRAY_METHODS = new Set(['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill', 'copyWithin'])

/** True when `identifier` (a reference to the drilled array binding) sits at a mutation
 *  site: `arr[i] = x`, any compound assignment, `++`/`--`, `delete arr[i]`, or a call to
 *  an in-place array method (`arr.push(...)`, `arr.sort()`). Purely syntactic. */
function isArrayMutationReference(identifier: ts.Identifier): boolean {
  let current: ts.Node = identifier
  for (;;) {
    const parent = current.parent
    if (ts.isPropertyAccessExpression(parent) && (parent.expression === current || parent.name === current)) { current = parent; continue }
    if (ts.isElementAccessExpression(parent) && parent.expression === current) { current = parent; continue }
    break
  }
  if (ts.isPropertyAccessExpression(current) && ts.isCallExpression(current.parent) && current.parent.expression === current &&
      MUTATING_ARRAY_METHODS.has(current.name.text)) return true
  if (ts.isBinaryExpression(current.parent) && current.parent.left === current &&
      current.parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && current.parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment) return true
  if ((ts.isPrefixUnaryExpression(current.parent) || ts.isPostfixUnaryExpression(current.parent)) && current.parent.operand === current) return true
  if (ts.isDeleteExpression(current.parent)) return true
  return false
}

/** Resolves the array-literal element expressions that can reach a drilled access,
 *  applying map/filter/slice chain semantics precisely. Returns undefined when the shape
 *  is outside the supported boundary — callers must fail closed and never upgrade a
 *  guessed subset.
 * Soundness rules: only `const` declarations are drilled (a reassigned `let` makes the
 *  initializer value non-provable); a conditional must have BOTH arms resolvable; a `const`
 *  array mutated anywhere in the project (`arr.push(...)`, `arr[i] = x`, cross-file
 *  included) yields nothing via `bindingMayBeMutated`; `map` must be an identity callback;
 *  `filter` predicates and `slice` bounds are evaluated syntactically — unsupported forms
 *  fail closed instead of assuming the whole base array is consumed. */
function drillableElements(expression: ts.Expression, checker: ts.TypeChecker, visited: Set<ts.Node>, bindingMayBeMutated: (symbol: ts.Symbol) => boolean): ts.Expression[] | undefined {
  if (visited.has(expression)) return undefined
  visited.add(expression)
  if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression)) return drillableElements(expression.expression, checker, visited, bindingMayBeMutated)
  if (ts.isConditionalExpression(expression)) {
    // Only when BOTH arms resolve do we know the element set regardless of runtime branch.
    const whenTrue = drillableElements(expression.whenTrue, checker, visited, bindingMayBeMutated)
    const whenFalse = drillableElements(expression.whenFalse, checker, visited, bindingMayBeMutated)
    if (!whenTrue || !whenFalse) return undefined
    return [...whenTrue, ...whenFalse]
  }
  if (ts.isIdentifier(expression) || ts.isPropertyAccessExpression(expression)) {
    const symbol = checker.getSymbolAtLocation(ts.isIdentifier(expression) ? expression : expression.name)
    // Export aliases (`export const products`) carry no valueDeclaration on the alias symbol.
    const declaration = symbol?.valueDeclaration
      ?? ((symbol?.flags ?? 0) & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol!).valueDeclaration : undefined)
      ?? symbol?.declarations?.find(ts.isVariableDeclaration)
    if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer) {
      // A non-const declaration may be reassigned after initialization; the initializer's
      // literals are then not the runtime values. Fail closed. (`const` lives on the
      // VariableDeclarationList, so check both levels defensively.)
      const constFlag = (declaration.flags | (ts.isVariableDeclarationList(declaration.parent) ? declaration.parent.flags : 0)) & ts.NodeFlags.Const
      if (!constFlag) return undefined
      // Mutated const array: literal elements are not the runtime values. Fail closed.
      if (symbol && bindingMayBeMutated(symbol)) return undefined
      return drillableElements(declaration.initializer, checker, visited, bindingMayBeMutated)
    }
    if (declaration && ts.isParameter(declaration)) {
      // The callback parameter IS the base element (usage JSX passes it unchanged);
      // the callback body shape is irrelevant on this path.
      let fn: ts.Node | undefined = declaration.parent
      while (fn && !(ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))) fn = fn.parent
      let call: ts.Node | undefined = fn?.parent
      while (call && !ts.isCallExpression(call)) call = call.parent
      if (call && ts.isCallExpression(call) && ts.isPropertyAccessExpression(call.expression) &&
        ['map', 'filter', 'slice'].includes(call.expression.name.text) && call.expression.expression) {
        return drillableElements(call.expression.expression, checker, visited, bindingMayBeMutated)
      }
    }
    return undefined
  }
  if (ts.isArrayLiteralExpression(expression)) return [...expression.elements]
  if (ts.isCallExpression(expression) && ts.isPropertyAccessExpression(expression.expression)) {
    const method = expression.expression.name.text
    if (method !== 'map' && method !== 'filter' && method !== 'slice') return undefined
    // `map` may transform elements (`xs.map(p => ({ ...p, image: newUrl }))`): unless the
    // callback returns its own parameter unchanged, the drilled values are NOT the base
    // array's — the callback body is never inspected, so fail closed.
    if (method === 'map' && !isIdentityMapCallback(expression.arguments[0])) return undefined
    const base = drillableElements(expression.expression.expression, checker, visited, bindingMayBeMutated)
    if (!base) return undefined
    if (method === 'map') return base
    if (method === 'slice') {
      // Only literal bounds are provable; `slice(count)` etc. fail closed.
      const clamp = (n: number) => {
        const truncated = Math.trunc(n)
        return truncated < 0 ? Math.max(base.length + truncated, 0) : Math.min(truncated, base.length)
      }
      let start = 0
      let end = base.length
      const arg0 = expression.arguments[0]
      if (arg0 !== undefined) {
        if (!ts.isNumericLiteral(arg0)) return undefined
        start = clamp(Number(arg0.text))
      }
      const arg1 = expression.arguments[1]
      if (arg1 !== undefined) {
        if (!ts.isNumericLiteral(arg1)) return undefined
        end = clamp(Number(arg1.text))
      }
      return base.slice(start, end)
    }
    // filter: the predicate decides per element. Elements it provably keeps are
    // drillable; a predicate we cannot evaluate voids the whole chain — assuming the
    // full base array would mark never-rendered media as proven.
    const kept: ts.Expression[] = []
    for (const element of base) {
      const keep = filterKeepsElement(expression.arguments[0], element)
      if (keep === undefined) return undefined
      if (keep) kept.push(element)
    }
    return kept
  }
  return undefined
}

/** Extracts the single effective return expression of a callback (`p => expr`,
 *  `(p) => (expr)`, `function (p) { return expr }`). */
function callbackReturnExpression(callback: ts.Expression | undefined): ts.Expression | undefined {
  if (!callback || !(ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))) return undefined
  if (ts.isArrowFunction(callback) && !ts.isBlock(callback.body)) return callback.body
  if (ts.isBlock(callback.body) && callback.body.statements.length === 1) {
    const statement = callback.body.statements[0]
    if (ts.isReturnStatement(statement)) return statement.expression
  }
  return undefined
}

/** True only for a callback that returns its own first parameter unchanged (`p => p`,
 *  `(p) => (p)`, `function (p) { return p }`). Any other map callback may transform
 *  elements, so drilled values cannot be taken from the base array. */
function isIdentityMapCallback(callback: ts.Expression | undefined): boolean {
  const paramName = callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) && ts.isIdentifier(callback.parameters[0]?.name) ? callback.parameters[0].name.text : undefined
  if (!paramName) return false
  const isParam = (expression: ts.Expression | undefined): boolean =>
    !!expression && (ts.isParenthesizedExpression(expression) ? isParam(expression.expression) : ts.isIdentifier(expression) && expression.text === paramName)
  return isParam(callbackReturnExpression(callback))
}

/** Unique string/number literal text of `key` on an object literal element. */
function literalPropertyText(element: ts.Expression, key: string): string | undefined {
  if (!ts.isObjectLiteralExpression(element)) return undefined
  const matches = element.properties.filter((entry): entry is ts.PropertyAssignment => ts.isPropertyAssignment(entry) && propertyName(entry) === key)
  if (matches.length !== 1) return undefined
  const initializer = matches[0].initializer
  return ts.isStringLiteral(initializer) || ts.isNumericLiteral(initializer) || ts.isNoSubstitutionTemplateLiteral(initializer) ? initializer.text : undefined
}

function predicateKeyOperand(node: ts.Expression, paramName: string): string | undefined {
  if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === paramName) return node.name.text
  if (ts.isElementAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === paramName && node.argumentExpression && ts.isStringLiteral(node.argumentExpression)) return node.argumentExpression.text
  return undefined
}

function referencesIdentifier(node: ts.Node, name: string): boolean {
  let found = false
  const visit = (child: ts.Node): void => {
    if (found) return
    if (ts.isIdentifier(child) && child.text === name) { found = true; return }
    child.forEachChild(visit)
  }
  visit(node)
  return found
}

const EQUALITY_OPERATORS = [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken]

/** Evaluates a filter predicate against one literal element, or undefined when the
 *  predicate is outside the supported boundary (fail closed). Supported: single
 *  comparisons `p.key === 'lit'` / `!==` / `==` / `!=` (with `&&` chains and leading
 *  `!`), and constant `true`/`false` predicates. Anything else → undefined. */
function filterKeepsElement(predicate: ts.Expression | undefined, element: ts.Expression): boolean | undefined {
  if (!predicate || !(ts.isArrowFunction(predicate) || ts.isFunctionExpression(predicate))) return undefined
  const paramName = ts.isIdentifier(predicate.parameters[0]?.name) ? predicate.parameters[0].name.text : undefined
  const condition = callbackReturnExpression(predicate)
  if (!condition) return undefined
  const literalText = (node: ts.Expression): string | undefined =>
    ts.isStringLiteral(node) || ts.isNumericLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : undefined
  const evaluate = (node: ts.Expression): boolean | undefined => {
    if (ts.isParenthesizedExpression(node)) return evaluate(node.expression)
    if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) {
      const inner = evaluate(node.operand)
      return inner === undefined ? undefined : !inner
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      const left = evaluate(node.left)
      const right = evaluate(node.right)
      return left === undefined || right === undefined ? undefined : left && right
    }
    if (ts.isBinaryExpression(node) && EQUALITY_OPERATORS.includes(node.operatorToken.kind) && paramName) {
      const key = predicateKeyOperand(node.left, paramName) ?? predicateKeyOperand(node.right, paramName)
      const literal = literalText(node.left) !== undefined && predicateKeyOperand(node.left, paramName) === undefined ? literalText(node.left) : literalText(node.right)
      if (!key || literal === undefined) return undefined
      const actual = literalPropertyText(element, key)
      if (actual === undefined) return undefined
      const negated = node.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken || node.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsToken
      return negated ? actual !== literal : actual === literal
    }
    // Constant predicate without a param reference (`() => true` keeps everything).
    if ((paramName === undefined || !referencesIdentifier(node, paramName)) && !ts.isBinaryExpression(node)) {
      if (node.kind === ts.SyntaxKind.TrueKeyword) return true
      if (node.kind === ts.SyntaxKind.FalseKeyword) return false
    }
    return undefined
  }
  return evaluate(condition)
}

/**
 * Bounded backward drill from a JSX attribute / callback expression to the string
 * literal values (or imported asset files) of `property`, through identifiers bound
 * to array literals and map/filter/slice chains, with the chain semantics applied
 * precisely (see drillableElements). Yields [] whenever the element set cannot be
 * proven — the caller keeps the honest lower-certainty result instead of guessing.
 * Strict subset rule: any element that is not an object literal with exactly one
 * resolvable `property` value voids the WHOLE drill — a resolvable subset must never
 * be upgraded, because unresolved elements may carry real consumers.
 */
function arrayDrill(expression: ts.Expression, property: string, checker: ts.TypeChecker, visited: Set<ts.Node>, resolveAsset: (name: string, sourceFile: ts.SourceFile) => string | undefined, bindingMayBeMutated: (symbol: ts.Symbol) => boolean): DrilledProperty[] {
  const elements = drillableElements(expression, checker, visited, bindingMayBeMutated)
  if (!elements) return []
  const values: DrilledProperty[] = []
  for (const element of elements) {
    if (!ts.isObjectLiteralExpression(element)) return []
    const value = objectLiteralPropertyValue(element, property, resolveAsset)
    if (!value) return []
    values.push(value)
  }
  return values
}

/** Exact `array[n]` resolution, sound only when the base identifier is a `const` array
 *  literal (same const-only guard as arrayDrill; index alignment comes from reading
 *  element n directly, so unresolvable SIBLING elements cannot shift positions). The
 *  same mutation guard applies: a `const` array mutated anywhere in the project is not
 *  drillable. Returns undefined whenever the element cannot be proven — the caller then
 *  stays unproven. */
function arrayLiteralPropertyValueAt(expression: ts.Identifier, index: number, property: string, checker: ts.TypeChecker, resolveAsset: (name: string, sourceFile: ts.SourceFile) => string | undefined, bindingMayBeMutated: (symbol: ts.Symbol) => boolean): DrilledProperty | undefined {
  const symbol = checker.getSymbolAtLocation(expression)
  const declaration = symbol?.valueDeclaration
    ?? ((symbol?.flags ?? 0) & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol!).valueDeclaration : undefined)
    ?? symbol?.declarations?.find(ts.isVariableDeclaration)
  if (!declaration || !ts.isVariableDeclaration(declaration) || !declaration.initializer) return undefined
  const constFlag = (declaration.flags | (ts.isVariableDeclarationList(declaration.parent) ? declaration.parent.flags : 0)) & ts.NodeFlags.Const
  if (!constFlag) return undefined
  if (symbol && bindingMayBeMutated(symbol)) return undefined
  let initializer: ts.Expression = declaration.initializer
  if (ts.isAsExpression(initializer) || ts.isSatisfiesExpression(initializer)) initializer = initializer.expression
  if (ts.isParenthesizedExpression(initializer)) initializer = initializer.expression
  if (!ts.isArrayLiteralExpression(initializer)) return undefined
  const element = initializer.elements[index]
  if (!element || !ts.isObjectLiteralExpression(element)) return undefined
  return objectLiteralPropertyValue(element, property, resolveAsset)
}

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
          (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer) ||
           // `const ScrollBar = React.forwardRef<Props, Ref>(...)` — shadcn/ui's dominant
           // component shape; the JSX lives in the forwardRef callback.
           (ts.isCallExpression(node.initializer) && ts.isPropertyAccessExpression(node.initializer.expression) && node.initializer.expression.name.text === 'forwardRef'))) add(node.name.text, node)
      node.forEachChild(visit)
    }
    visit(source)
  }
  return result
}

function declarationComponentName(tag: { name: string; namespace?: string } | undefined, localImports: Map<string, ImportTarget>, byExport: Map<string, ComponentInfo>, currentFile: string): ComponentInfo | undefined {
  if (!tag) return undefined
  if (tag.namespace) {
    const target = localImports.get(tag.namespace)
    return target?.exportName === '*' ? byExport.get(`${target.file}#${tag.name}`) : undefined
  }
  const target = localImports.get(tag.name)
  if (target) return byExport.get(`${target.file}#${target.exportName}`)
  // Same-file composition (`<ScrollBar />` used in the file that defines it) has no
  // import to route through — fall back to a same-file component lookup.
  return byExport.get(`${currentFile}#${tag.name}`)
}

export function analyzeProject(input: string, requireClean = true): SourceGraph {
  const snapshot = readProjectSnapshot(input, requireClean)
  const overrideRegistry = readPageOverrideRegistry(snapshot.root)
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

  // Fail-closed guard shared by the numeric-index and array-wide drills: even a `const`
  // array can be mutated after its literal initializer, in ANY file of the project
  // (`items.push(...)`, `items[i] = x`, `delete items[i]`, cross-file mutations included).
  // When any reference to the binding resolves to the same declaration and sits at a
  // mutation site, the literal elements are not provably the runtime values and every
  // drill on this binding must stay unproven. Cached per symbol.
  const mutationCache = new Map<ts.Symbol, boolean>()
  const bindingMayBeMutated = (symbol: ts.Symbol): boolean => {
    const target = (symbol.flags & ts.SymbolFlags.Alias) ? checker.getAliasedSymbol(symbol) : symbol
    const cached = mutationCache.get(target)
    if (cached !== undefined) return cached
    const declarations = target.declarations ?? []
    // Follow const-alias indirection: `const reversed = products; reversed.reverse()`
    // mutates the same array, but the mutation reference resolves to the ALIAS
    // declaration, not the drilled binding's. Chase identifier initializers (including
    // array-destructuring bindings like `const [first] = products`, which aliases the
    // element objects) up to a few hops.
    const resolvesToTarget = (sym: ts.Symbol | undefined, depth: number): boolean => {
      if (!sym || depth > 4) return false
      const resolved = (sym.flags & ts.SymbolFlags.Alias) ? checker.getAliasedSymbol(sym) : sym
      if ((resolved.declarations ?? []).some(d => declarations.includes(d))) return true
      for (const d of resolved.declarations ?? []) {
        let aliasSource: ts.Identifier | undefined
        if (ts.isVariableDeclaration(d) && d.initializer && ts.isIdentifier(d.initializer)) aliasSource = d.initializer
        else if (ts.isBindingElement(d)) {
          let variable: ts.Node | undefined = d.parent
          while (variable && !ts.isVariableDeclaration(variable)) variable = variable.parent
          if (variable && ts.isVariableDeclaration(variable) && variable.initializer && ts.isIdentifier(variable.initializer)) aliasSource = variable.initializer
        }
        if (aliasSource && resolvesToTarget(checker.getSymbolAtLocation(aliasSource), depth + 1)) return true
      }
      return false
    }
    let mutated = false
    for (const source of sourceFiles.values()) {
      const visit = (node: ts.Node): void => {
        if (mutated || !declarations.length) return
        // Cheap syntactic shape first: symbol resolution only runs at mutation-shaped sites.
        if (ts.isIdentifier(node) && isArrayMutationReference(node)) {
          const at = checker.getSymbolAtLocation(node)
          if (at && resolvesToTarget(at, 0)) mutated = true
        }
        node.forEachChild(visit)
      }
      visit(source)
      if (mutated) break
    }
    mutationCache.set(target, mutated)
    return mutated
  }

  const nodes: SourceNode[] = []
  const edges: Relation[] = []
  const unresolved: string[] = []
  const nodeById = new Map<string, SourceNode>()
  const addNode = (node: SourceNode) => { if (!nodeById.has(node.id)) { nodes.push(node); nodeById.set(node.id, node) } }
  const addEdge = (from: string, to: string, kind: Relation['kind'], id: string, certainty: Relation['certainty'] = 'source-proven') => {
    edges.push({ id, from, to, kind, certainty, evidenceRefs: [] })
  }

  const overrideMarkers = new Map<string, Array<{ path: string; fallback: string; start: number; end: number }>>()
  const overrideMarkersByLocation = new Map<string, { id: string; fallback: string }>()
  for (const [absolute, source] of sourceFiles) {
    const file = relativeTo(snapshot.root, absolute)
    const found = findPageOverrideMarkers(source.text, file)
    for (const invalid of found.invalid) unresolved.push(invalid)
    for (const marker of found.markers) {
      const matches = overrideMarkers.get(marker.id) ?? []
      matches.push({ path: file, fallback: marker.fallback, start: marker.start, end: marker.end })
      overrideMarkers.set(marker.id, matches)
      overrideMarkersByLocation.set(`${file}#${marker.start}`, { id: marker.id, fallback: marker.fallback })
    }
  }
  const validOverrideTargets = new Set<string>()
  for (const [id, metadata] of Object.entries(overrideRegistry.targets)) {
    const matches = overrideMarkers.get(id) ?? []
    if (matches.length !== 1) {
      unresolved.push(matches.length ? `页面覆盖目标 ${id} 在源码中出现多次，无法唯一映射` : `页面覆盖目标 ${id} 已失去源码标记，规则待确认`)
    } else if (matches[0].fallback !== metadata.original) {
      unresolved.push(`页面覆盖目标 ${id} 的共享来源已变化，规则待确认`)
    } else validOverrideTargets.add(id)
  }
  for (const id of overrideMarkers.keys()) {
    if (!(id in overrideRegistry.targets)) unresolved.push(`源码标记 ${id} 没有对应的页面覆盖注册记录`)
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
  const mediaByValue = new Map<string, SourceNode[]>()
  const assetMediaId = (assetFile: string) => `media:${assetFile}#asset`
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
      if (!mediaByValue.has(literal.text)) mediaByValue.set(literal.text, [])
      mediaByValue.get(literal.text)!.push(media)
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
  // Two phases on purpose: index ALL definitions across every stylesheet first, then
  // resolve var() uses against the complete index. A per-file loop makes uses-token
  // edges depend on tracked-file ordering (card.css before theme.css loses the edge);
  // duplicate definitions stay unresolved via the single-definition guard.
  const cssFiles = snapshot.trackedFiles.filter(candidate => /\.css$/i.test(candidate))
  for (const file of cssFiles) {
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
  }
  for (const file of cssFiles) {
    const absolute = path.join(snapshot.root, file)
    if (fs.lstatSync(absolute).isSymbolicLink()) continue
    const css = fs.readFileSync(absolute, 'utf8')
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

  // Imported image assets (e.g. `import hero from './assets/hero.jpg'`): one media node per
  // asset file, plus per-file binding names for identifier provenance. Asset-backed media has
  // no source offsets — editing it is an asset-swap candidate, not a literal replacement.
  const assetImportBindings = new Map<string, Map<string, string>>()
  const componentUsages: Array<{ targetId: string; ownerId: string; element: ts.JsxOpeningLikeElement; source: ts.SourceFile; file: string }> = []
  const pendingDrills: Array<{ ownerId: string; paramName: string; property: string; position: number; file: string }> = []
  for (const [absolute, source] of sourceFiles) {
    const relative = relativeTo(snapshot.root, absolute)
    const imports = new Map<string, ImportTarget>()
    const importedModules = new Map<string, string>()
    // Names bound by ANY import declaration in this file, including external/untracked
    // modules. Used to distinguish "imported external component" from "locally aliased or
    // undeclared tag" when deciding whether an unresolvable JSX tag must be recorded.
    const importedNames = new Set<string>()
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
      const importClause = statement.importClause
      if (importClause?.name) importedNames.add(importClause.name.text)
      if (importClause?.namedBindings && ts.isNamedImports(importClause.namedBindings)) {
        for (const item of importClause.namedBindings.elements) importedNames.add(item.name.text)
      }
      if (importClause?.namedBindings && ts.isNamespaceImport(importClause.namedBindings)) importedNames.add(importClause.namedBindings.name.text)
      const specifier = statement.moduleSpecifier.text
      const scriptResolved = ts.resolveModuleName(specifier, absolute, compilerOptions, ts.sys).resolvedModule?.resolvedFileName
      const cssResolved = /\.css$/i.test(specifier) ? path.resolve(path.dirname(absolute), specifier) : undefined
      // Alias resolution for asset specifiers the type checker refuses to resolve (e.g.
      // `.jpg` imports): honor a declared `@/*` paths mapping when present, else the Vite
      // convention `@/ → <root>/src` (evidence: Lovable TanStack Start declares paths
      // `@/* → ./src/*` yet ts.resolveModuleName still fails on image files).
      const declaredPaths = compilerOptions.paths ? Object.entries(compilerOptions.paths) : []
      const aliasMapping = declaredPaths.find(([pattern]) => pattern === '@/*')
      const aliasResolved = specifier.startsWith('@/')
        ? aliasMapping
          ? path.resolve(snapshot.root, aliasMapping[1][0].replace(/\*$/, ''), specifier.slice(2))
          : path.resolve(snapshot.root, 'src', specifier.slice(2))
        : undefined
      const resolved = scriptResolved ?? (cssResolved && tracked.has(normalize(cssResolved)) ? cssResolved : undefined)
        ?? (aliasResolved && tracked.has(normalize(aliasResolved)) ? aliasResolved : undefined)
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
      if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
        // `import * as Cards` — exportName '*' marks a namespace target so
        // `<Cards.ProductCard />` tags resolve in declarationComponentName.
        imports.set(clause.namedBindings.name.text, { file: targetFile, exportName: '*' })
      }
      addEdge(`file:${relative}`, `file:${targetFile}`, 'imports', `import:${relative}:${statement.getStart()}`)
      if (assetFileLike(targetFile)) {
        const id = assetMediaId(targetFile)
        if (!nodeById.has(id)) {
          addNode({ id, kind: 'media', label: path.basename(targetFile), value: targetFile, location: { path: targetFile } })
          mediaByValue.set(targetFile, [nodeById.get(id)!])
        }
        if (!assetImportBindings.has(relative)) assetImportBindings.set(relative, new Map())
        if (clause?.name) assetImportBindings.get(relative)!.set(clause.name.text, targetFile)
        if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
          for (const item of clause.namedBindings.elements) assetImportBindings.get(relative)!.set(item.name.text, targetFile)
        }
      }
    }
    const owner = components.filter(component => component.file === relative)
    const visit = (node: ts.Node) => {
      const ownerComponent = owner.find(component => component.node.pos <= node.pos && component.node.end >= node.end)
      if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && ts.isIdentifier(node.tagName) && node.tagName.text === 'RippleText') {
        const marker = overrideMarkersByLocation.get(`${relative}#${node.getStart(source)}`)
        if (marker && validOverrideTargets.has(marker.id)) {
          const sourceNode: SourceNode = {
            id: marker.id,
            kind: 'data',
            label: marker.fallback.trim(),
            value: marker.fallback,
            location: { path: relative, start: node.getStart(source), end: node.getEnd() },
            pageOverrides: Object.fromEntries(Object.entries(overrideRegistry.pages).flatMap(([pageRef, values]) => marker.id in values ? [[pageRef, values[marker.id]]] : [])),
          }
          addNode(sourceNode)
          if (ownerComponent) addEdge(ownerComponent.id, sourceNode.id, 'reads', `override-target:${sourceNode.id}:${ownerComponent.id}`)
        }
      }
      if (ownerComponent && ts.isPropertyAccessExpression(node)) {
        const symbol = checker.getSymbolAtLocation(node.name)
        const declaration = symbol?.valueDeclaration
        const literal = declaration && ts.isPropertyAssignment(declaration) ? stringValue(declaration.initializer) : undefined
        let linked = false
        if (literal && imageLike(literal.text)) {
          const sourcePath = relativeTo(snapshot.root, declaration!.getSourceFile().fileName)
          const media = mediaBySource.get(`${sourcePath}#${literal.getStart(declaration!.getSourceFile()) + 1}`)
          // Same uniqueness rule as the drilling post-pass: upgrading requires that the value
          // identifies exactly one media node; otherwise the edge stays a semantic candidate.
          const unique = (mediaByValue.get(literal.text) ?? []).length === 1
          if (media && unique) {
            addEdge(ownerComponent.id, media.id, 'asset-consumer', `asset:${ownerComponent.id}:${media.id}:${node.getStart(source)}`)
            linked = true
          }
        }
        // Provenance 1: property bound to an imported image asset (e.g. `image: item1`
        // where `import item1 from '@/assets/item-1.jpg'`). Statically verifiable.
        if (!linked && declaration && ts.isPropertyAssignment(declaration) && declaration.initializer && ts.isIdentifier(declaration.initializer)) {
          const declarationFile = relativeTo(snapshot.root, declaration.getSourceFile().fileName)
          const assetFile = assetImportBindings.get(declarationFile)?.get(declaration.initializer.text)
          if (assetFile && nodeById.has(assetMediaId(assetFile))) {
            addEdge(ownerComponent.id, assetMediaId(assetFile), 'asset-consumer', `asset:${ownerComponent.id}:${assetMediaId(assetFile)}:${node.getStart(source)}`)
            linked = true
          }
        }
        // Provenance 2: prop drilling — `product.image` inside a card component whose
        // `product` prop is fed at usage sites by expressions traceable to array literals
        // (identifier → array literal; `.map`/`.filter`/`.slice` chains). Only exact
        // single matches upgrade to source-proven; ambiguity stays semantic-candidate.
        // Resolved in a post-pass: usage sites in other files may not be visited yet.
        if (!linked) {
          const objectSymbol = checker.getSymbolAtLocation(node.expression)
          const objectDeclaration = objectSymbol?.valueDeclaration
          const paramName = objectDeclaration && (ts.isParameter(objectDeclaration) || ts.isBindingElement(objectDeclaration)) && ts.isIdentifier(objectDeclaration.name)
            ? objectDeclaration.name.text : undefined
          // Only image-bearing props can carry media provenance; queueing every prop access
          // would cost a usage scan per access and strip unrelated name-based candidates.
          if (paramName && IMAGE_PROPERTY.test(node.name.text)) {
            pendingDrills.push({ ownerId: ownerComponent.id, paramName, property: node.name.text, position: node.getStart(source), file: relative })
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
        } else if (node.initializer && ts.isJsxExpression(node.initializer) && node.initializer.expression && ts.isIdentifier(node.initializer.expression)) {
          const assetFile = assetImportBindings.get(relative)?.get(node.initializer.expression.text)
          if (assetFile && nodeById.has(assetMediaId(assetFile))) {
            addEdge(ownerComponent.id, assetMediaId(assetFile), 'asset-consumer', `asset:${ownerComponent.id}:${assetMediaId(assetFile)}:${node.getStart(source)}`)
          }
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
        if (tag && /^[a-z]/.test(tag.name)) {
          const start = node.getStart(source)
          const elementEnd = ts.isJsxOpeningElement(node) && ts.isJsxElement(node.parent) ? node.parent.getEnd() : node.getEnd()
          addNode({ id: nodeId(relative, 'jsx', start), kind: 'jsx-element', label: `<${tag.name}>`, location: { path: relative, start, end: elementEnd }, selector: `[data-ripple-source="jsx:${relative}#${start}"]` })
        }
        const target = declarationComponentName(tag, imports, byExport, relative)
        if (target && ownerComponent) {
          if (!componentRenders.has(ownerComponent.id)) componentRenders.set(ownerComponent.id, new Set())
          componentRenders.get(ownerComponent.id)!.add(target.id)
          addEdge(ownerComponent.id, target.id, 'renders', `render:${ownerComponent.id}:${node.getStart(source)}`)
          componentUsages.push({ targetId: target.id, ownerId: ownerComponent.id, element: node, source, file: relative })
          if (appComponent?.id === ownerComponent.id) appDirect.add(target.id)
        }
        // A capitalized tag that resolves to no component and is not imported at all
        // (local alias `const Card2 = ProductCard`, default-export object carriers, or an
        // undeclared global) is an unknown consumer path: record it so it cannot vanish
        // silently from impact analysis. Imported-but-external components are excluded
        // (their import binding is present in importedNames) — they carry no local
        // drilled props by construction.
        if (tag && !target && /^[A-Z]/.test(tag.name)) {
          const boundName = tag.namespace ?? tag.name
          if (!importedNames.has(boundName)) unresolved.push(`${relative} → unresolvable-component:${tag.namespace ? `${tag.namespace}.` : ''}${tag.name}`)
        }
      }
      if (relative === appComponent?.file && ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
        ts.isIdentifier(node.left) && pageStateNames.has(node.left.text) && ts.isStringLiteral(node.right)) {
        const state = node.right.text
        const targets = new Set<string>()
        const collectTags = (child: ts.Node) => {
          if (ts.isJsxOpeningElement(child) || ts.isJsxSelfClosingElement(child)) {
            const target = declarationComponentName(jsxTagName(child), imports, byExport, relative)
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

  // Post-pass: prop-drilling provenance needs usage sites from every file collected first.
  {
    const resolveAsset = (name: string, sourceFile: ts.SourceFile) => assetImportBindings.get(relativeTo(snapshot.root, sourceFile.fileName))?.get(name)
    const mediaNodeFor = (item: DrilledProperty): SourceNode | undefined => {
      if (item.kind === 'asset') return nodeById.get(assetMediaId(item.assetFile))
      const matches = mediaByValue.get(item.text) ?? []
      return matches.length === 1 ? matches[0] : undefined
    }
    const candidateNodesFor = (item: DrilledProperty): SourceNode[] => {
      if (item.kind === 'asset') {
        const node = nodeById.get(assetMediaId(item.assetFile))
        return node ? [node] : []
      }
      return mediaByValue.get(item.text) ?? []
    }
    for (const drill of pendingDrills) {
      const drilled = new Map<string, DrilledProperty>()
      // Edges are emitted per USAGE SITE (the component whose JSX carries the drilled
      // prop), not per drilled component: a shared component rendered on several routes
      // must not merge bindings — each page's impact closure follows its own usage.
      // Unproven usage sites must NOT vanish either: an invisibly-rendered media would
      // overestimate nothing but hide real consumers, so where the array is syntactically
      // reachable (spread of a map param, element access) we name candidate media, emit
      // semantic-candidate edges, and poison each candidate's declaration file via
      // `unresolved` — scope.ts fails closed whenever that file is in the proven subgraph.
      const unprovenUsageFiles = new Set<string>()
      let sawUsage = false
      for (const usage of componentUsages) {
        if (usage.targetId !== drill.ownerId) continue
        const usagePos = usage.element.getStart(usage.source)
        const emitDrilled = (items: DrilledProperty[]) => {
          const seen = new Set<string>()
          for (const item of items) {
            const key = JSON.stringify(item)
            if (seen.has(key)) continue
            seen.add(key)
            const node = mediaNodeFor(item)
            if (node) {
              addEdge(usage.ownerId, node.id, 'asset-consumer', `asset:${usage.ownerId}:${node.id}:${usagePos}`)
            } else {
              for (const candidate of candidateNodesFor(item)) {
                addEdge(usage.ownerId, candidate.id, 'asset-consumer', `asset-candidate:${usage.ownerId}:${candidate.id}:${usagePos}`, 'semantic-candidate')
              }
            }
          }
        }
        const emitUnproven = (base: ts.Expression) => {
          unprovenUsageFiles.add(usage.file)
          for (const item of arrayDrill(base, drill.property, checker, new Set(), resolveAsset, bindingMayBeMutated)) {
            for (const candidate of candidateNodesFor(item)) {
              addEdge(usage.ownerId, candidate.id, 'asset-consumer', `asset-candidate:${usage.ownerId}:${candidate.id}:${usagePos}`, 'semantic-candidate')
              // Poison the candidate's closure: scope.ts flags unresolved entries whose
              // importer file is in the proven consumer subgraph. The media's declaration
              // file is always reachable from the media itself, so this entry guarantees
              // fail-closed impact for every named candidate.
              if (candidate.location?.path) unresolved.push(`${candidate.location.path} → unproven-usage:${usage.file}`)
            }
          }
        }
        const usageProps = usage.element.attributes.properties
        const attribute = usageProps.find(item => ts.isJsxAttribute(item) && item.name.getText(usage.source) === drill.paramName)
        // A JSX spread AFTER the named attribute can override it at runtime
        // (`product={product} {...overrides}`). The drilled value is then not provably
        // the live one — fail closed: no proven edge, candidates named, usage poisoned.
        const overriddenBySpread = attribute ? usageProps.slice(usageProps.indexOf(attribute) + 1).some(ts.isJsxSpreadAttribute) : false
        const initializer = attribute && ts.isJsxAttribute(attribute) ? attribute.initializer : undefined
        const expression = initializer && ts.isJsxExpression(initializer) ? initializer.expression : undefined
        if (expression && ts.isElementAccessExpression(expression)) {
          // `items[index]`: the member IS passed, but which one is usually unknowable at
          // analysis time. A numeric literal index into a const array literal is the
          // exception — element n is read directly and stays source-proven (unless a
          // later spread overrides the prop or the binding is mutated).
          sawUsage = true
          if (overriddenBySpread) { emitUnproven(expression.expression); continue }
          const numeric = expression.argumentExpression && ts.isNumericLiteral(expression.argumentExpression) ? Number(expression.argumentExpression.text) : undefined
          if (numeric !== undefined && Number.isInteger(numeric) && numeric >= 0 && ts.isIdentifier(expression.expression)) {
            const exact = arrayLiteralPropertyValueAt(expression.expression, numeric, drill.property, checker, resolveAsset, bindingMayBeMutated)
            if (exact) {
              drilled.set(JSON.stringify(exact), exact)
              emitDrilled([exact])
              continue
            }
          }
          emitUnproven(expression.expression)
          continue
        }
        if (expression) {
          sawUsage = true
          if (overriddenBySpread) { emitUnproven(expression); continue }
          const items = arrayDrill(expression, drill.property, checker, new Set(), resolveAsset, bindingMayBeMutated)
          if (items.length) {
            for (const item of items) drilled.set(JSON.stringify(item), item)
            emitDrilled(items)
            continue
          }
          unprovenUsageFiles.add(usage.file)
          continue
        }
        // No named attribute: only a JSX spread can still carry the prop at runtime.
        // A usage without either passes nothing — the component is not a consumer for
        // this drill and must not be recorded as an unknown one.
        if (!usage.element.attributes.properties.some(ts.isJsxSpreadAttribute)) continue
        sawUsage = true
        // Walk up from the JSX element to an enclosing .map/.filter callback parameter.
        let candidateSource: ts.Expression | undefined
        {
          let node: ts.Node | undefined = usage.element
          while (node && !ts.isCallExpression(node)) node = node.parent
          const call = node && ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
            ['map', 'filter', 'slice'].includes(node.expression.name.text) ? node : undefined
          const callback = call?.arguments[0]
          const param = callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) && callback.parameters[0] && ts.isIdentifier(callback.parameters[0].name)
            ? callback.parameters[0].name : undefined
          candidateSource = param
        }
        if (candidateSource) {
          emitUnproven(candidateSource)
        } else {
          unprovenUsageFiles.add(usage.file)
        }
      }
      for (const usageFile of unprovenUsageFiles) unresolved.push(`${usageFile} → unproven-prop:${drill.paramName}`)
      if (!drilled.size && sawUsage) unresolved.push(`${drill.file} → unproven-prop:${drill.paramName}.${drill.property}`)
    }
  }
  void pendingDrills

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

  const endDigest = readProjectSnapshot(snapshot.root, false).revision.sourceDigest
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

export function createRuntimeSourceMap(graph: SourceGraph, observations: RuntimeElementObservation[]): RuntimeSourceMap {
  const nodes = new Map(graph.nodes.filter(node => node.kind === 'jsx-element').map(node => [node.id, node]))
  const ids = new Set<string>()
  for (const observation of observations) {
    if (!nodes.has(observation.sourceRef)) throw new ProjectReadError(`运行时元素引用了未映射的 JSX 源码：${observation.sourceRef}`)
    if (!observation.runtimeInstanceId || ids.has(observation.runtimeInstanceId)) throw new ProjectReadError('运行时实例标识缺失或重复')
    if (observation.certainty === 'unmapped' || observation.certainty === 'unknown') throw new ProjectReadError('未确认映射身份的运行时元素不能进入源码选择')
    ids.add(observation.runtimeInstanceId)
  }
  return { graphId: graph.id, sourceDigest: graph.revision.sourceDigest, runtimeFingerprint: graph.revision.runtimeFingerprint, observations: observations.map(item => ({ ...item })) }
}

export function resolveRuntimeElement(graph: SourceGraph, selection: { sourceRef: string; runtimeInstanceId: string }, runtimeMap: RuntimeSourceMap): { element: SourceNode; runtimeInstanceId: string; editableText: SourceNode[] } {
  if (!selection.runtimeInstanceId || selection.runtimeInstanceId === selection.sourceRef) throw new ProjectReadError('运行时实例标识必须与 JSX 源码锚点分离')
  if (runtimeMap.graphId !== graph.id || runtimeMap.sourceDigest !== graph.revision.sourceDigest || runtimeMap.runtimeFingerprint !== graph.revision.runtimeFingerprint) throw new ProjectReadError('运行时映射不再对应当前源码图或运行环境')
  const observation = runtimeMap.observations.find(item => item.runtimeInstanceId === selection.runtimeInstanceId)
  if (!observation || observation.sourceRef !== selection.sourceRef) throw new ProjectReadError('运行时实例与 JSX 源码锚点的双向映射不匹配')
  if (observation.certainty === 'position-dependent' || observation.certainty === 'unknown') throw new ProjectReadError('列表实例身份不稳定，不能作为精准编辑目标')
  const resolved = resolveJsxSourceElement(graph, selection.sourceRef)
  return { ...resolved, runtimeInstanceId: selection.runtimeInstanceId }
}
