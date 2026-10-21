import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import { builtinModules } from 'node:module'
import * as path from 'node:path'
import ts from 'typescript'
import type { Plugin } from 'vite'
import { resolveProjectConfigGraph, toViteAliasRules } from './project-config-resolver.mjs'

interface Component { node: ts.Node; name: string; ownerId: string; identityId: string; selfRef: string }
type LocalCertainty = 'stable-react-instance' | 'stable-keyed-instance' | 'position-dependent' | 'unknown'
/** How a React key expression relates to the list item it identifies. */
export type KeyStability = 'stable' | 'index' | 'unstable' | 'unverified'
type MapCallback = ts.ArrowFunction | ts.FunctionExpression
type CallbackKeyStatus = 'none' | 'stable' | 'index' | 'unknown'
interface KeyBindings { item: Set<string>; index: Set<string>; local: Set<string> }

const hasJsx = (node: ts.Node): boolean => ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || (node.forEachChild(hasJsx) ?? false)
const componentName = (node: ts.Node): string | undefined => {
  if (ts.isFunctionDeclaration(node)) return node.name?.text
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) return node.name.text
  return undefined
}
const jsxKeyAttribute = (node: ts.JsxOpeningLikeElement, source: ts.SourceFile): ts.JsxAttribute | undefined => {
  const key = node.attributes.properties.find(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(source) === 'key')
  return key && ts.isJsxAttribute(key) ? key : undefined
}
const openingFor = (node: ts.Node): ts.JsxOpeningLikeElement | undefined => ts.isJsxElement(node) ? node.openingElement : ts.isJsxSelfClosingElement(node) ? node : undefined
/** The key's expression, or undefined when there is no key. A key without a usable initializer yields `null`. */
const keyExpressionForNode = (node: ts.Node, source: ts.SourceFile): ts.Expression | null | undefined => {
  const opening = openingFor(node)
  const key = opening ? jsxKeyAttribute(opening, source) : undefined
  if (!key) return undefined
  if (key.initializer && ts.isStringLiteral(key.initializer)) return key.initializer
  return key.initializer && ts.isJsxExpression(key.initializer) && key.initializer.expression ? key.initializer.expression : null
}
const unwrapExpression = (node: ts.Node): ts.Node => {
  let current = node
  while (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isNonNullExpression(current) || ts.isTypeAssertionExpression(current) || ts.isSatisfiesExpression(current)) current = current.expression
  return current
}
const calleeName = (call: ts.CallExpression | ts.NewExpression, source: ts.SourceFile) => call.expression.getText(source).replace(/\s+/g, '')
const UNSTABLE_KEY_CALLEES = /^(?:Math\.random|Date\.now|performance\.now|(?:globalThis\.|window\.|self\.)?crypto\.randomUUID|crypto\.getRandomValues|uuid|uuidv\d|v\d|nanoid|cuid2?|createId|ulid|Symbol|useId|React\.useId)$/
const VALUE_PRESERVING_CALLEES = /^(?:String|Number)$/
const VALUE_PRESERVING_METHODS = new Set(['toString', 'toLowerCase', 'toUpperCase', 'trim'])
const VALUE_BINARY_OPERATORS = new Set([ts.SyntaxKind.PlusToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken])
const COMPONENT_WRAPPER_CALLEES = /^(?:React\.)?(?:memo|forwardRef|createElement)$/

/**
 * Classifies a React key against the item/index bindings of the list callbacks that
 * enclose it. Only keys derived from list item data (or literals outside lists) are
 * `stable`; any index reference is `index`; time/random/id generators are `unstable`;
 * everything else (helper calls, unrelated or callback-local identifiers, constant keys
 * inside a list, booleans/comparisons/lengths) cannot be proven and is `unverified`.
 */
export function classifyKeyExpression(expression: ts.Expression, source: ts.SourceFile, bindings: { item: ReadonlySet<string>; index: ReadonlySet<string>; local?: ReadonlySet<string>; inList: boolean }): KeyStability {
  let unstable = false
  let index = false
  let unverified = false
  let itemReference = false
  const readsItem = (node: ts.Node) => [...identifierNames(node)].some(name => bindings.item.has(name) && !bindings.index.has(name) && !bindings.local?.has(name))
  const visit = (raw: ts.Node): void => {
    const node = unwrapExpression(raw)
    if (ts.isNewExpression(node)) {
      if (/^(?:Date|globalThis\.Date|window\.Date)$/.test(calleeName(node, source))) unstable = true
      else unverified = true
      node.arguments?.forEach(visit)
      return
    }
    if (ts.isCallExpression(node)) {
      const callee = calleeName(node, source)
      if (UNSTABLE_KEY_CALLEES.test(callee)) unstable = true
      else if (VALUE_PRESERVING_CALLEES.test(callee)) node.arguments.forEach(visit)
      else if (ts.isPropertyAccessExpression(node.expression) && VALUE_PRESERVING_METHODS.has(node.expression.name.text) && node.arguments.length === 0) visit(node.expression.expression)
      else { unverified = true; visit(node.expression); node.arguments.forEach(visit) }
      return
    }
    if (ts.isIdentifier(node)) {
      if (bindings.index.has(node.text)) index = true
      // Locals computed inside the list callback may be position-derived
      // (`const position = items.indexOf(item)`) or shadow the item binding.
      else if (bindings.local?.has(node.text)) unverified = true
      else if (bindings.item.has(node.text)) itemReference = true
      return
    }
    if (ts.isPropertyAccessExpression(node)) {
      if (node.name.text === 'length') unverified = true
      visit(node.expression)
      return
    }
    if (ts.isElementAccessExpression(node)) {
      visit(node.expression)
      const argument = unwrapExpression(node.argumentExpression)
      if (!ts.isStringLiteral(argument) && !ts.isNoSubstitutionTemplateLiteral(argument)) { unverified = true; visit(argument) }
      return
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isNumericLiteral(node)) return
    if (ts.isTemplateExpression(node)) { node.templateSpans.forEach(span => visit(span.expression)); return }
    if (ts.isBinaryExpression(node)) {
      const kind = node.operatorToken.kind
      if (!VALUE_BINARY_OPERATORS.has(kind)) unverified = true
      // A fallback branch that ignores the item can hand one key to several rows.
      if (bindings.inList && kind !== ts.SyntaxKind.PlusToken && (!readsItem(node.left) || !readsItem(node.right))) unverified = true
      visit(node.left)
      visit(node.right)
      return
    }
    if (ts.isConditionalExpression(node)) {
      if (bindings.inList && (!readsItem(node.whenTrue) || !readsItem(node.whenFalse))) unverified = true
      visit(node.condition); visit(node.whenTrue); visit(node.whenFalse)
      return
    }
    unverified = true
    node.forEachChild(visit)
  }
  visit(expression)
  if (unstable) return 'unstable'
  if (index) return 'index'
  if (unverified) return 'unverified'
  // Inside a list a key that never reads the item is shared by every row.
  if (bindings.inList && !itemReference) return 'unverified'
  return 'stable'
}

const bindingNames = (name: ts.BindingName, into: Set<string>) => {
  if (ts.isIdentifier(name)) into.add(name.text)
  else for (const element of name.elements) if (!ts.isOmittedExpression(element)) bindingNames(element.name, into)
}
const declaredNamesIn = (scope: ts.Node, into: Set<string>) => {
  const visit = (child: ts.Node) => {
    if (ts.isVariableDeclaration(child)) bindingNames(child.name, into)
    if ((ts.isFunctionDeclaration(child) || ts.isClassDeclaration(child)) && child.name) into.add(child.name.text)
    child.forEachChild(visit)
  }
  visit(scope)
}
const identifierNames = (node: ts.Node, into: Set<string> = new Set()) => {
  if (ts.isIdentifier(node)) into.add(node.text)
  else if (ts.isPropertyAccessExpression(node)) identifierNames(node.expression, into)
  else node.forEachChild(child => { identifierNames(child, into) })
  return into
}
const isFunctionNode = (node: ts.Node): node is ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration | ts.MethodDeclaration =>
  ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)
