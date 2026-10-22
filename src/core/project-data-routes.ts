import * as path from 'node:path'
import ts from 'typescript'

/** Only unambiguous, actually mounted router declarations can prove page consumers.
 * An incomplete route table is always fail-closed through route-coverage.
 */
export interface StaticRouteComponent { id: string; name: string; file: string; node: ts.Node; isDefaultExport?: boolean }
export interface StaticRouteImport { file: string; exportName: string }
export interface StaticRouteResult {
  routes: Array<{ page: string; componentId: string; sourceFile: string; offset: number; certain: boolean }>
  unresolved: string[]
  incomplete: boolean
}

const unwrap = (value: ts.Expression): ts.Expression => {
  let expr = value
  while (ts.isAsExpression(expr) || ts.isSatisfiesExpression(expr) || ts.isParenthesizedExpression(expr) || ts.isTypeAssertionExpression(expr)) expr = expr.expression
  return expr
}
const routeName = (parent: string, part: string) => part.startsWith('/')
  ? path.posix.normalize(part)
  : path.posix.normalize(`${parent.replace(/\/$/, '')}/${part}`)
const nameOf = (item: ts.ObjectLiteralElementLike): string | undefined =>
  item.name && (ts.isIdentifier(item.name) || ts.isStringLiteral(item.name)) ? item.name.text : undefined
const prop = (obj: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined => {
  const found = obj.properties.filter(p => nameOf(p) === name && (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)))
  if (found.length !== 1) return undefined
  return ts.isPropertyAssignment(found[0]) ? found[0].initializer : (found[0] as ts.ShorthandPropertyAssignment).name
}
const mutators = new Set(['push', 'pop', 'splice', 'shift', 'unshift', 'sort', 'reverse', 'fill', 'copyWithin'])
const modifyingOps = new Set([
  ts.SyntaxKind.EqualsToken, ts.SyntaxKind.PlusEqualsToken, ts.SyntaxKind.MinusEqualsToken,
  ts.SyntaxKind.AsteriskEqualsToken, ts.SyntaxKind.SlashEqualsToken, ts.SyntaxKind.AmpersandEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken, ts.SyntaxKind.QuestionQuestionEqualsToken,
])