/** `.map`/`.flatMap`/`Children.map`/`Array.from(x, fn)` callbacks: the second parameter is the list position. */
const isMapLikeCallback = (node: ts.Node): node is MapCallback => {
  if (!(ts.isArrowFunction(node) || ts.isFunctionExpression(node)) || !ts.isCallExpression(node.parent) || !node.parent.arguments.includes(node)) return false
  const callee = node.parent.expression
  if (!ts.isPropertyAccessExpression(callee)) return false
  if (callee.name.text === 'map' || callee.name.text === 'flatMap') return true
  return callee.name.text === 'from' && ts.isIdentifier(callee.expression) && callee.expression.text === 'Array' && node.parent.arguments[1] === node
}
/** Lists of positions (`[...Array(n).keys()]`, `Array.from({ length: n }, ...)`): their "items" are indexes. */
const iteratesPositions = (callback: MapCallback, source: ts.SourceFile): boolean => {
  const callee = (callback.parent as ts.CallExpression).expression as ts.PropertyAccessExpression
  if (callee.name.text === 'from') return /^\{\s*length\s*:/.test((callback.parent as ts.CallExpression).arguments[0]?.getText(source) ?? '')
  const receiver = callee.expression.getText(source).replace(/\s+/g, '')
  return /\.keys\(\)\]?$/.test(receiver) || /^\[\.\.\.(?:new)?Array\(/.test(receiver) || /^(?:new)?Array\(/.test(receiver) || /^Array\.from\(\{length:/.test(receiver)
}
/**
 * The literal initializer of the `const` an identifier resolves to, following lexical scope
 * outward from the reference. Parameters, catch/loop bindings, destructuring, `let`/`var`,
 * functions and classes of that name resolve to nothing (shape unknown).
 */
const constInitializerInScope = (identifier: ts.Identifier): ts.Node | undefined => {
  const name = identifier.text
  const binds = (bindingName: ts.BindingName) => { const names = new Set<string>(); bindingNames(bindingName, names); return names.has(name) }
  // `var` anywhere in a function body (outside nested functions) hoists to that function.
  const hoistedVar = (body: ts.Node): boolean => {
    let found = false
    const visit = (child: ts.Node) => {
      if (found || (child !== body && ts.isFunctionLike(child))) return
      if (ts.isVariableDeclarationList(child) && (child.flags & (ts.NodeFlags.Const | ts.NodeFlags.Let)) === 0 && child.declarations.some(declaration => binds(declaration.name))) { found = true; return }
      child.forEachChild(visit)
    }
    visit(body)
    return found
  }
  for (let scope: ts.Node | undefined = identifier.parent; scope; scope = scope.parent) {
    if (ts.isFunctionLike(scope) && scope.parameters.some(parameter => binds(parameter.name))) return undefined
    if ((ts.isFunctionLike(scope) || ts.isSourceFile(scope)) && hoistedVar(scope)) return undefined
    if (ts.isCatchClause(scope) && scope.variableDeclaration && binds(scope.variableDeclaration.name)) return undefined
    if ((ts.isForStatement(scope) || ts.isForOfStatement(scope) || ts.isForInStatement(scope)) && scope.initializer && ts.isVariableDeclarationList(scope.initializer) &&
      scope.initializer.declarations.some(declaration => binds(declaration.name))) return undefined
    const statements = ts.isBlock(scope) || ts.isSourceFile(scope) || ts.isModuleBlock(scope) || ts.isCaseClause(scope) || ts.isDefaultClause(scope) ? scope.statements : undefined
    if (!statements) continue
    for (const statement of statements) {
      if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name?.text === name) return undefined
      if (!ts.isVariableStatement(statement)) continue
      for (const declaration of statement.declarationList.declarations) {
        if (!binds(declaration.name)) continue
        const constant = (statement.declarationList.flags & ts.NodeFlags.Const) !== 0
        return constant && ts.isIdentifier(declaration.name) && declaration.initializer ? unwrapExpression(declaration.initializer) : undefined
      }
    }
  }
  return undefined
}
/** `items.entries()` / `Array.from(items.entries())`: `[index, item]` pairs (Object.entries is not). */
const entriesOfArray = (callback: MapCallback, source: ts.SourceFile): boolean => {
  const callee = (callback.parent as ts.CallExpression).expression as ts.PropertyAccessExpression
  const receiver = callee.name.text === 'from' ? ((callback.parent as ts.CallExpression).arguments[0]?.getText(source) ?? '') : callee.expression.getText(source)
  const compact = receiver.replace(/\s+/g, '')
  return !/^Object\.entries\(/.test(compact) && (/\.entries\(\)\]?$/.test(compact) || /^Array\.from\(.*\.entries\(\)\)$/.test(compact) || /^\[\.\.\..*\.entries\(\)\]$/.test(compact))
}
/** Functions proven to run exactly once per render of their owner. */
const isSingleCallFunction = (node: ts.Node): boolean => {
  let call: ts.Node = node
  while (ts.isParenthesizedExpression(call.parent)) call = call.parent
  if (ts.isCallExpression(call.parent) && call.parent.expression === call) return true
  if (ts.isCallExpression(node.parent) && node.parent.arguments[0] === node) {
    const callee = node.parent.expression
    const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : ''
    return name === 'useMemo'
  }
  return false
}
const isLoop = (node: ts.Node) => ts.isForStatement(node) || ts.isForOfStatement(node) || ts.isForInStatement(node) || ts.isWhileStatement(node) || ts.isDoStatement(node)
const isLoopBody = (loop: ts.Node, child: ts.Node) => isLoop(loop) && (loop as ts.IterationStatement).statement === child
const enclosingFunction = (node: ts.Node): ts.Node | undefined => {
  let current = node.parent
  while (current && !ts.isFunctionLike(current)) current = current.parent
  return current
}
const runsOnceAtModuleLevel = (node: ts.Node): boolean => {
  for (let current = node.parent; current; current = current.parent) if (ts.isFunctionLike(current) || isLoop(current)) return false
  return true
}
const isHostTag = (tag: string) => /^[a-z]/.test(tag) && !tag.includes('.')
/** `yield`/`await` inside the element (outside nested functions) cannot move into a wrapper arrow. */
const containsSuspension = (node: ts.Node): boolean => {
  if (ts.isYieldExpression(node) || ts.isAwaitExpression(node)) return true
  if (ts.isFunctionLike(node)) return false
  return node.forEachChild(containsSuspension) ?? false
}
const containsJsxOrFunction = (node: ts.Node): boolean =>
  ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node) || ts.isFunctionLike(node) || (node.forEachChild(containsJsxOrFunction) ?? false)
const declaresName = (scope: ts.Node, name: string, except: ts.Node): boolean => {
  let found = false
  const visit = (node: ts.Node) => {
    if (found) return
    if (node !== except && (ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isBindingElement(node))) {
      const names = new Set<string>()
      bindingNames(node.name, names)
      if (names.has(name)) { found = true; return }
    }
    if (node !== except && (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isFunctionExpression(node) || ts.isClassExpression(node)) && node.name?.text === name) { found = true; return }
    node.forEachChild(visit)
  }
  scope.forEachChild(visit)
  return found
}
const isAsyncOrGenerator = (node: ts.Node) => {
  const fn = ts.isVariableDeclaration(node) ? node.initializer : node
  if (!fn || !(ts.isFunctionDeclaration(fn) || ts.isFunctionExpression(fn) || ts.isArrowFunction(fn))) return false
  return !!(fn as ts.FunctionLikeDeclarationBase).asteriskToken || !!ts.getModifiers(fn)?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword)
}

/** Whether an identifier is a value reference (not a declaration name, property name or specifier). */
const isReferenceIdentifier = (node: ts.Identifier): boolean => {
  const parent = node.parent
  if ((ts.isFunctionDeclaration(parent) || ts.isVariableDeclaration(parent) || ts.isClassDeclaration(parent) || ts.isParameter(parent) ||
    ts.isBindingElement(parent) || ts.isFunctionExpression(parent) || ts.isClassExpression(parent)) && parent.name === node) return false
  if (ts.isBindingElement(parent) && parent.propertyName === node) return false
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false
  if ((ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent) || ts.isPropertyDeclaration(parent) || ts.isPropertySignature(parent) ||
    ts.isGetAccessorDeclaration(parent) || ts.isSetAccessorDeclaration(parent) || ts.isEnumMember(parent)) && parent.name === node) return false
  if (ts.isImportSpecifier(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent) || ts.isNamespaceExport(parent)) return false
  if (ts.isExportSpecifier(parent) && (parent.parent.parent.moduleSpecifier || (parent.propertyName && parent.name === node))) return false
  if (ts.isJsxAttribute(parent) && parent.name === node) return false
  if (ts.isLabeledStatement(parent) || ts.isBreakOrContinueStatement(parent)) return false
  return true
}
/**
 * How a reference to a component (identifier or namespace member) is used. Only uses that
 * leave the call to React are benign: JSX tags, memo/forwardRef/createElement, exports,
 * static property assignments and type positions. Everything else lets other code call the
 * function directly, so hooks injected into it could join that caller's hook list.
 */
const referenceUse = (reference: ts.Node, source: ts.SourceFile): 'benign' | 'escaping' => {
  const parent = reference.parent
  if ((ts.isJsxOpeningElement(parent) || ts.isJsxSelfClosingElement(parent) || ts.isJsxClosingElement(parent)) && parent.tagName === reference) return 'benign'
  if (ts.isPropertyAccessExpression(parent) && parent.expression === reference && ts.isBinaryExpression(parent.parent) && parent.parent.left === parent && parent.parent.operatorToken.kind === ts.SyntaxKind.EqualsToken) return 'benign'
  if (ts.isExportSpecifier(parent) || (ts.isExportAssignment(parent) && parent.expression === reference)) return 'benign'
  if (ts.isTypeReferenceNode(parent) || ts.isTypeQueryNode(parent) || ts.isQualifiedName(parent) || ts.isExpressionWithTypeArguments(parent)) return 'benign'
  if (ts.isCallExpression(parent) && parent.arguments[0] === reference && COMPONENT_WRAPPER_CALLEES.test(calleeName(parent, source))) return 'benign'
  return 'escaping'
}

interface ImportBinding { spec: string; imported: string }
/** An imported binding used as a plain value; `member` when used as `binding.member`. */
interface EscapeUse extends ImportBinding { member?: string }
/** A dynamic module reference: exact specifier, a static prefix (template / concatenation), or unknowable. */
type DynamicReference = { spec: string } | { prefix: string } | { unknown: true }
interface ModuleScan {
  imports: Map<string, ImportBinding>
  /** export name -> local binding name */
  localExports: Map<string, string>
  reexports: Map<string, ImportBinding>
  stars: string[]
  escapes: EscapeUse[]
  /** `import()` / `require()` */
  dynamic: DynamicReference[]
  /** `import.meta.glob(...)` patterns; null when not literal */
  globs: Array<string[] | null>
}
const scriptKindFor = (file: string) => /\.tsx$/i.test(file) ? ts.ScriptKind.TSX : /\.jsx$/i.test(file) ? ts.ScriptKind.JSX : /\.[mc]?js$/i.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS
export function scanModule(fileName: string, text: string): ModuleScan {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, scriptKindFor(fileName))
  const scan: ModuleScan = { imports: new Map(), localExports: new Map(), reexports: new Map(), stars: [], escapes: [], dynamic: [], globs: [] }
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const clause = statement.importClause
      if (!clause || clause.isTypeOnly) continue
      const spec = statement.moduleSpecifier.text
      if (clause.name) scan.imports.set(clause.name.text, { spec, imported: 'default' })
      if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) scan.imports.set(clause.namedBindings.name.text, { spec, imported: '*' })
      else if (clause.namedBindings) for (const element of clause.namedBindings.elements) if (!element.isTypeOnly) scan.imports.set(element.name.text, { spec, imported: element.propertyName?.text ?? element.name.text })
    } else if (ts.isExportDeclaration(statement)) {
      if (statement.isTypeOnly) continue
      const spec = statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier) ? statement.moduleSpecifier.text : undefined
      if (!statement.exportClause) { if (spec) scan.stars.push(spec); continue }
      if (ts.isNamespaceExport(statement.exportClause)) { if (spec) scan.reexports.set(statement.exportClause.name.text, { spec, imported: '*' }); continue }
      for (const element of statement.exportClause.elements) {
        if (element.isTypeOnly) continue
        const local = element.propertyName?.text ?? element.name.text
        if (spec) scan.reexports.set(element.name.text, { spec, imported: local })
        else scan.localExports.set(element.name.text, local)
      }
    } else if (ts.isExportAssignment(statement) && !statement.isExportEquals && ts.isIdentifier(statement.expression)) {
      scan.localExports.set('default', statement.expression.text)
    } else if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isVariableStatement(statement)) {
      const modifiers = ts.getModifiers(statement) ?? []
      if (!modifiers.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue
      const isDefault = modifiers.some(modifier => modifier.kind === ts.SyntaxKind.DefaultKeyword)
      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          const names = new Set<string>()
          bindingNames(declaration.name, names)
          for (const name of names) scan.localExports.set(name, name)
        }
      } else if (statement.name) scan.localExports.set(isDefault ? 'default' : statement.name.text, statement.name.text)
    }
  }
  const dynamicReference = (argument: ts.Expression | undefined): DynamicReference => {
    if (argument && (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument))) return { spec: argument.text }
    if (argument && ts.isTemplateExpression(argument) && argument.head.text) return { prefix: argument.head.text }
    if (argument && ts.isBinaryExpression(argument) && argument.operatorToken.kind === ts.SyntaxKind.PlusToken && ts.isStringLiteral(argument.left) && argument.left.text) return { prefix: argument.left.text }
    return { unknown: true }
  }
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      scan.dynamic.push(dynamicReference(node.arguments[0]))
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ts.isMetaProperty(node.expression.expression) &&
      node.expression.expression.keywordToken === ts.SyntaxKind.ImportKeyword && /^glob(?:Eager)?$/.test(node.expression.name.text)) {
      const argument = node.arguments[0]
      const patterns = argument && (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)) ? [argument.text]
        : argument && ts.isArrayLiteralExpression(argument) && argument.elements.every(element => ts.isStringLiteral(element) || ts.isNoSubstitutionTemplateLiteral(element))
          ? argument.elements.map(element => (element as ts.StringLiteral).text) : null
      scan.globs.push(patterns)
    }
    if (ts.isIdentifier(node) && scan.imports.has(node.text) && isReferenceIdentifier(node)) {
      const binding = scan.imports.get(node.text)!
      const parent = node.parent
      if (ts.isPropertyAccessExpression(parent) && parent.expression === node) {
        // `binding.member`: the member is what is used (a namespace export, `Row.call`, ...).
        if (referenceUse(parent, source) === 'escaping') scan.escapes.push({ ...binding, member: parent.name.text })
      } else if (binding.imported === '*') {
        if (!ts.isQualifiedName(parent) && !ts.isTypeQueryNode(parent) && !ts.isTypeReferenceNode(parent)) scan.escapes.push(binding)
      } else if (referenceUse(node, source) === 'escaping') scan.escapes.push(binding)
    }
    node.forEachChild(visit)
  }
  visit(source)
  return scan
}