export function inspectDataRouter(
  root: string,
  sources: Map<string, ts.SourceFile>,
  importsByFile: Map<string, Map<string, StaticRouteImport>>,
  components: StaticRouteComponent[],
  checker: ts.TypeChecker,
  configuredEntrypoints: string[],
): StaticRouteResult {
  const routes: StaticRouteResult['routes'] = []
  const unresolved: string[] = []
  let incomplete = false
  const byName = new Map(components.map(component => [`${component.file}#${component.name}`, component]))
  for (const component of components) if (component.isDefaultExport) byName.set(`${component.file}#default`, component)
  const fail = (file: string, node: ts.Node, message: string) => {
    incomplete = true
    unresolved.push(`data-router ${file}#${node.getStart()}: ${message}`)
  }

  // The HTML module entry is the executable root. Neither a conventional
  // filename nor a component named App proves that the project mounts it.
  // The bounded ProjectConfigGraph records explicit index.html module scripts.
  // `sources` is keyed by project-normalized absolute paths (forward slashes,
  // see project.ts); entry paths must be normalized the same way before the
  // lookup, otherwise Windows backslash paths never match and every
  // data-router proof fail-closes as "entry not statically available".
  const toSourceKey = (value: string) => path.resolve(value).replaceAll('\\', '/')
  const candidateEntrypoints = configuredEntrypoints
    .map(entry => [toSourceKey(entry), sources.get(toSourceKey(entry))] as const)
    .filter((entry): entry is readonly [string, ts.SourceFile] => Boolean(entry[1]))

  for (const [absolute, source] of sources) {
    const file = path.relative(root, absolute).replaceAll('\\', '/')
    const imports = importsByFile.get(absolute) ?? new Map()
    // TypeScript's binder handles lexical shadowing, including parameters and nested functions.
    const symbol = (id: ts.Identifier): ts.Symbol | undefined => checker.getSymbolAtLocation(id)
    const factorySymbols = new Set<ts.Symbol>()
    const providerSymbols = new Set<ts.Symbol>()
    const importSymbols = new Map<string, ts.Symbol>()
    for (const stmt of source.statements) {
      if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue
      if (stmt.importClause?.name) {
        const alias = symbol(stmt.importClause.name)
        if (alias) importSymbols.set(stmt.importClause.name.text, alias)
      }
      const names = stmt.importClause?.namedBindings
      if (!names || !ts.isNamedImports(names)) continue
      for (const item of names.elements) {
        const resolved = symbol(item.name)
        if (!resolved) continue
        importSymbols.set(item.name.text, resolved)
        if (stmt.moduleSpecifier.text !== 'react-router' && stmt.moduleSpecifier.text !== 'react-router-dom') continue
        if ((item.propertyName?.text ?? item.name.text) === 'createBrowserRouter') factorySymbols.add(resolved)
        if ((item.propertyName?.text ?? item.name.text) === 'RouterProvider') providerSymbols.add(resolved)
      }
    }
    if (!factorySymbols.size || !providerSymbols.size) continue

    const resolve = (expr: ts.Expression, seen = new Set<ts.Symbol>()): ts.Expression | undefined => {
      const raw = unwrap(expr)
      if (!ts.isIdentifier(raw)) return raw
      // In an object shorthand (`{ children }`), the identifier may bind to
      // the property symbol, not to the referenced lexical variable.
      const bound = ts.isShorthandPropertyAssignment(raw.parent)
        ? checker.getShorthandAssignmentValueSymbol(raw.parent) ?? symbol(raw)
        : symbol(raw)
      if (!bound || seen.has(bound)) return undefined
      const declaration = bound.declarations?.find(ts.isVariableDeclaration)
      if (!declaration?.initializer || !ts.isVariableDeclarationList(declaration.parent) ||
        !(declaration.parent.flags & ts.NodeFlags.Const)) return undefined
      seen.add(bound)
      return resolve(declaration.initializer, seen)
    }
    const resolveComponent = (expr: ts.Expression): StaticRouteComponent | undefined => {
      const raw = unwrap(expr)
      const tag = ts.isJsxElement(raw) ? raw.openingElement.tagName : ts.isJsxSelfClosingElement(raw) ? raw.tagName : undefined
      const id = ts.isIdentifier(raw) ? raw : tag && ts.isIdentifier(tag) ? tag : undefined
      if (!id) return undefined
      const declared = symbol(id)
      // An imported component must resolve to the *same binding* as the import.
      const imported = imports.get(id.text)
      if (imported && declared === importSymbols.get(id.text)) return byName.get(`${imported.file}#${imported.exportName}`)
      const local = byName.get(`${file}#${id.text}`)
      if (!local || !declared) return undefined
      // Never attribute a shadowed local variable to an unrelated component.
      const actual = declared.declarations ?? []
      return actual.some(d => d === local.node) &&
        components.filter(c => c.file === file && c.name === id.text).length === 1 ? local : undefined
    }
    const appCandidates = components.filter(c => c.file === file && c.name === 'App')
    if (appCandidates.length > 1) {
      fail(file, source, 'multiple App component declarations prevent unique entry ownership')
      continue
    }
    const app = appCandidates[0]
    if (!app) continue
    // Only JSX directly returned by the App component is an entry mount.
    // A JSX node in an unused helper or an unrelated function is NOT mounted.
    const owner = (() => {
      const n = app.node
      if (ts.isFunctionDeclaration(n)) return n
      if (ts.isVariableDeclaration(n) && n.initializer && (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))) return n.initializer
      return undefined
    })()
    if (!owner?.body) continue
    // Require exactly one *configured* and statically available entry. An
    // absent or ambiguous HTML entry cannot confer page-level source proof.
    if (configuredEntrypoints.length !== 1 || candidateEntrypoints.length !== 1) {
      fail(file, owner, 'application HTML module entry is missing, ambiguous or not statically available')
      continue
    }
    const [entryAbsolute, entrySource] = candidateEntrypoints[0]
    const imported = importsByFile.get(entryAbsolute) ?? new Map()
    const roots = new Set<ts.Symbol>()
    const namespaces = new Set<ts.Symbol>()
    for (const statement of entrySource.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) ||
          statement.moduleSpecifier.text !== 'react-dom/client') continue
      const names = statement.importClause?.namedBindings
      if (names && ts.isNamedImports(names)) for (const element of names.elements) {
        if ((element.propertyName?.text ?? element.name.text) !== 'createRoot') continue
        const bound = checker.getSymbolAtLocation(element.name)
        if (bound) roots.add(bound)
      }
      if (names && ts.isNamespaceImport(names)) {
        const bound = checker.getSymbolAtLocation(names.name)
        if (bound) namespaces.add(bound)
      }
    }
    const isCreateRoot = (expr: ts.Expression): boolean => {
      const raw = unwrap(expr)
      if (!ts.isCallExpression(raw)) return false
      const callee = raw.expression
      return ts.isIdentifier(callee) && roots.has(checker.getSymbolAtLocation(callee)!) ||
        ts.isPropertyAccessExpression(callee) && callee.name.text === 'createRoot' &&
        ts.isIdentifier(callee.expression) && namespaces.has(checker.getSymbolAtLocation(callee.expression)!)
    }
    const isReactRoot = (expr: ts.Expression): boolean => {
      const raw = unwrap(expr)
      if (isCreateRoot(raw)) return true
      if (!ts.isIdentifier(raw)) return false
      const declaration = checker.getSymbolAtLocation(raw)?.declarations?.find(ts.isVariableDeclaration)
      return Boolean(declaration?.initializer && declaration.parent.parent.parent === entrySource &&
        ts.isVariableDeclarationList(declaration.parent) && declaration.parent.flags & ts.NodeFlags.Const &&
        isCreateRoot(declaration.initializer))
    }
    const isAppTag = (tag: ts.JsxTagNameExpression): boolean => {
      if (!ts.isIdentifier(tag)) return false
      const target = imported.get(tag.text)
      if (target?.file !== file || !(target.exportName === 'App' || target.exportName === 'default' && app.isDefaultExport)) return false
      const binding = checker.getSymbolAtLocation(tag)
      return Boolean(binding && entrySource.statements.filter(ts.isImportDeclaration).some(stmt => {
        const clause = stmt.importClause
        const candidates = [clause?.name, ...(clause?.namedBindings && ts.isNamedImports(clause.namedBindings)
          ? clause.namedBindings.elements.map(element => element.name) : [])]
        return candidates.some(id => id?.text === tag.text && checker.getSymbolAtLocation(id) === binding)
      }))
    }
    // Only a direct top-level invocation of a React root is unconditionally
    // reachable. Do not descend into functions, classes, dead branches or
    // callbacks; a generic JavaScript call-graph is intentionally unsupported.
    const safeWrapper = (tag: ts.JsxTagNameExpression): boolean => {
      if (ts.isIdentifier(tag) && /^[a-z]/.test(tag.text)) return true // intrinsic hosts render children
      if (!ts.isIdentifier(tag) || tag.text !== 'StrictMode') return false
      const usedSymbol = checker.getSymbolAtLocation(tag)
      return entrySource.statements.some(statement => ts.isImportDeclaration(statement) &&
        ts.isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text === 'react' &&
        statement.importClause?.namedBindings && ts.isNamedImports(statement.importClause.namedBindings) &&
        statement.importClause.namedBindings.elements.some(item =>
          (item.propertyName?.text ?? item.name.text) === 'StrictMode' &&
          usedSymbol === checker.getSymbolAtLocation(item.name)))
    }
    const containsMountedApp = (node: ts.Node): boolean => {
      if (ts.isJsxSelfClosingElement(node)) return isAppTag(node.tagName)
      if (ts.isJsxElement(node)) return isAppTag(node.openingElement.tagName) ||
        (safeWrapper(node.openingElement.tagName) && node.children.some(child => containsMountedApp(child)))
      if (ts.isJsxFragment(node)) return node.children.some(child => containsMountedApp(child))
      if (ts.isJsxExpression(node) && node.expression &&
        (ts.isJsxElement(node.expression) || ts.isJsxSelfClosingElement(node.expression) || ts.isJsxFragment(node.expression))) {
        return containsMountedApp(node.expression)
      }
      return false
    }
    const reachable = entrySource.statements.some(statement => {
      if (!ts.isExpressionStatement(statement)) return false
      const call = unwrap(statement.expression)
      return ts.isCallExpression(call) && ts.isPropertyAccessExpression(call.expression) &&
        call.expression.name.text === 'render' && isReactRoot(call.expression.expression) &&
        call.arguments.length === 1 && containsMountedApp(call.arguments[0])
    })
    if (!reachable) {
      fail(file, owner, 'App is not proven reachable from an unconditional entrypoint React root render call')
      continue
    }
    const returned: ts.Expression[] = []
    if (ts.isArrowFunction(owner) && !ts.isBlock(owner.body)) returned.push(owner.body)
    else {
      const scanReturns = (n: ts.Node): void => {
        if (n !== owner && ts.isFunctionLike(n)) return
        if (ts.isReturnStatement(n) && n.expression) returned.push(n.expression)
        else n.forEachChild(scanReturns)
      }
      scanReturns(owner.body)
    }
    if (returned.length !== 1) {
      // Alternate branches or missing JSX cannot be asserted as full consumption.
      if (returned.length) fail(file, owner, 'App has multiple return paths; router coverage is conditional')
      continue
    }
    const mount = returned[0]
    const providers: Array<{ node: ts.Node; router: ts.Expression; conditional: boolean }> = []
    const inspectMount = (node: ts.Node, conditional = false): void => {
      if (ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node)) return
      const branch = conditional || ts.isConditionalExpression(node) || ts.isIfStatement(node) ||
        (ts.isBinaryExpression(node) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(node.operatorToken.kind))
      if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && ts.isIdentifier(node.tagName) && providerSymbols.has(symbol(node.tagName)!)) {
        const attribute = node.attributes.properties.filter(p => ts.isJsxAttribute(p) && ts.isIdentifier(p.name) && p.name.text === 'router')
        if (attribute.length === 1 && ts.isJsxAttribute(attribute[0]) && attribute[0].initializer &&
          ts.isJsxExpression(attribute[0].initializer) && attribute[0].initializer.expression) {
          providers.push({ node, router: attribute[0].initializer.expression, conditional: branch })
        } else fail(file, node, 'RouterProvider router binding is not uniquely identified')
      }
      node.forEachChild(child => inspectMount(child, branch))
    }
    inspectMount(mount)
    if (!providers.length) continue
    if (providers.length > 1) fail(file, mount, 'multiple RouterProviders prevent a unique active router')

    const visitedArrays = new Set<ts.ArrayLiteralExpression>()
    const visitedObjects = new Set<ts.ObjectLiteralExpression>()
    const visitArray = (expr: ts.ArrayLiteralExpression, prefix: string, layouts: StaticRouteComponent[], dynamic: boolean, stack: Set<ts.Node>): void => {
      if (stack.has(expr)) { fail(file, expr, 'cyclic route table'); return }
      stack.add(expr)
      visitedArrays.add(expr)
      for (const item of expr.elements) {
        if (ts.isSpreadElement(item)) {
          const value = resolve(item.expression)
          if (value && ts.isArrayLiteralExpression(value)) visitArray(value, prefix, layouts, dynamic, stack)
          else fail(file, item, 'unresolved spread route consumer')
          continue
        }
        const value = resolve(item)
        if (!value || !ts.isObjectLiteralExpression(value)) { fail(file, item, 'non-static route table member'); continue }
        visitedObjects.add(value)
        const names = value.properties.map(nameOf).filter((n): n is string => Boolean(n))
        if (new Set(names).size !== names.length || value.properties.some(p =>
          ts.isSpreadAssignment(p) || (p.name && ts.isComputedPropertyName(p.name)) ||
          ts.isMethodDeclaration(p) || ts.isGetAccessor(p) || ts.isSetAccessor(p))) {
          fail(file, value, 'overlapping or dynamic route object properties')
        }
        const componentValue = prop(value, 'Component') ?? prop(value, 'element')
        // The error boundary is a conditional alternate consumer. Until its
        // runtime mounting state is proven, a complete page impact is unsafe.
        if (prop(value, 'errorElement') || prop(value, 'ErrorBoundary') || prop(value, 'hydrateFallbackElement')) {
          fail(file, value, 'conditional route fallback consumer is not modeled')
        }
        if (prop(value, 'Component') && prop(value, 'element')) fail(file, value, 'conflicting Component and element')
        const index = prop(value, 'index')
        const isIndex = index?.kind === ts.SyntaxKind.TrueKeyword
        if (isIndex && prop(value, 'path')) fail(file, value, 'index route also declares path')
        const rawPath = prop(value, 'path')
        const pathExpr = rawPath && resolve(rawPath)
        if (rawPath && (!pathExpr || !(ts.isStringLiteral(pathExpr) || ts.isNoSubstitutionTemplateLiteral(pathExpr)))) {
          fail(file, value, 'nonliteral route path'); continue
        }
        if (index && !isIndex) { fail(file, value, 'conditional index route'); continue }
        const full = pathExpr && (ts.isStringLiteral(pathExpr) || ts.isNoSubstitutionTemplateLiteral(pathExpr))
          ? routeName(prefix, pathExpr.text) : prefix
        const unknownInstance = dynamic || /[:*?]/.test(full)
        const component = componentValue ? resolveComponent(componentValue) : undefined
        if (componentValue && !component) fail(file, value, 'route component import binding not proven')
        const children = prop(value, 'children')
        if (prop(value, 'lazy') || prop(value, 'loader') && !componentValue && !children) fail(file, value, 'runtime-dependent route consumer')
        if (component && (rawPath || isIndex || !children)) {
          for (const c of [...layouts, component]) routes.push({ page: full, componentId: c.id, sourceFile: file, offset: value.getStart(source), certain: !unknownInstance })
        }
        if (children) {
          const nested = resolve(children)
          if (nested && ts.isArrayLiteralExpression(nested)) visitArray(nested, full, component ? [...layouts, component] : layouts, unknownInstance, stack)
          else fail(file, children, 'unresolved children array')
        }
      }
      stack.delete(expr)
    }

    for (const provider of providers) {
      if (provider.conditional) fail(file, provider.node, 'conditional App RouterProvider mount')
      const call = resolve(provider.router)
      if (!call || !ts.isCallExpression(call) || !ts.isIdentifier(call.expression) || !factorySymbols.has(symbol(call.expression)!)) {
        fail(file, provider.node, 'RouterProvider binding does not resolve to the imported router factory')
        continue
      }
      if (call.arguments.length !== 1) { fail(file, call, 'router constructor has unsupported arguments'); continue }
      const table = resolve(call.arguments[0])
      if (!table || !ts.isArrayLiteralExpression(table)) { fail(file, call, 'router table is not statically bounded'); continue }
      visitArray(table, '/', [], false, new Set())
    }

    // Static const arrays are not immutable; modifications through aliases or
    // indexed writes invalidate the entire finite consumer set.
    const arrayTarget = (expr: ts.Expression): ts.ArrayLiteralExpression | undefined => {
      const resolved = resolve(expr)
      return resolved && ts.isArrayLiteralExpression(resolved) && visitedArrays.has(resolved) ? resolved : undefined
    }
    const objectTarget = (expr: ts.Expression): ts.ObjectLiteralExpression | undefined => {
      const resolved = resolve(expr)
      return resolved && ts.isObjectLiteralExpression(resolved) && visitedObjects.has(resolved) ? resolved : undefined
    }
    const walkMutations = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && !factorySymbols.has(symbol(node.expression)!) &&
        node.arguments.some(arg => !ts.isSpreadElement(arg) && Boolean(arrayTarget(arg)))) {
        fail(file, node, 'route array escapes to an unknown function')
      }
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
        arrayTarget(node.expression.expression) && !['map','filter','slice','every','some','find','includes','indexOf','at'].includes(node.expression.name.text) &&
        !mutators.has(node.expression.name.text)) fail(file, node, 'route array passed through a potentially mutating method')
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
        mutators.has(node.expression.name.text) && arrayTarget(node.expression.expression)) {
        fail(file, node, `route array mutated through ${node.expression.name.text}`)
      }
      if (ts.isBinaryExpression(node) && modifyingOps.has(node.operatorToken.kind)) {
        const left = unwrap(node.left)
        if (ts.isElementAccessExpression(left) && arrayTarget(left.expression) ||
          ts.isPropertyAccessExpression(left) && (objectTarget(left.expression) || ts.isElementAccessExpression(left.expression) && arrayTarget(left.expression.expression))) {
          fail(file, node, 'route table or route object mutated by assignment')
        }
      }
      if (ts.isDeleteExpression(node) && ts.isElementAccessExpression(node.expression) && arrayTarget(node.expression.expression)) fail(file, node, 'route table member deleted')
      node.forEachChild(walkMutations)
    }
    walkMutations(source)
  }
  return { routes, unresolved, incomplete }
}