export interface ProjectEscapeIndex {
  /** `${absoluteFile}#${localName}` of exported functions some module uses as a plain value */
  origins: Set<string>
  /** export names used as values through specifiers that could not be resolved to a file */
  names: Set<string>
  /** a default export was used as a value through an unresolved project specifier */
  defaults: boolean
  /** an export could be reached by unknown code (non-literal dynamic import, scan limit, error) */
  all: boolean
  reason?: string
}
/**
 * MDX/Markdown can import components and call them inside `{...}` expressions. Imports are
 * read from the import statements; any other textual reference to an imported name that is
 * not a JSX tag (`<Name` / `</Name`) counts as a plain-value use (prose mentions included:
 * fail-closed).
 */
export function scanMarkdownModule(fileName: string, text: string): ModuleScan {
  const importStatements = text.match(/^\s*import\s[\s\S]*?from\s*['"][^'"]+['"];?/gm) ?? []
  const scan = scanModule(`${fileName}.jsx`, importStatements.join('\n'))
  let body = text
  for (const statement of importStatements) body = body.replace(statement, '')
  for (const [local, binding] of scan.imports) {
    const escaped = local.replace(/[$]/g, '\\$&')
    if (new RegExp(`(^|[^<\\w$./])${escaped}(?![\\w$])`, 'm').test(body) || new RegExp(`</?${escaped}\\.`).test(body)) scan.escapes.push(binding)
  }
  return scan
}
/** Inline `<script type="module">` blocks of an HTML file, scanned as one module located next to it. */
export function scanHtmlModuleScripts(fileName: string, text: string): ModuleScan {
  const scripts = [...text.matchAll(/<script\b(?=[^>]*\btype\s*=\s*["']?module)(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1])
  return scanModule(`${fileName}.js`, scripts.join('\n;\n'))
}

const PROJECT_SCAN_LIMIT = 4000
const SKIPPED_DIRECTORIES = new Set(['node_modules', '.git'])
const SCANNED_FILE = /\.(?:tsx|ts|jsx|js|mjs|cjs|mts|cts)$/i
const RESOLVE_EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.cjs', '.mts', '.cts']
/** A specifier naming a non-script asset (JSON, CSS, images, ...) cannot yield a component. */
const isAssetSpecifier = (spec: string) => { const extension = /\.([a-z0-9]+)(?:\?.*)?$/i.exec(spec)?.[1]?.toLowerCase(); return !!extension && !['tsx', 'ts', 'jsx', 'js', 'mjs', 'cjs', 'mts', 'cts'].includes(extension) }
const globToRegExp = (pattern: string) => new RegExp(`^${pattern.replace(/[.+^$()|[\]\\]/g, '\\$&').replace(/\{([^}]*)\}/g, (_, body: string) => `(${body.split(',').join('|')})`)
  .replace(/\*\*\//g, '\u0000').replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\u0000/g, '(?:.*/)?')}$`)

/**
 * Cross-file half of the escape rule. A Vite transform sees one file, but `items.map(Row)`
 * can live in another module. Every module under the project root is scanned (cached by
 * mtime/size); an exported capitalized function used as a plain value anywhere, through
 * named/default/namespace imports, re-exports, barrels or dynamic import, gets no hooks.
 * Unresolvable project specifiers degrade by export name; anything unknowable (non-literal
 * dynamic import, more than PROJECT_SCAN_LIMIT files, scan errors) disables hook injection
 * for every exported function (fail-closed).
 */
export function createProjectEscapeIndex(projectRoot: string): (fresh?: boolean) => ProjectEscapeIndex {
  const root = path.resolve(projectRoot)
  const scans = new Map<string, { stamp: string; scan: ModuleScan }>()
  let cached: { at: number; index: ProjectEscapeIndex } | undefined
  /** Whether any file a target may resolve to exists on disk (scanned or not). */
  const onDiskNow = (base: string) => {
    const stem = base.replace(/\.(?:[mc]?js|jsx)$/i, '')
    // A directory with its own package.json is followed by Vite through that manifest.
    return [base, path.join(base, 'package.json'), ...RESOLVE_EXTENSIONS.map(extension => base + extension), ...RESOLVE_EXTENSIONS.map(extension => stem + extension), ...RESOLVE_EXTENSIONS.map(extension => path.join(base, `index${extension}`))]
      .some(candidate => { try { return fs.statSync(candidate).isFile() } catch { return false } })
  }
  // Filesystem facts outside the scanned sources that a build depended on (installed package
  // links, manifests, configs, unscanned targets). A rebuild whose sources and facts are all
  // unchanged reuses the previous index instead of resolving everything again.
  type ObservationKind = 'path' | 'file' | 'ondisk'
  const observeNow = (kind: ObservationKind, target: string): string => {
    if (kind === 'path') { try { return fs.realpathSync(target) } catch { return '' } }
    if (kind === 'file') { try { const stat = fs.statSync(target); return Date.now() - stat.mtimeMs < 2000 ? `${stat.mtimeMs}:${stat.size}:${createHash('sha256').update(fs.readFileSync(target)).digest('hex')}` : `${stat.mtimeMs}:${stat.size}` } catch { return '' } }
    return onDiskNow(target) ? '1' : ''
  }
  let previous: { fingerprint: string; observed: Map<string, string>; index: ProjectEscapeIndex } | undefined
  const build = (): ProjectEscapeIndex => {
    const index: ProjectEscapeIndex = { origins: new Set(), names: new Set(), defaults: false, all: false }
    if (!fs.existsSync(root)) return index
    const observed = new Map<string, string>()
    const observe = (kind: ObservationKind, target: string) => {
      const key = `${kind}\0${target}`
      let value = observed.get(key)
      if (value === undefined) { value = observeNow(kind, target); observed.set(key, value) }
      return value
    }
    const fingerprintParts: string[] = []
    const files: string[] = []
    const documents: string[] = []
    const visitedDirectories = new Set<string>()
    // Symbolic links are followed (directories once, by real path), so callers living in a
    // linked folder are still seen. Files are recorded by their real path, which is also how
    // Vite identifies the module it transforms; specifiers are canonicalized the same way.
    const realRoot = fs.realpathSync(root)
    const recorded = new Set<string>()
    const record = (list: string[], absolute: string) => {
      const real = fs.realpathSync(absolute)
      if (!recorded.has(real)) { recorded.add(real); list.push(real) }
    }
    // Every link path a real directory was reached by (Ripple's preview sets
    // `resolve.preserveSymlinks`, so Vite resolves relative imports from the link path).
    const directoryAliases = new Map<string, Set<string>>()
    const walk = (directory: string) => {
      const real = fs.realpathSync(directory)
      if (real !== directory) { const aliases = directoryAliases.get(real) ?? new Set<string>(); aliases.add(directory); directoryAliases.set(real, aliases) }
      if (visitedDirectories.has(real)) return
      visitedDirectories.add(real)
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (files.length > PROJECT_SCAN_LIMIT) return
        const absolute = path.join(directory, entry.name)
        let isDirectory = entry.isDirectory()
        let isFile = entry.isFile()
        if (entry.isSymbolicLink()) {
          fingerprintParts.push(`link ${absolute} ${observeNow('path', absolute)}`)
          try { const target = fs.statSync(absolute); isDirectory = target.isDirectory(); isFile = target.isFile() } catch { continue }
        }
        if (isFile && (entry.name === 'package.json' || /^(?:ts|js)config.*\.json$/i.test(entry.name))) fingerprintParts.push(`config ${absolute} ${observeNow('file', absolute)}`)
        if (isDirectory) { if (!SKIPPED_DIRECTORIES.has(entry.name)) walk(absolute) }
        else if (isFile && SCANNED_FILE.test(entry.name) && !/\.d\.[mc]?ts$/i.test(entry.name)) record(files, absolute)
        else if (isFile && /\.(?:mdx|md|html?)$/i.test(entry.name)) record(documents, absolute)
      }
    }
    walk(root)
    if (files.length + documents.length > PROJECT_SCAN_LIMIT) return { ...index, all: true, reason: `more than ${PROJECT_SCAN_LIMIT} source files` }
    const fileSet = new Set(files)
    const scanned = new Set([...files, ...documents])
    for (const file of scanned) {
      const stat = fs.statSync(file)
      // A file modified within the last two seconds also stamps its content: an edit that keeps
      // the size inside the filesystem's timestamp granularity is still seen.
      const stamp = Date.now() - stat.mtimeMs < 2000 ? `${stat.mtimeMs}:${stat.size}:${createHash('sha256').update(fs.readFileSync(file)).digest('hex')}` : `${stat.mtimeMs}:${stat.size}`
      fingerprintParts.push(`source ${file} ${stamp}`)
      if (scans.get(file)?.stamp === stamp) continue
      const text = fs.readFileSync(file, 'utf8')
      const scan = /\.mdx?$/i.test(file) ? scanMarkdownModule(file, text) : /\.html?$/i.test(file) ? scanHtmlModuleScripts(file, text) : scanModule(file, text)
      scans.set(file, { stamp, scan })
    }
    for (const file of [...scans.keys()]) if (!scanned.has(file)) scans.delete(file)
    const fingerprint = createHash('sha256').update(fingerprintParts.join('\n')).digest('hex')
    if (previous && previous.fingerprint === fingerprint && [...previous.observed].every(([key, value]) => {
      const [kind, target] = key.split('\0') as [ObservationKind, string]
      return observeNow(kind, target) === value
    })) return previous.index
    // Every existing file a path may resolve to. Vite's extension order differs from
    // TypeScript's, so when `./Row` matches both Row.js and Row.tsx all of them are returned.
    const resolvePaths = (base: string): string[] => {
      const stem = base.replace(/\.(?:[mc]?js|jsx)$/i, '')
      const candidates = [base, ...RESOLVE_EXTENSIONS.map(extension => base + extension), ...RESOLVE_EXTENSIONS.map(extension => stem + extension), ...RESOLVE_EXTENSIONS.map(extension => path.join(base, `index${extension}`))]
      const found = new Set<string>()
      for (const candidate of candidates) if (fileSet.has(candidate)) found.add(candidate)
      // The same candidates below the real directory: a path through a symlinked folder maps
      // onto the real files the walk recorded (one cached realpath per directory, no per-file
      // filesystem calls).
      const realBase = canonical(base)
      if (realBase !== base) {
        const realStem = realBase.replace(/\.(?:[mc]?js|jsx)$/i, '')
        for (const candidate of [realBase, ...RESOLVE_EXTENSIONS.map(extension => realBase + extension), ...RESOLVE_EXTENSIONS.map(extension => realStem + extension), ...RESOLVE_EXTENSIONS.map(extension => path.join(realBase, `index${extension}`))]) if (fileSet.has(candidate)) found.add(candidate)
      }
      return [...found]
    }
    /** `target` with its longest existing ancestor replaced by that ancestor's real path (cached per build). */
    const canonicalCache = new Map<string, string>()
    const canonical = (target: string): string => {
      const known = canonicalCache.get(target)
      if (known !== undefined) return known
      let result = target
      try { result = fs.realpathSync(target) } catch {
        const parent = path.dirname(target)
        if (parent !== target) result = path.join(canonical(parent), path.basename(target))
      }
      canonicalCache.set(target, result)
      return result
    }
    // Aliases exactly as Ripple's preview resolves them (the shared tsconfig/jsconfig graph).
    let aliasRules: Array<{ find: string | RegExp; replacement: string }> = []
    try { aliasRules = toViteAliasRules(resolveProjectConfigGraph(root, ts)) } catch { aliasRules = [] }
    const aliasTarget = (spec: string): string | undefined => {
      for (const rule of aliasRules) {
        if (typeof rule.find === 'string' ? spec === rule.find || spec.startsWith(`${rule.find}/`) : rule.find.test(spec)) {
          const replaced = typeof rule.find === 'string' ? rule.replacement + spec.slice(rule.find.length) : spec.replace(rule.find, rule.replacement)
          return path.resolve(root, replaced)
        }
      }
      return undefined
    }
    const nodeModuleDirectories: string[] = []
    for (let directory = root; ; directory = path.dirname(directory)) {
      nodeModuleDirectories.push(path.join(directory, 'node_modules'))
      if (path.dirname(directory) === directory) break
    }
    const packageName = (spec: string) => spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]
    /**
     * A linked workspace package: installed under node_modules but really living in the project.
     * Looked up from the importing file's directory upward, as Vite does, so a pnpm link in
     * `apps/web/node_modules` wins over an unrelated copy in the root `node_modules`.
     */
    const workspaceDirectory = (spec: string, from?: string): string | undefined => {
      const directories: string[] = []
      for (let directory = from ? path.dirname(from) : root; ; directory = path.dirname(directory)) {
        directories.push(path.join(directory, 'node_modules'))
        if (path.dirname(directory) === directory) break
      }
      for (const directory of directories) {
        const installed = path.join(directory, packageName(spec))
        const real = observe('path', installed)
        if (!real) continue
        const relative = path.relative(realRoot, real)
        return relative && !relative.startsWith('..') && !path.isAbsolute(relative) && !relative.split(path.sep).includes('node_modules') ? real : undefined
      }
      return undefined
    }
    /**
     * Every file a linked workspace package may resolve to. Vite walks `exports` conditions in
     * the manifest's own key order with its own condition set (`development`, `browser`, …),
     * so instead of guessing which branch wins, every branch target is returned, together with
     * the main fields (`browser`, `module`, `jsnext:main`, `jsnext`, `main`) and the index file.
     *
     * Targets Vite can never serve as script are skipped: the `types` condition, declaration,
     * style, data and asset files, and targets that do not exist on disk (Vite fails to resolve
     * a selected branch whose file is missing; it never falls back to another branch).
     * A manifest this cannot fully resolve is `incomplete` and the caller fails closed for the
     * whole project: a target that exists but is not a scanned source file, an object `browser`
     * map, a folder mapping (`"./": …`), an unexpected leaf, or no files at all.
     */
    const workspaceTargetCache = new Map<string, { files: string[]; incomplete: boolean }>()
    const workspaceTargets = (directory: string, subpath: string): { files: string[]; incomplete: boolean } => {
      const cacheKey = `${directory}\0${subpath}`
      const cachedTargets = workspaceTargetCache.get(cacheKey)
      if (cachedTargets) return cachedTargets
      let manifest: Record<string, unknown> = {}
      observe('file', path.join(directory, 'package.json'))
      try { manifest = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8')) } catch { /* no manifest: index file */ }
      const files = new Set<string>()
      let incomplete = false
      const onDisk = (base: string) => observe('ondisk', base) === '1'
      const add = (target: string) => {
        const absolute = path.resolve(directory, target)
        const found = resolvePaths(absolute)
        found.forEach(file => files.add(file))
        // Only a target with no script candidate at all can be a declaration, style or asset
        // (`./src/index.esm` may still resolve to `index.esm.jsx`).
        if (found.length || /\.d\.[mc]?ts$/i.test(target) || isAssetSpecifier(target)) return
        if (onDisk(absolute)) incomplete = true
      }
      const collect = (value: unknown, star?: string) => {
        if (typeof value === 'string') add(star === undefined ? value : value.replaceAll('*', star))
        else if (Array.isArray(value)) value.forEach(item => collect(item, star))
        else if (value && typeof value === 'object') {
          for (const [condition, branch] of Object.entries(value as Record<string, unknown>)) if (condition !== 'types') collect(branch, star)
        } else if (value !== null && value !== undefined) incomplete = true
      }
      const exportsField = manifest.exports
      if (exportsField !== undefined && exportsField !== null) {
        const keyed = typeof exportsField === 'object' && !Array.isArray(exportsField) && Object.keys(exportsField).some(key => key.startsWith('.'))
        const record = exportsField as Record<string, unknown>
        const requested = subpath ? `./${subpath}` : '.'
        if (!keyed) { if (!subpath) collect(exportsField) }
        else {
          if (requested in record) collect(record[requested])
          for (const [key, branch] of Object.entries(record)) {
            if (key === requested) continue
            const starAt = key.indexOf('*')
            if (starAt >= 0) {
              // Subpath pattern: expanded for the requested subpath (Vite's longest-prefix
              // choice is covered by taking every matching pattern).
              const prefix = key.slice(0, starAt)
              const suffix = key.slice(starAt + 1)
              if (requested.length >= prefix.length + suffix.length && requested.startsWith(prefix) && requested.endsWith(suffix)) collect(branch, requested.slice(prefix.length, requested.length - suffix.length))
            } else if (key.endsWith('/') && requested.startsWith(key)) incomplete = true
          }
        }
      }
      if (subpath) {
        // Without a matching `exports` entry Vite may still serve the file by its path.
        add(subpath)
      } else {
        for (const field of ['module', 'jsnext:main', 'jsnext', 'main']) if (typeof manifest[field] === 'string') add(manifest[field] as string)
        if (typeof manifest.browser === 'string') add(manifest.browser)
        else if (manifest.browser !== undefined && manifest.browser !== false) incomplete = true
        resolvePaths(path.join(directory, 'index')).forEach(file => files.add(file))
      }
      if (files.size === 0) incomplete = true
      const result = { files: [...files], incomplete }
      workspaceTargetCache.set(cacheKey, result)
      return result
    }
    /** A module's real directory plus every link path it can be reached by. */
    const importerDirectories = (file: string): string[] => {
      const realDirectory = path.dirname(file)
      const found = new Set([realDirectory])
      for (let ancestor = realDirectory; ; ancestor = path.dirname(ancestor)) {
        for (const alias of directoryAliases.get(ancestor) ?? []) found.add(path.join(alias, path.relative(ancestor, realDirectory)))
        if (path.dirname(ancestor) === ancestor) break
      }
      return [...found]
    }
    /** All files a specifier may resolve to; empty when it is not resolvable inside the project. */
    const resolveSpec = (from: string, spec: string): string[] => {
      if (spec.startsWith('/')) return resolvePaths(path.join(root, spec))
      // Relative: from the real directory (Vite's default) and from every link path
      // (`preserveSymlinks`); the union covers whichever the server uses.
      if (spec.startsWith('.')) return [...new Set(importerDirectories(from).flatMap(directory => resolvePaths(path.resolve(directory, spec))))]
      const aliased = aliasTarget(spec)
      if (aliased) return resolvePaths(aliased)
      const workspace = workspaceDirectory(spec, from)
      if (!workspace) return []
      const targets = workspaceTargets(workspace, spec.slice(packageName(spec).length).replace(/^\//, ''))
      if (targets.incomplete) { index.all = true; index.reason = `workspace package ${packageName(spec)} has entry points Ripple cannot fully resolve` }
      return targets.files
    }
    // A bare specifier is a package only when it is a Node builtin or installed in a
    // node_modules folder at or above the root, and no tsconfig/jsconfig `paths` entry maps it.
    // Anything else (tsconfig paths, Vite aliases, `@/`, `~/`, `#`) is a project specifier
    // whose target is unknown: it degrades by export name instead of being ignored.
    // Raw tsconfig/jsconfig `paths` keys too, in case the shared resolver declined them.
    const aliasPatterns: string[] = []
    for (const name of ['tsconfig.json', 'jsconfig.json', 'tsconfig.app.json']) {
      try {
        observe('file', path.join(root, name))
        const parsed = ts.parseConfigFileTextToJson(name, fs.readFileSync(path.join(root, name), 'utf8')).config as { compilerOptions?: { paths?: Record<string, unknown> } } | undefined
        for (const key of Object.keys(parsed?.compilerOptions?.paths ?? {})) aliasPatterns.push(key.replace(/\*.*$/, ''))
      } catch { /* absent or unreadable config: no declared aliases */ }
    }
    const builtins = new Set(builtinModules)
    const isPackage = (spec: string) => {
      if (spec.startsWith('node:') || builtins.has(spec.split('/')[0])) return true
      if (aliasTarget(spec) || aliasPatterns.some(prefix => prefix && spec.startsWith(prefix))) return false
      if (/^(?:@\/|~\/|#)/.test(spec)) return false
      if (workspaceDirectory(spec)) return false
      return nodeModuleDirectories.some(directory => observe('path', path.join(directory, packageName(spec))) !== '')
    }
    const projectSpecifier = (spec: string) => !isAssetSpecifier(spec) && (spec.startsWith('.') || spec.startsWith('/') || !isPackage(spec))
    const unresolvedName = (name: string) => {
      if (name === '*') { index.all = true; index.reason = 'a whole module namespace escaped through an unresolved specifier' }
      else if (name === 'default') index.defaults = true
      else index.names.add(name)
    }
    type Origins = { origins: Array<{ file: string; local: string }>; namespaces: string[]; uncertain: boolean }
    const merge = (results: Origins[]): Origins => ({ origins: results.flatMap(result => result.origins), namespaces: results.flatMap(result => result.namespaces), uncertain: results.some(result => result.uncertain) })
    const resolveOrigin = (file: string, name: string, seen: Set<string>): Origins => {
      const key = `${file}#${name}`
      if (seen.has(key)) return { origins: [], namespaces: [], uncertain: false }
      seen.add(key)
      const scan = scans.get(file)?.scan
      if (!scan) return { origins: [], namespaces: [], uncertain: true }
      // A specifier may have several possible targets (workspace conditions, extension order):
      // every one of them is followed.
      const follow = (binding: ImportBinding): Origins => {
        const targets = resolveSpec(file, binding.spec)
        if (!targets.length) return { origins: [], namespaces: [], uncertain: projectSpecifier(binding.spec) }
        // `export * as ns from`, `import * as ns; export { ns }`: the export is a module namespace.
        if (binding.imported === '*') return { origins: [], namespaces: targets, uncertain: false }
        return merge(targets.map(target => resolveOrigin(target, binding.imported, seen)))
      }
      const local = scan.localExports.get(name)
      if (local !== undefined) {
        const imported = scan.imports.get(local)
        return imported ? follow(imported) : { origins: [{ file, local }], namespaces: [], uncertain: false }
      }
      const reexport = scan.reexports.get(name)
      if (reexport) return follow(reexport)
      const results: Origins[] = []
      for (const star of scan.stars) {
        const result = follow({ spec: star, imported: name })
        results.push(result)
        if (result.origins.length || result.namespaces.length) break
      }
      return merge(results)
    }
    const markExport = (file: string, name: string, member?: string) => {
      const result = resolveOrigin(file, name, new Set())
      for (const namespace of result.namespaces) {
        if (member) markExport(namespace, member)
        else markAllExports(namespace)
      }
      for (const origin of result.origins) index.origins.add(`${origin.file}#${origin.local}`)
      if (result.uncertain) { unresolvedName(name); if (member) unresolvedName(member) }
    }
    const markAllExports = (file: string, seen = new Set<string>()) => {
      if (seen.has(file)) return
      seen.add(file)
      const scan = scans.get(file)?.scan
      if (!scan) return
      for (const name of [...scan.localExports.keys(), ...scan.reexports.keys()]) markExport(file, name)
      for (const star of scan.stars) {
        const targets = resolveSpec(file, star)
        for (const target of targets) markAllExports(target, seen)
        if (!targets.length && projectSpecifier(star)) unresolvedName('*')
      }
    }
    for (const [file, { scan }] of scans) {
      for (const escape of scan.escapes) {
        const targets = resolveSpec(file, escape.spec)
        if (!targets.length) {
          if (projectSpecifier(escape.spec)) {
            if (escape.imported === '*' && escape.member) unresolvedName(escape.member)
            else { unresolvedName(escape.imported); if (escape.member) unresolvedName(escape.member) }
          }
          continue
        }
        for (const target of targets) {
          if (escape.imported === '*') { if (escape.member) markExport(target, escape.member); else markAllExports(target) }
          else markExport(target, escape.imported, escape.member)
        }
      }
      const markPrefix = (prefix: string, label: string) => {
        if (!prefix.startsWith('.') && !prefix.startsWith('/')) {
          if (projectSpecifier(prefix)) { index.all = true; index.reason = `dynamic import with unresolved prefix ${label}` }
          return
        }
        for (const directory of prefix.startsWith('/') ? [root] : importerDirectories(file)) {
          const absolute = prefix.startsWith('/') ? path.join(root, prefix) : path.resolve(directory, prefix)
          // The static directory part is canonicalized; a partial file name stays as written.
          const base = /[\\/]$/.test(prefix) ? canonical(absolute) + path.sep : path.join(canonical(path.dirname(absolute)), path.basename(absolute))
          for (const candidate of files) if (candidate.startsWith(base)) markAllExports(candidate)
        }
      }
      for (const reference of scan.dynamic) {
        if ('unknown' in reference) { index.all = true; index.reason = `non-literal dynamic import in ${path.relative(root, file)}`; continue }
        if ('prefix' in reference) { markPrefix(reference.prefix, reference.prefix); continue }
        const targets = resolveSpec(file, reference.spec)
        for (const target of targets) markAllExports(target)
        if (!targets.length && projectSpecifier(reference.spec)) { index.all = true; index.reason = `unresolved dynamic import ${reference.spec}` }
      }
      for (const patterns of scan.globs) {
        if (!patterns) { index.all = true; index.reason = `non-literal import.meta.glob in ${path.relative(root, file)}`; continue }
        for (const pattern of patterns.filter(item => !item.startsWith('!'))) {
          if (!pattern.startsWith('.') && !pattern.startsWith('/')) { index.all = true; index.reason = `import.meta.glob with alias pattern ${pattern}`; continue }
          for (const directory of pattern.startsWith('/') ? [root] : importerDirectories(file)) {
            const written = pattern.startsWith('/') ? path.join(root, pattern) : path.resolve(directory, pattern)
            const magic = written.search(/[*?{[]/)
            const staticDirectory = magic < 0 ? path.dirname(written) : written.slice(0, written.lastIndexOf(path.sep, magic))
            const absolutePattern = (canonical(staticDirectory) + written.slice(staticDirectory.length)).replaceAll('\\', '/')
            const matcher = globToRegExp(absolutePattern)
            for (const candidate of files) if (matcher.test(candidate.replaceAll('\\', '/'))) markAllExports(candidate)
          }
        }
      }
    }
    previous = { fingerprint, observed, index }
    return index
  }
  // Reused for 250 ms after the build finished; file events (`fresh`) always rebuild. An
  // unchanged project costs a rebuild only the walk and one stat per file.
  return (fresh = false) => {
    if (!fresh && cached && Date.now() - cached.at < 250) return cached.index
    let index: ProjectEscapeIndex
    try { index = build() } catch (error) { previous = undefined; index = { origins: new Set(), names: new Set(), defaults: false, all: true, reason: `project scan failed: ${error instanceof Error ? error.message : String(error)}` } }
    cached = { at: Date.now(), index }
    return index
  }
}

/** Browser-side half of the annotation: identity context, certainty merge and per-file source versions. */
export const RIPPLE_IDENTITY_RUNTIME = `import { createContext, createElement, useContext, useMemo } from 'react'
const RippleIdentityContext = createContext(null)
const RANK = { 'stable-react-instance': 0, 'stable-keyed-instance': 1, 'position-dependent': 2, unknown: 3 }
const rank = certainty => Object.prototype.hasOwnProperty.call(RANK, certainty) ? RANK[certainty] : 3
const dependent = certainty => rank(certainty) >= 2
const REGISTRY_KEY = Symbol.for('ripple.runtime-identity')
// Versions are registered per module evaluation. A file registered with more than one
// digest during the page's lifetime (HMR, re-evaluation) cannot attribute its existing DOM
// to either version, so the collector reports it as ambiguous instead of the latest one.
const createRegistry = () => {
  const sourceVersions = new Map()
  const sourceVersionHistory = new Map()
  return {
    protocol: 'ripple-runtime-identity/v1', sourceVersions, sourceVersionHistory,
    register(file, digest) {
      sourceVersions.set(file, digest)
      const seen = sourceVersionHistory.get(file) || new Set()
      seen.add(digest)
      sourceVersionHistory.set(file, seen)
    },
  }
}
const registry = globalThis[REGISTRY_KEY] || (Object.defineProperty(globalThis, REGISTRY_KEY, { value: createRegistry(), configurable: true }), globalThis[REGISTRY_KEY])
export function registerRippleSourceVersion(file, digest) { registry.register(file, digest) }
export function mergeRippleCertainty(left, right) {
  const worst = rank(left) >= rank(right) ? left : right
  if (dependent(worst)) return rank(worst) >= 3 ? 'unknown' : worst
  return left === 'stable-keyed-instance' || right === 'stable-keyed-instance' ? 'stable-keyed-instance' : 'stable-react-instance'
}
const sameComponent = (bound, self) => !!bound && !!self && (bound === self || bound.type === self || bound.render === self || (!!bound.type && bound.type.render === self))
// The identity in context only belongs to this component when the nearest boundary was
// created for this component's own element. Anything else (a component rendered by
// non-annotated code, createElement, a library) inherited an ancestor's identity. The
// first instance to read a boundary claims it (by its useId), so a descendant of the same
// type without its own boundary cannot borrow the outer instance's identity.
export function useRippleIdentity(self, claimant) {
  const identity = useContext(RippleIdentityContext)
  if (!identity) return null
  let bound = sameComponent(identity.component, self)
  if (bound && claimant !== undefined) {
    if (identity.claimant === undefined) identity.claimant = claimant
    bound = identity.claimant === claimant
  }
  return { path: identity.path, certainty: identity.certainty, bound }
}
// React keys are evaluated exactly once, where the application wrote them. Ripple never
// re-evaluates a key expression (getters, Proxies, toString/toPrimitive could run again):
// - host elements carry no key value at all; their instance id ends in "~" and the collector
//   fills in the keys React itself already computed (fiber keys), at collection time;
// - a keyed component's boundary receives the key through a cell assigned in place,
//   key={(cell.k = (EXPR))}, and reads it while rendering, after the element was created.
// A non-primitive value in a cell is never coerced here (identity unknown).
const KEY_CELLS = new WeakSet()
export function rippleKeyCell() { const cell = Object.create(null); KEY_CELLS.add(cell); return cell }
const isCell = part => typeof part === 'object' && part !== null && KEY_CELLS.has(part)
const primitiveText = value => typeof value === 'string' ? value : typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean' ? String(value) : null
const partText = part => isCell(part) ? primitiveText(part.k) : primitiveText(part)
// Each key is URI-encoded so that keys containing "/" cannot collide when joined.
export function rippleKeyText(parts) {
  const texts = parts.map(partText)
  return texts.includes(null) ? null : texts.map(text => encodeURIComponent(text)).join('/')
}
export function rippleCertainty(identity, local) { return mergeRippleCertainty(identity && identity.bound ? identity.certainty : 'unknown', local) }
export function RippleIdentity({ component, owner, ownerId, root, instanceParts, sourceRef, certainty, children }) {
  const ownerBound = !!(owner && owner.bound)
  const parentCertainty = ownerBound ? owner.certainty : root ? 'stable-react-instance' : 'unknown'
  const parentPath = ownerBound ? (dependent(owner.certainty) ? owner.path + ':' + ownerId : owner.path) : ownerId
  // Rendered after the element (and its key) was created, so captured cells are filled.
  const keyText = instanceParts && instanceParts.length ? rippleKeyText(instanceParts) : undefined
  const instanceKey = keyText === undefined ? sourceRef : keyText ?? '?'
  const path = [parentPath, sourceRef, instanceKey].filter(Boolean).join('/')
  const identityCertainty = mergeRippleCertainty(parentCertainty, keyText === null ? 'unknown' : certainty)
  // A stable context value keeps React.memo children from re-rendering because of Ripple.
  const value = useMemo(() => ({ component, path, certainty: identityCertainty }), [component, path, identityCertainty])
  return createElement(RippleIdentityContext.Provider, { value }, children)
}
`

export function sourceAnnotationPlugin(projectRoot: string): Plugin {
  const root = path.resolve(projectRoot)
  const identityModule = `\0ripple:identity`
  const projectEscapes = createProjectEscapeIndex(root)
  // Escape decisions of transformed modules, re-checked when any file changes: an edit
  // elsewhere can start calling an already-served component as a plain function.
  const decisions = new Map<string, { exported: Array<{ component: string; exportNames: string[] }>; escaping: string }>()
  const realFile = (file: string) => { try { return fs.realpathSync(file) } catch { return file } }
  const exportedEscapes = (file: string, exported: Array<{ component: string; exportNames: string[] }>, index: ProjectEscapeIndex) => exported
    .filter(({ component, exportNames }) => index.all || index.origins.has(`${realFile(file)}#${component}`) || exportNames.some(name => name === 'default' ? index.defaults : index.names.has(name)))
    .map(({ component }) => component).sort().join(',')
  let escapesStale = false
  let recheckQueued = false
  /** Rebuilds the index and invalidates every served module whose escape decision flipped. */
  const recheckDecisions = (): boolean => {
    if (!devServer) return false
    const index = projectEscapes(true)
    escapesStale = false
    let changed = false
    for (const [file, decision] of decisions) {
      if (exportedEscapes(file, decision.exported, index) === decision.escaping) continue
      changed = true
      for (const module of devServer.moduleGraph.getModulesByFile(file) ?? []) devServer.moduleGraph.invalidateModule(module)
    }
    return changed
  }
  let devServer: { moduleGraph: { getModulesByFile(file: string): Set<unknown> | undefined; invalidateModule(module: unknown): void }; ws: { send(payload: { type: 'full-reload' }): void } } | undefined
  return {
    name: 'ripple-runtime-source-annotation',
    enforce: 'pre',
    apply: 'serve',
    configureServer(server: unknown) {
      devServer = server as typeof devServer
      // Ripple's own preview runs with `server.hmr: false`, where Vite never calls
      // handleHotUpdate. So file events are handled here, independent of HMR: any added,
      // removed or changed file marks the index stale and queues a re-check of every served
      // decision. The re-check runs shortly after the event, synchronously before the dev
      // server answers any request, and before every page navigation even without an event,
      // so a module transformed under an outdated decision is invalidated before the browser
      // can load it next to its new caller.
      const host = server as { watcher?: { on?(event: string, listener: () => void): unknown }; middlewares?: { use?(handler: (request: unknown, response: unknown, next: () => void) => void): unknown } }
      const flush = () => {
        if (!recheckQueued) return
        recheckQueued = false
        try {
          if (recheckDecisions()) devServer?.ws.send({ type: 'full-reload' })
        } catch {
          // Fail closed: every served decision is dropped and re-made from a fresh index.
          escapesStale = true
          try { for (const file of decisions.keys()) for (const module of devServer?.moduleGraph.getModulesByFile(file) ?? []) devServer?.moduleGraph.invalidateModule(module) } catch { /* nothing more to do */ }
        }
      }
      host.watcher?.on?.('all', () => {
        escapesStale = true
        if (recheckQueued) return
        recheckQueued = true
        const timer = setTimeout(flush, 25)
        ;(timer as { unref?(): void }).unref?.()
      })
      host.middlewares?.use?.((request, _response, next) => {
        // A page navigation always re-checks against the files as they are now (cheap when
        // nothing changed), so a page load right after an edit cannot race a watcher event
        // that has not been delivered yet; the module requests of that page follow it.
        const accept = (request as { headers?: Record<string, unknown> } | undefined)?.headers?.accept
        if (typeof accept === 'string' && accept.includes('text/html')) recheckQueued = true
        flush()
        next()
      })
    },
    handleHotUpdate(context: unknown) {
      if (!devServer) return undefined
      recheckQueued = false
      if (!recheckDecisions()) return undefined
      void context
      devServer.ws.send({ type: 'full-reload' })
      return []
    },
    resolveId(id) { return id === 'virtual:ripple-identity' ? identityModule : undefined },
    load(id) { return id === identityModule ? RIPPLE_IDENTITY_RUNTIME : undefined },
    transform(code, id) {
      const file = path.resolve(id.split('?')[0])
      const relative = path.relative(root, file)
      if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) ||
        !/\.(tsx|jsx)$/i.test(file) || relative.split(path.sep).includes('node_modules')) return null

      const sourcePath = relative.replaceAll('\\', '/')
      const scriptKind = /\.jsx$/i.test(file) ? ts.ScriptKind.JSX : ts.ScriptKind.TSX
      const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, scriptKind)
      const usedNames = new Set<string>()
      const generatedName = (base: string) => {
        let name = base
        while (usedNames.has(name) || new RegExp(`\\b${name}\\b`).test(code)) name += '_'
        usedNames.add(name)
        return name
      }

      // React built-ins that render their children directly (never inspect them).
      const reactDefaultNames = new Set<string>()
      const reactBuiltins = new Set<string>()
      for (const statement of source.statements) {
        if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || statement.moduleSpecifier.text !== 'react') continue
        const clause = statement.importClause
        if (clause?.name) reactDefaultNames.add(clause.name.text)
        if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) reactDefaultNames.add(clause.namedBindings.name.text)
        if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
          for (const item of clause.namedBindings.elements) if (['Fragment', 'StrictMode', 'Suspense', 'Profiler'].includes(item.propertyName?.text ?? item.name.text)) reactBuiltins.add(item.name.text)
        }
      }
      // A's candidate generator writes one exact React context provider that merely
      // forwards children. A composite JSX parent is otherwise opaque: granting trust
      // by the name RipplePageForState alone would let an app spoof this exception.
      // Require BOTH the canonical generated runtime bytes and the precise named
      // import in this module. A modified runtime or any shadowed binding fails closed.
      const transparentCandidateProviders = new Set<string>()
      const providerFile = path.join(root, '.ripple', 'overrides-runtime.js')
      let canonicalProvider = false
      try {
        const stat = fs.lstatSync(providerFile)
        canonicalProvider = stat.isFile() && !stat.isSymbolicLink() &&
          fs.realpathSync(providerFile) === providerFile &&
          createHash('sha256').update(fs.readFileSync(providerFile)).digest('hex') ===
            '910b34dbb01740e72a4bc04fbb33b142049a63502dcbeb8c65201bb75e793815'
      } catch { /* Without the exact candidate-owned provider, no JSX is transparent. */ }
      if (canonicalProvider) {
        for (const statement of source.statements) {
          if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
          const spec = statement.moduleSpecifier.text
          if (!spec.startsWith('.') || path.resolve(path.dirname(file), spec) !== providerFile) continue
          const bindings = statement.importClause?.namedBindings
          if (!bindings || !ts.isNamedImports(bindings)) continue
          for (const item of bindings.elements) {
            if ((item.propertyName?.text ?? item.name.text) === 'RipplePageForState') {
              transparentCandidateProviders.add(item.name.text)
            }
          }
        }
      }
      // A local variable/parameter may shadow even a genuine import. Conservatively
      // disable the exception for the whole file if any binding has that name.
      if (transparentCandidateProviders.size) {
        const checkShadow = (node: ts.Node) => {
          if ((ts.isVariableDeclaration(node) || ts.isParameter(node) ||
            ts.isBindingElement(node) || ts.isFunctionDeclaration(node) ||
            ts.isClassDeclaration(node)) && node.name && ts.isIdentifier(node.name)) {
            transparentCandidateProviders.delete(node.name.text)
          }
          node.forEachChild(checkShadow)
        }
        source.forEachChild(checkShadow)
      }
      const isTransparentBuiltin = (tag: string) => {
        if (transparentCandidateProviders.has(tag)) return true
        if (reactBuiltins.has(tag)) return true
        const member = /^(\w+)\.(Fragment|StrictMode|Suspense|Profiler)$/.exec(tag)
        return !!member && reactDefaultNames.has(member[1])
      }

      const components: Component[] = []
      const findComponents = (node: ts.Node) => {
        const name = componentName(node)
        // Hooks are illegal in async/generator functions; those are never treated as components.
        if (name && /^[A-Z]/.test(name) && hasJsx(node) && !isAsyncOrGenerator(node)) {
          const implementation = ts.isVariableDeclaration(node) ? node.initializer! : node
          // A local redeclaration of the component's own name would make the self
          // reference ambiguous (or a TDZ error); such a component is never bound.
          const selfRef = declaresName(implementation, name, node) ? 'undefined' : name
          components.push({ node, name, selfRef, ownerId: generatedName(`__rippleOwner${node.getStart(source)}`), identityId: generatedName(`__rippleIdentity${node.getStart(source)}`) })
        }
        node.forEachChild(findComponents)
      }
      findComponents(source)

      // A capitalized function that escapes as a value (`Row(item)`, `items.map(Row)`,
      // `renderItem={Row}`, `{ component: Row }`) may be invoked as a plain function inside
      // another render. Injected hooks would join that caller's hook list and crash it when
      // the call count changes, so only functions referenced exclusively as JSX tags (or
      // through memo/forwardRef/createElement, exports and static assignments) get hooks.
      const componentNames = new Set(components.map(component => component.name))
      const escaping = new Set<string>()
      const findEscapes = (node: ts.Node) => {
        if (ts.isIdentifier(node) && componentNames.has(node.text) && isReferenceIdentifier(node) && referenceUse(node, source) === 'escaping') escaping.add(node.text)
        node.forEachChild(findEscapes)
      }
      findEscapes(source)
      // Exported functions may also be used as plain values by other modules.
      const exportsOfFile = scanModule(file, code).localExports
      const exported = components.map(component => ({ component: component.name, exportNames: [...exportsOfFile].filter(([, local]) => local === component.name).map(([exportName]) => exportName) }))
        .filter(item => item.exportNames.length > 0)
      const escapeIndex = projectEscapes(escapesStale)
      escapesStale = false
      const crossFileEscaping = exportedEscapes(file, exported, escapeIndex)
      for (const name of crossFileEscaping ? crossFileEscaping.split(',') : []) escaping.add(name)
      decisions.set(file, { exported, escaping: crossFileEscaping })

      // `order` breaks ties between insertions at the same offset: lower values end up
      // first in the output. A boundary that closes one sibling must precede the boundary
      // that opens the next (`<A/><B/>`), and a concise arrow body must open its block
      // before, and close it after, a boundary around its returned element (`() => <A/>`).
      // A key cell wrapper sits outside a boundary at the same element.
      const ORDER = { closeBoundary: 0, closeCell: 1, closeBody: 2, default: 3, openCell: 4, openBoundary: 5 } as const
      const insertions: Array<{ position: number; text: string; order?: number; remove?: number }> = []
      const componentOwners = components.filter(component => !escaping.has(component.name)).map(component => {
        const implementation = ts.isVariableDeclaration(component.node) ? component.node.initializer! : component.node
        const body = ts.isArrowFunction(implementation) || ts.isFunctionExpression(implementation) || ts.isFunctionDeclaration(implementation)
          ? implementation.body : undefined
        if (!body) return undefined
        const hooks = `const ${component.ownerId} = __rippleUseId(); const ${component.identityId} = __rippleUseIdentity(${component.selfRef}, ${component.ownerId});`
        if (ts.isBlock(body)) {
          // Keep a directive prologue ('use no memo', 'use strict') first in the body.
          let directiveCount = 0
          while (directiveCount < body.statements.length && ts.isExpressionStatement(body.statements[directiveCount]) && ts.isStringLiteral((body.statements[directiveCount] as ts.ExpressionStatement).expression)) directiveCount += 1
          insertions.push({ position: directiveCount ? body.statements[directiveCount - 1].getEnd() : body.getStart(source) + 1, text: `\n${hooks}` })
        } else {
          insertions.push({ position: body.getStart(source), text: `{\n${hooks}\nreturn (`, order: ORDER.default })
          insertions.push({ position: body.getEnd(), text: ');\n}', order: ORDER.closeBody })
        }
        return { ...component, body, implementation }
      }).filter((owner): owner is Component & { body: ts.ConciseBody; implementation: ts.Node } => !!owner)

      const ownerFor = (node: ts.Node) => componentOwners
        .filter(owner => owner.node.pos <= node.pos && owner.node.end >= node.end)
        .sort((left, right) => (left.node.end - left.node.pos) - (right.node.end - right.node.pos))[0]

      const mapIndexes = new Map<ts.Node, string | undefined>()
      const mapIndexFor = (callback: MapCallback): string | undefined => {
        if (mapIndexes.has(callback)) return mapIndexes.get(callback)
        const existing = callback.parameters[1]
        if (existing) {
          const value = ts.isIdentifier(existing.name) ? existing.name.text : undefined
          mapIndexes.set(callback, value)
          return value
        }
        const params = callback.parameters
        // `(...args) => ...` cannot take an appended parameter.
        if (params[0]?.dotDotDotToken) {
          mapIndexes.set(callback, undefined)
          return undefined
        }
        const indexName = generatedName(`__rippleIndex${callback.getStart(source)}`)
        if (!params.length) {
          const arrow = callback.getChildren(source).find(child => child.kind === ts.SyntaxKind.EqualsGreaterThanToken)
          const openParen = code.indexOf('(', callback.getStart(source))
          if (openParen < 0 || (arrow && openParen > arrow.getStart(source))) {
            mapIndexes.set(callback, undefined)
            return undefined
          }
          insertions.push({ position: openParen + 1, text: indexName })
        } else {
          const parameter = params[0]
          const start = parameter.getStart(source)
          const end = parameter.getEnd()
          if (code[start - 1] === '(' && code[end] === ')') insertions.push({ position: end, text: `, ${indexName}` })
          else insertions.push({ position: start, text: '(' }, { position: end, text: `, ${indexName})` })
        }
        mapIndexes.set(callback, indexName)
        return indexName
      }

      /**
       * Walks from a JSX element to its owner component and records every construct that
       * can render it more than once. List callbacks are understood; loops and other nested
       * functions (render props, `.map(renderRow)` helpers) cannot be proven to run once.
       */
      const renderContext = (candidate: ts.Node, stopAt: ts.Node) => {
        const callbacks: MapCallback[] = []
        let unproven = false
        let current: ts.Node = candidate
        while (current.parent && current !== stopAt) {
          const parent: ts.Node = current.parent
          if (isLoopBody(parent, current)) unproven = true
          if (parent !== stopAt && isFunctionNode(parent)) {
            if (isMapLikeCallback(parent)) callbacks.unshift(parent)
            else if (!isSingleCallFunction(parent)) unproven = true
          }
          current = parent
        }
        const bindings: KeyBindings = { item: new Set(), index: new Set(), local: new Set() }
        for (const callback of callbacks) {
          const first = callback.parameters[0]
          const objectIteration = objectKeysIteration(callback)
          if (first && objectIteration) {
            // Object.keys/entries of an array yield positions; only a provable object literal
            // yields business keys. Anything else cannot be told apart and stays unverified.
            const keyTarget = objectIteration.source === 'object' ? bindings.item : objectIteration.source === 'array' ? bindings.index : bindings.local
            if (objectIteration.kind === 'keys') bindingNames(first.name, keyTarget)
            else if (ts.isArrayBindingPattern(first.name)) first.name.elements.forEach((element, position) => { if (!ts.isOmittedExpression(element)) bindingNames(element.name, position === 0 ? keyTarget : bindings.item) })
            else bindingNames(first.name, bindings.local)
          } else if (first && entriesOfArray(callback, source) && ts.isArrayBindingPattern(first.name)) {
            first.name.elements.forEach((element, position) => { if (!ts.isOmittedExpression(element)) bindingNames(element.name, position === 0 ? bindings.index : bindings.item) })
          } else if (first) bindingNames(first.name, iteratesPositions(callback, source) ? bindings.index : bindings.item)
          if (callback.parameters[1]) bindingNames(callback.parameters[1].name, bindings.index)
          declaredNamesIn(callback.body, bindings.local)
        }
        return { callbacks, unproven, bindings }
      }

      /** `Object.keys(x).map(...)` / `Object.entries(x).map(...)` and what `x` provably is. */
      const objectKeysIteration = (callback: MapCallback): { kind: 'keys' | 'entries'; source: 'object' | 'array' | 'unknown' } | undefined => {
        const callee = (callback.parent as ts.CallExpression).expression
        if (!ts.isPropertyAccessExpression(callee) || callee.name.text === 'from') return undefined
        const receiver = unwrapExpression(callee.expression)
        if (!ts.isCallExpression(receiver)) return undefined
        const name = calleeName(receiver, source)
        if (name !== 'Object.keys' && name !== 'Object.entries') return undefined
        const kind = name === 'Object.keys' ? 'keys' as const : 'entries' as const
        let target: ts.Node | undefined = receiver.arguments[0] ? unwrapExpression(receiver.arguments[0]) : undefined
        if (target && ts.isIdentifier(target)) target = constInitializerInScope(target)
        const kindOf = target && ts.isObjectLiteralExpression(target) ? 'object' as const : target && ts.isArrayLiteralExpression(target) ? 'array' as const : 'unknown' as const
        return { kind, source: kindOf }
      }

      const jsxRoots = (node: ts.Node): ts.Node[] => {
        if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) return [node]
        if (ts.isParenthesizedExpression(node)) return jsxRoots(node.expression)
        if (ts.isArrayLiteralExpression(node)) return node.elements.flatMap(jsxRoots)
        if (ts.isConditionalExpression(node)) return [...jsxRoots(node.whenTrue), ...jsxRoots(node.whenFalse)]
        if (ts.isBinaryExpression(node) && (node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken || node.operatorToken.kind === ts.SyntaxKind.BarBarToken || node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)) return jsxRoots(node.right)
        return []
      }
      const callbackRoots = new Map<MapCallback, ts.Node[]>()
      const rootsOf = (callback: MapCallback): ts.Node[] => {
        if (callbackRoots.has(callback)) return callbackRoots.get(callback)!
        const expressions: ts.Node[] = []
        if (ts.isBlock(callback.body)) {
          const collectReturns = (node: ts.Node) => {
            if (ts.isReturnStatement(node) && node.expression) expressions.push(node.expression)
            else if (!ts.isFunctionLike(node) || node === callback.body) node.forEachChild(collectReturns)
          }
          collectReturns(callback.body)
        } else expressions.push(callback.body)
        const roots = expressions.flatMap(jsxRoots)
        callbackRoots.set(callback, roots)
        return roots
      }

      /**
       * Key capture: a non-literal key inside an owner is evaluated once, in place, into a
       * per-evaluation cell created by a wrapper arrow around the element:
       *   ((cell) => <li key={(cell.k = (EXPR))} data-ripple-instance={lazy(cell)} />)(rippleKeyCell())
       * Keys containing JSX/functions, and elements containing yield/await, are not captured;
       * their value is never used (identity unknown).
       */
      // The boundary key move keeps evaluation order only under the automatic JSX runtime
      // (Ripple's fixed preview config). A file that opts into the classic runtime by pragma
      // gets no key capture, hence no boundary for keyed components (identity unknown).
      const classicRuntime = /@jsxRuntime\s+classic|@jsx\s+[A-Za-z_$]/.test(code)
      const captures = new Map<ts.Node, { name: string; expression: ts.Expression; attribute: ts.JsxAttribute } | undefined>()
      const captureFor = (element: ts.Node, inOwner: boolean) => {
        if (captures.has(element)) return captures.get(element)
        const expression = keyExpressionForNode(element, source)
        const opening = openingFor(element)
        const attribute = opening ? jsxKeyAttribute(opening, source) : undefined
        let capture: { name: string; expression: ts.Expression; attribute: ts.JsxAttribute } | undefined
        if (inOwner && !classicRuntime && expression && attribute && !ts.isStringLiteral(expression) && !containsJsxOrFunction(expression) && !containsSuspension(element)) {
          const name = generatedName(`__rippleKey${element.getStart(source)}`)
          const braces = ts.isJsxElement(element.parent) || ts.isJsxFragment(element.parent) || ts.isJsxAttribute(element.parent)
          insertions.push({ position: element.getStart(source), text: `${braces ? '{' : ''}((${name}) => `, order: ORDER.openCell })
          insertions.push({ position: element.getEnd(), text: `)(__rippleKeyCell())${braces ? '}' : ''}`, order: ORDER.closeCell })
          usesCells = true
          capture = { name, expression, attribute }
          // Host elements never move their key: assign in place. Component elements decide
          // between moving to the boundary and in-place assignment when they are processed.
          const tagName = openingFor(element)!.tagName.getText(source)
          if (isHostTag(tagName)) {
            insertions.push({ position: expression.getStart(source), text: `(${name}.k = (` })
            insertions.push({ position: expression.getEnd(), text: '))' })
          }
        }
        captures.set(element, capture)
        return capture
      }
      /**
       * Classification of an element's key and, when `needValue`, the runtime part carrying its
       * value. Only boundaries need values (host ids take React's own keys at collection), so
       * host elements never cause a capture by themselves.
       */
      const keyInfo = (node: ts.Node, bindings: KeyBindings, inList: boolean, inOwner: boolean, needValue: boolean): { status: KeyStability; part?: string } | undefined => {
        const expression = keyExpressionForNode(node, source)
        if (expression === undefined) return undefined
        if (expression === null) return { status: 'unverified' }
        const status = classifyKeyExpression(expression, source, { ...bindings, inList })
        if (ts.isStringLiteral(expression)) return { status, part: JSON.stringify(expression.text) }
        if (!needValue) return { status }
        const capture = captureFor(node, inOwner)
        return capture ? { status, part: capture.name } : { status: status === 'unstable' ? 'unstable' : 'unverified' }
      }
      const callbackKeyStatus = (callback: MapCallback, bindings: KeyBindings): CallbackKeyStatus => {
        const roots = rootsOf(callback)
        if (!roots.length) return 'none'
        const statuses = roots.map(node => {
          const expression = keyExpressionForNode(node, source)
          if (expression === undefined) return undefined
          return expression === null ? 'unverified' : classifyKeyExpression(expression, source, { ...bindings, inList: true })
        })
        if (statuses.some(status => !status)) return 'none'
        if (statuses.some(status => status === 'unstable' || status === 'unverified')) return 'unknown'
        if (statuses.some(status => status === 'index')) return 'index'
        return 'stable'
      }

      /**
       * A Ripple boundary changes the element at its position into a context provider. That
       * is invisible only where React itself consumes the element: the owner's returned tree
       * (or a root render argument) through host elements, fragments and React built-ins,
       * conditionals, arrays and list callbacks. Children and props of another component can
       * be inspected by it (`Children.map`, `child.type === Route`, `cloneElement(icon, ...)`),
       * and elements stored in variables can flow anywhere, so those stay untouched and the
       * component they render resolves to an unknown identity instead.
       */
      const consumedByReact = (element: ts.Node, ownerImplementation: ts.Node | undefined): 'owner' | ts.CallExpression | undefined => {
        let current: ts.Node = element
        for (;;) {
          const parent: ts.Node | undefined = current.parent
          if (!parent) return undefined
          if (ts.isJsxElement(parent) && parent.openingElement !== current) {
            const tag = parent.openingElement.tagName.getText(source)
            if (!isHostTag(tag) && !isTransparentBuiltin(tag)) return undefined
          } else if (ts.isJsxExpression(parent)) {
            if (ts.isJsxAttribute(parent.parent)) return undefined
          } else if (ts.isConditionalExpression(parent)) {
            if (parent.condition === current) return undefined
          } else if (ts.isBinaryExpression(parent)) {
            const kind = parent.operatorToken.kind
            if (kind !== ts.SyntaxKind.AmpersandAmpersandToken && kind !== ts.SyntaxKind.BarBarToken && kind !== ts.SyntaxKind.QuestionQuestionToken) return undefined
          } else if (ts.isReturnStatement(parent)) {
            const fn = enclosingFunction(parent)
            if (!fn) return undefined
            if (ownerImplementation && fn === ownerImplementation) return 'owner'
            if (!isMapLikeCallback(fn)) return undefined
            current = fn.parent
            continue
          } else if (isMapLikeCallback(parent)) {
            if (parent.body !== current) return undefined
            current = parent.parent
            continue
          } else if (ownerImplementation && parent === ownerImplementation) {
            return ts.isArrowFunction(parent) && parent.body === current ? 'owner' : undefined
          } else if (ts.isCallExpression(parent)) {
            if (ownerImplementation) return undefined
            const callee = parent.expression
            const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : ''
            const isRoot = (name === 'render' && parent.arguments[0] === current) || (name === 'hydrateRoot' && parent.arguments[1] === current)
            return isRoot ? parent : undefined
          } else if (!(ts.isJsxFragment(parent) || ts.isParenthesizedExpression(parent) || ts.isArrayLiteralExpression(parent) ||
            ts.isAsExpression(parent) || ts.isNonNullExpression(parent) || ts.isSatisfiesExpression(parent))) return undefined
          current = parent
        }
      }

      /**
       * JSX that is stored (`const check = <i/>`) or handed to another component as a prop
       * can be rendered elsewhere: in a different keyed row each time, or several times.
       * Its id is fixed when it is created, so it may only stay stable when it is a variable
       * referenced exactly once, directly in the owner's render (no list callback, loop or
       * nested function between). Anything else is unknown.
       */
      const storedOutsideRenderPosition = (element: ts.Node, ownerImplementation: ts.Node): boolean => {
        for (let current: ts.Node = element; current.parent && current !== ownerImplementation; current = current.parent) {
          const parent: ts.Node = current.parent
          if (ts.isFunctionLike(parent)) return false
          if (ts.isJsxAttribute(parent)) return true
          if (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken && parent.right === current) return true
          if (ts.isPropertyAssignment(parent) || ts.isShorthandPropertyAssignment(parent)) return true
          if (ts.isVariableDeclaration(parent) && parent.initializer === current) {
            if (!ts.isIdentifier(parent.name)) return true
            const name = parent.name.text
            const references: ts.Identifier[] = []
            const collect = (child: ts.Node) => {
              if (ts.isIdentifier(child) && child.text === name && child !== parent.name &&
                !(ts.isPropertyAccessExpression(child.parent) && child.parent.name === child) && !(ts.isPropertyAssignment(child.parent) && child.parent.name === child)) references.push(child)
              child.forEachChild(collect)
            }
            collect(ownerImplementation)
            if (references.length !== 1) return true
            for (let cursor: ts.Node | undefined = references[0].parent; cursor && cursor !== ownerImplementation; cursor = cursor.parent) {
              if (ts.isFunctionLike(cursor) || isLoop(cursor) || ts.isJsxAttribute(cursor)) return true
            }
            return false
          }
        }
        return false
      }

      let usesHook = false
      let usesWrapper = false
      let usesCertainty = false
      let usesCells = false
      const visit = (node: ts.Node) => {
        if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
          const tag = ts.isIdentifier(node.tagName) ? node.tagName.text : ''
          const fullElement = ts.isJsxSelfClosingElement(node) ? node : ts.isJsxElement(node.parent) ? node.parent : undefined
          const owner = ownerFor(node)
          const attributes = node.attributes.properties
          const has = (name: string) => attributes.some(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(source) === name)
          const sourceRef = `jsx:${sourcePath}#${node.getStart(source)}`
          const context = owner ? renderContext(node, owner.implementation) : { callbacks: [] as MapCallback[], unproven: false, bindings: { item: new Set<string>(), index: new Set<string>(), local: new Set<string>() } as KeyBindings }

          // Keys of enclosing JSX elements, evaluated in this element's scope. A key whose
          // identifiers are rebound between it and this element (nested `row => ... row =>`)
          // would evaluate to something else here and is left out (identity unknown).
          const keyPath: string[] = []
          const keyStatuses: KeyStability[] = []
          const isComponentTag = /^[A-Z]/.test(tag)
          let hostKeyedAncestor = false
          const innerBindings = new Set<string>()
          for (let cursor: ts.Node | undefined = (fullElement ?? node).parent; cursor && cursor !== owner?.node; cursor = cursor.parent) {
            if (ts.isFunctionLike(cursor)) {
              for (const parameter of cursor.parameters) bindingNames(parameter.name, innerBindings)
              if ((ts.isArrowFunction(cursor) || ts.isFunctionExpression(cursor) || ts.isFunctionDeclaration(cursor)) && cursor.body) declaredNamesIn(cursor.body, innerBindings)
            }
            if (ts.isJsxElement(cursor) || ts.isJsxSelfClosingElement(cursor)) {
              const info = keyInfo(cursor, context.bindings, false, !!owner, isComponentTag)
              if (!info) continue
              const expression = keyExpressionForNode(cursor, source)
              // Kept conservative: a key whose identifiers are rebound between it and this
              // element is not treated as part of this element's identity.
              const shadowed = !!expression && [...identifierNames(expression)].some(name => innerBindings.has(name))
              if (!isComponentTag) {
                // Host ids use React's own keys at collection: classification only.
                hostKeyedAncestor = true
                keyStatuses.push(shadowed ? 'unverified' : info.status)
                continue
              }
              if (info.part && !shadowed) {
                keyPath.unshift(info.part)
                keyStatuses.push(info.status)
              } else keyStatuses.push(info.status === 'unstable' ? 'unstable' : 'unverified')
            }
          }
          const direct = fullElement ? keyInfo(fullElement, context.bindings, false, !!owner, isComponentTag) : undefined
          if (direct) keyStatuses.push(direct.status)
          const directKey = direct?.part
          const directCapture = fullElement ? captures.get(fullElement) : undefined

          const callbackStatuses = context.callbacks.map(callback => ({ callback, status: callbackKeyStatus(callback, context.bindings) }))
          // An element created in a keyed list callback but outside the keyed root it returns
          // (`const mark = <i/>; return <li key={id}>{mark}</li>`) does not carry the row key.
          const detached = callbackStatuses.filter(item => item.status !== 'none' &&
            !rootsOf(item.callback).some(rootNode => rootNode.pos <= node.pos && rootNode.end >= node.end)).map(item => item.callback)
          const indexedCallbacks = callbackStatuses.filter(item => item.status === 'none' || item.status === 'unknown' || detached.includes(item.callback)).map(item => item.callback)
          const expressions = indexedCallbacks.map(mapIndexFor)
          const mapIndexesForElement = { expressions: expressions.filter((value): value is string => !!value), hasUnsupported: expressions.some(value => !value) }
          const positional = callbackStatuses.some(item => item.status === 'none' || item.status === 'index') || keyStatuses.includes('index')
          const unknownKey = callbackStatuses.some(item => item.status === 'unknown') || keyStatuses.includes('unstable') || keyStatuses.includes('unverified')
          // List indexes are numbers for arrays, Children.map and Array.from; anything else is
          // passed through uncoerced and turns the identity unknown at runtime.
          const indexParts = mapIndexesForElement.expressions.map(name => `(typeof ${name} === "number" ? String(${name}) : ${name})`)
          const instanceKeys = [...keyPath, ...(directKey ? [directKey] : []), ...indexParts]
          const instanceParts = `[${instanceKeys.join(', ')}]`
          const hostKeyed = hostKeyedAncestor || keyPath.length > 0 || !!direct
          const stored = owner ? storedOutsideRenderPosition(fullElement ?? node, owner.implementation) : false
          const identityCertainty: LocalCertainty = context.unproven || unknownKey || detached.length > 0 || mapIndexesForElement.hasUnsupported || stored
            ? 'unknown'
            : positional ? 'position-dependent' : direct || keyPath.length || hostKeyedAncestor ? 'stable-keyed-instance' : 'stable-react-instance'

          // A boundary carries the element's own key and never adds one. A captured key moves
          // from the element to its boundary unchanged (the element is the boundary's only
          // child): it is still evaluated once, after the element's props, as before. That
          // order only holds when no spread precedes the key, so otherwise no boundary.
          const keyAttribute = fullElement ? jsxKeyAttribute(openingFor(fullElement)!, source) : undefined
          // Any spread may carry its own `key` (React lets it win) or change evaluation order.
          const hasSpread = !!keyAttribute && node.attributes.properties.some(ts.isJsxSpreadAttribute)
          const keyMovable = !direct || (!!directKey && (!directCapture || !hasSpread))
          const consumer = /^[A-Z]/.test(tag) && fullElement && keyMovable ? consumedByReact(fullElement, owner?.implementation) : undefined
          let keyPlaced = false
          if (consumer && fullElement) {
            const rootRender = consumer !== 'owner'
            const elementRef = `jsx:${sourcePath}#${fullElement.getStart(source)}`
            const certainty = rootRender ? (runsOnceAtModuleLevel(consumer) ? 'stable-react-instance' : 'unknown') : identityCertainty
            const ownerProps = owner ? ` owner={${owner.identityId}} ownerId={${owner.ownerId}}` : ' root={true}'
            let boundaryKey = directKey && !directCapture ? ` key={${directKey}}` : ''
            if (directCapture) {
              const expressionText = source.text.slice(directCapture.expression.getStart(source), directCapture.expression.getEnd())
              boundaryKey = ` key={(${directCapture.name}.k = (${expressionText}))}`
              insertions.push({ position: directCapture.attribute.getStart(source), text: '', remove: directCapture.attribute.getEnd() - directCapture.attribute.getStart(source) })
              keyPlaced = true
            }
            insertions.push({ position: fullElement.getStart(source), text: `<RippleIdentity${boundaryKey} component={${tag}}${ownerProps} instanceParts={${instanceParts}} sourceRef={${JSON.stringify(elementRef)}} certainty=${JSON.stringify(certainty)}>`, order: ORDER.openBoundary })
            insertions.push({ position: fullElement.getEnd(), text: '</RippleIdentity>', order: ORDER.closeBoundary })
            usesWrapper = true
          }
          if (directCapture && !keyPlaced) {
            insertions.push({ position: directCapture.expression.getStart(source), text: `(${directCapture.name}.k = (` })
            insertions.push({ position: directCapture.expression.getEnd(), text: '))' })
          }
          if (/^[a-z]/.test(tag) && (!has('data-ripple-source') || !has('data-ripple-instance'))) {
            const position = node.getEnd() - (ts.isJsxSelfClosingElement(node) ? 2 : 1)
            const identityOwner = owner
              ? `(${owner.identityId}?.bound ? (${owner.identityId}.certainty === "position-dependent" || ${owner.identityId}.certainty === "unknown" ? ${owner.identityId}.path + ":" + ${owner.ownerId} : ${owner.identityId}.path) : ${owner.ownerId})`
              : undefined
            // Without an injectable list index there is no per-row value at all; repeated
            // elements in unproven constructs still get an id (possibly shared, then flagged
            // as duplicate by the collector) but never a stable certainty.
            const instanceAvailable = !mapIndexesForElement.hasUnsupported
            // Index parts are plain numbers read from the list callback. Key values are never
            // read here: a trailing "~" asks the collector for React's own keys of this element
            // and its ancestors (already computed by React when it created the elements).
            const hostParts = [...indexParts.map(part => `":" + ${part}`), ...(hostKeyed ? ['":~"'] : [])]
            const identity = owner
              ? instanceAvailable ? `window.location.pathname + ":" + ${identityOwner} + ":" + ${JSON.stringify(sourceRef)}${hostParts.map(part => ` + ${part}`).join('')}` : undefined
              : JSON.stringify(`unmapped:${sourceRef}`)
            const additions = [
              ...(!has('data-ripple-source') ? [`data-ripple-source=${JSON.stringify(sourceRef)}`] : []),
              ...(!has('data-ripple-instance') && identity ? [`data-ripple-instance={${identity}}`] : []),
              ...(!has('data-ripple-identity-certainty') ? [`data-ripple-identity-certainty={${owner ? `__rippleCertainty(${owner.identityId}, ${JSON.stringify(identityCertainty)})` : JSON.stringify('unmapped')}}`] : []),
            ]
            insertions.push({ position, text: ` ${additions.join(' ')}` })
            usesHook ||= !!owner
            usesCertainty ||= !!owner && !has('data-ripple-identity-certainty')

          }
        }
        node.forEachChild(visit)
      }
      visit(source)
      if (!insertions.length) return null
      const registerName = generatedName('__rippleRegisterSource')
      const imports: string[] = [`registerRippleSourceVersion as ${registerName}`]
      if (usesHook || componentOwners.length) {
        const hookName = generatedName('__rippleUseId')
        const identityHook = generatedName('__rippleUseIdentity')
        for (const insertion of insertions) insertion.text = insertion.text.replace(/\b__rippleUseIdentity\b/g, identityHook).replace(/\b__rippleUseId\b/g, hookName)
        imports.push(`useRippleIdentity as ${identityHook}`)
        insertions.push({ position: 0, text: `import { useId as ${hookName} } from 'react';\n` })
      }
      if (usesCertainty) {
        const certaintyName = generatedName('__rippleCertainty')
        for (const insertion of insertions) insertion.text = insertion.text.replaceAll('__rippleCertainty(', `${certaintyName}(`)
        imports.push(`rippleCertainty as ${certaintyName}`)
      }
      if (usesCells) {
        const cellName = generatedName('__rippleKeyCell')
        for (const insertion of insertions) insertion.text = insertion.text.replaceAll('__rippleKeyCell(', `${cellName}(`)
        imports.push(`rippleKeyCell as ${cellName}`)
      }
      if (usesWrapper) {
        const wrapperName = generatedName('__rippleIdentityBoundary')
        for (const insertion of insertions) insertion.text = insertion.text.replaceAll('<RippleIdentity ', `<${wrapperName} `).replaceAll('</RippleIdentity>', `</${wrapperName}>`)
        imports.push(`RippleIdentity as ${wrapperName}`)
      }
      // The digest of the exact served source lets a host reject identities rendered from
      // a different revision than the SourceGraph it resolves sourceRefs against.
      const sourceVersion = createHash('sha256').update(code, 'utf8').digest('hex')
      insertions.push({ position: 0, text: `import { ${imports.join(', ')} } from 'virtual:ripple-identity';\n${registerName}(${JSON.stringify(sourcePath)}, ${JSON.stringify(sourceVersion)});\n` })
      let transformed = code
      // Applied back to front; at one offset the later-applied text lands first.
      for (const insertion of insertions.sort((left, right) => (right.position - left.position) || ((right.order ?? ORDER.default) - (left.order ?? ORDER.default)))) {
        transformed = transformed.slice(0, insertion.position) + insertion.text + transformed.slice(insertion.position + (insertion.remove ?? 0))
      }
      return { code: transformed, map: null }
    },
  }
}
