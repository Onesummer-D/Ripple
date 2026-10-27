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

export interface DeclarativeRouteResult {
  routes: Array<{ page: string; componentId?: string; sourceFile: string; offset: number; certain: boolean }>
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
    // AC-P2b (+P0 rework): prove `lazy: () => import('./Page')` per the actual
    // react-router 6/7 route.lazy contract. The lazy function imports a ROUTE
    // OBJECT whose properties are merged into the route, so the page component
    // is the target module's named `Component` export (ErrorBoundary works the
    // same way). A module `default` export is NOT a valid lazy route property
    // and must not become a source-proven page consumer — this deliberately
    // differs from React.lazy(), whose contract is the default export and
    // which is never proven here. Only a single arrow (or single-return
    // function) whose body is one dynamic import with a string literal
    // specifier resolving into the project, whose target module statically
    // provides exactly one component named `Component`, is proven. Anything
    // more dynamic (chained .then, computed specifiers, multiple returns),
    // default-only targets, or ambiguous Component exports stays fail-closed.
    const resolveLazyComponent = (expr: ts.Expression): string | undefined => {
      const fn = unwrap(expr)
      let body: ts.ConciseBody | undefined
      if (ts.isArrowFunction(fn)) body = fn.body
      else if (ts.isFunctionExpression(fn)) body = fn.body
      if (!body) return undefined
      let call: ts.Expression | undefined
      if (ts.isBlock(body)) {
        const returns = body.statements.filter(ts.isReturnStatement)
        if (returns.length !== 1 || !returns[0].expression) return undefined
        call = returns[0].expression
      } else call = body
      call = unwrap(call)
      if (!ts.isCallExpression(call) || call.expression.kind !== ts.SyntaxKind.ImportKeyword ||
          call.arguments.length !== 1 || !ts.isStringLiteral(call.arguments[0])) return undefined
      const resolved = ts.resolveModuleName(call.arguments[0].text, path.join(root, file), { moduleResolution: ts.ModuleResolutionKind.Bundler }, ts.sys)
        .resolvedModule?.resolvedFileName
      if (!resolved) return undefined
      const targetFile = path.relative(root, resolved).replaceAll('\\', '/')
      if (targetFile.startsWith('..')) return undefined
      // route.lazy provides ROUTE OBJECT properties: only a module export
      // literally named `Component` can supply the page component, and it must
      // bind to exactly one statically known JSX component declaration IN THIS
      // MODULE. An internal (unexported) component declaration, a re-export
      // whose declaration lives in another file, or an unresolvable alias all
      // stay fail-closed.
      const targetSource = sources.get(toSourceKey(resolved))
      const moduleSymbol = targetSource ? checker.getSymbolAtLocation(targetSource) : undefined
      if (!moduleSymbol) return undefined
      const exported = checker.getExportsOfModule(moduleSymbol).filter(item => item.name === 'Component')
      if (exported.length !== 1) return undefined
      // A type-only export (`export type { X as Component }`, or the inline
      // `export { type X as Component }`) creates NO runtime module property,
      // so route.lazy would find no Component at runtime. Require at least one
      // value export declaration; otherwise this proof stays fail-closed even
      // if the alias resolves to a component declaration in this file.
      const exportDeclarations = exported[0].declarations ?? []
      const isTypeOnlySpecifier = (declaration: ts.Declaration): boolean => {
        if (!ts.isExportSpecifier(declaration)) return false
        if (declaration.isTypeOnly) return true
        const named = declaration.parent
        return ts.isNamedExports(named) && ts.isExportDeclaration(named.parent) && named.parent.isTypeOnly
      }
      const hasValueExport = exportDeclarations.some(declaration => !isTypeOnlySpecifier(declaration))
      if (!hasValueExport) return undefined
      const bound = exported[0].flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported[0]) : exported[0]
      const boundDeclarations = bound.declarations ?? []
      const matches = components.filter(c => c.file === targetFile && boundDeclarations.some(declaration => declaration === c.node))
      return matches.length === 1 ? matches[0].id : undefined
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
    // A single explicit return is only fully consuming when no control-flow
    // path can skip it: `if (c) return <RouterProvider/>` leaves the implicit
    // undefined path unproven, so the mount itself is conditional.
    const guardedKinds = new Set([
      ts.SyntaxKind.IfStatement, ts.SyntaxKind.ConditionalExpression,
      ts.SyntaxKind.SwitchStatement, ts.SyntaxKind.CaseClause, ts.SyntaxKind.DefaultClause,
      ts.SyntaxKind.ForStatement, ts.SyntaxKind.ForInStatement, ts.SyntaxKind.ForOfStatement,
      ts.SyntaxKind.WhileStatement, ts.SyntaxKind.DoStatement,
      ts.SyntaxKind.TryStatement, ts.SyntaxKind.CatchClause,
    ])
    const isGuardedReturn = (statement: ts.ReturnStatement): boolean => {
      let ancestor: ts.Node | undefined = statement.parent
      while (ancestor && ancestor !== owner) {
        if (guardedKinds.has(ancestor.kind)) return true
        if (ts.isBinaryExpression(ancestor) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(ancestor.operatorToken.kind)) return true
        ancestor = ancestor.parent
      }
      return false
    }
    const returned: ts.Expression[] = []
    let returnIsGuarded = false
    if (ts.isArrowFunction(owner) && !ts.isBlock(owner.body)) returned.push(owner.body)
    else {
      const scanReturns = (n: ts.Node): void => {
        if (n !== owner && ts.isFunctionLike(n)) return
        if (ts.isReturnStatement(n) && n.expression) {
          returned.push(n.expression)
          if (isGuardedReturn(n)) returnIsGuarded = true
        } else n.forEachChild(scanReturns)
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
    inspectMount(mount, returnIsGuarded)
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
        // AC-P2b: model statically provable data-router fallback/conditional
        // consumers instead of blanket fail-closing every fallback key.
        // JSX-valued keys (errorElement, hydrateFallbackElement) and
        // component-reference keys (ErrorBoundary, HydrateFallback) join the
        // route consumption graph only when they resolve through the same
        // binding provenance as element/Component; anything else keeps a
        // locatable fail-closed unresolved entry. A provable fallback is a
        // real consumer of the same page (it renders in that route's error
        // state), so it is pushed with the same page/certainty discipline.
        for (const key of ['errorElement', 'hydrateFallbackElement', 'ErrorBoundary', 'HydrateFallback'] as const) {
          const rawFallback = prop(value, key)
          if (!rawFallback) continue
          const fallback = resolveComponent(rawFallback)
          if (!fallback) { fail(file, value, `${key} fallback consumer is not statically provable`); continue }
          if (rawPath || isIndex || !children) {
            routes.push({ page: full, componentId: fallback.id, sourceFile: file, offset: value.getStart(source), certain: !unknownInstance })
          }
        }
        const lazyValue = prop(value, 'lazy')
        let lazyComponent: string | undefined
        if (lazyValue && !componentValue) {
          lazyComponent = resolveLazyComponent(lazyValue)
          if (!lazyComponent) fail(file, value, 'runtime-dependent route consumer')
        }
        if (prop(value, 'loader') && !componentValue && !children) fail(file, value, 'runtime-dependent route consumer')
        if (component && (rawPath || isIndex || !children)) {
          for (const c of [...layouts, component]) routes.push({ page: full, componentId: c.id, sourceFile: file, offset: value.getStart(source), certain: !unknownInstance })
        }
        if (lazyComponent && (rawPath || isIndex || !children)) {
          routes.push({ page: full, componentId: lazyComponent, sourceFile: file, offset: value.getStart(source), certain: !unknownInstance })
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
    // indexed writes invalidate the entire finite consumer set. Alias tracking
    // intentionally goes beyond `resolve`: a `let alias = routes` is invisible
    // to the const-only resolver, and `const first = routes[0]` hands out a
    // mutable element reference. Both are followed here; any write through
    // them fail-closes the whole route table.
    // Bindings like `const selected = routes[key]` hand out a mutable element
    // reference through an index the analysis cannot prove. Any later write
    // through such a binding (including alias chains and `let` rebinding)
    // must fail-close the whole route table.
    const resolveAlias = (expr: ts.Expression, seen = new Set<ts.Symbol>()): ts.Expression | undefined => {
      const raw = unwrap(expr)
      if (ts.isElementAccessExpression(raw)) {
        // Dereference one static index (`const first = routes[0]`) so later
        // property writes on the element are attributed to the visited table.
        // Non-literal indices stay unresolvable rather than guessing.
        if (ts.isNumericLiteral(raw.argumentExpression)) {
          const target = resolveAlias(raw.expression, seen)
          if (target && ts.isArrayLiteralExpression(target) && visitedArrays.has(target)) {
            const element = target.elements[Number(raw.argumentExpression.text)]
            if (element) {
              if (ts.isSpreadElement(element)) return resolveAlias(element.expression, seen)
              if (ts.isObjectLiteralExpression(element)) return element
              return resolve(element, seen)
            }
          }
        }
        return undefined
      }
      if (!ts.isIdentifier(raw)) return raw
      const bound = symbol(raw)
      if (!bound || seen.has(bound)) return undefined
      const declaration = bound.declarations?.find(ts.isVariableDeclaration)
      if (!declaration?.initializer) return undefined
      seen.add(bound)
      // Unlike `resolve`, follow `let` aliases too: mutations do not need the
      // const provenance that route-table resolution requires.
      return resolveAlias(declaration.initializer, seen)
    }
    // Re-derived at each write site (never cached): the chain is followed from
    // the written identifier through forwarding aliases; a `let` binding whose
    // current value is the visited table itself is treated conservatively,
    // because a rebinding may have handed it a fuzzily selected element.
    // The seen set bounds the walk, so circular alias chains neither loop
    // nor crash; an unprovable chain degrades instead of guessing.
    const fuzzyWriteTarget = (expr: ts.Expression, seen = new Set<ts.Symbol>()): boolean => {
      const raw = unwrap(expr)
      if (!ts.isIdentifier(raw)) return false
      const bound = symbol(raw)
      if (!bound) return false
      if (seen.has(bound)) return true // circular alias chain: unprovable, fail closed
      seen.add(bound)
      const declaration = bound.declarations?.find(ts.isVariableDeclaration)
      if (!declaration?.initializer) return false
      const initial = unwrap(declaration.initializer)
      if (ts.isElementAccessExpression(initial)) {
        if (ts.isNumericLiteral(initial.argumentExpression) || ts.isPrefixUnaryExpression(initial.argumentExpression)) return false
        const target = resolveAlias(initial.expression, new Set(seen))
        return Boolean(target && ts.isArrayLiteralExpression(target) && visitedArrays.has(target))
      }
      if (ts.isArrayLiteralExpression(initial) && visitedArrays.has(initial)) {
        return Boolean(declaration.parent.flags & ts.NodeFlags.Let)
      }
      return fuzzyWriteTarget(initial, seen)
    }
    const arrayTarget = (expr: ts.Expression): ts.ArrayLiteralExpression | undefined => {
      const resolved = resolveAlias(expr)
      return resolved && ts.isArrayLiteralExpression(resolved) && visitedArrays.has(resolved) ? resolved : undefined
    }
    const objectTarget = (expr: ts.Expression): ts.ObjectLiteralExpression | undefined => {
      const resolved = resolveAlias(expr)
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
        // A property write through a binding selected with an unprovable index
        // (`selected.Component = Home`, including alias chains and `let`
        // rebinding) mutates an unknown member of the visited table even
        // though const-only resolution cannot attribute it.
        const writtenRoot =
          ts.isPropertyAccessExpression(left) && ts.isIdentifier(left.expression) ? left.expression
          : ts.isElementAccessExpression(left) && ts.isStringLiteral(left.argumentExpression) && ts.isIdentifier(left.expression) ? left.expression
          : undefined
        if (writtenRoot && fuzzyWriteTarget(writtenRoot)) {
          fail(file, node, 'route table member mutated through a non-numeric index selection')
        }
        // Reassigning a variable that was bound to the visited table hands the
        // table to a name whose later writes can no longer be attributed.
        if (ts.isIdentifier(left)) {
          const declaration = symbol(left)?.declarations?.find(ts.isVariableDeclaration)
          const initial = declaration?.initializer && resolve(declaration.initializer)
          if (initial && (ts.isArrayLiteralExpression(initial) && visitedArrays.has(initial) ||
            ts.isObjectLiteralExpression(initial) && visitedObjects.has(initial))) {
            fail(file, node, 'route table or route object alias reassigned')
          }
        }
      }
      if (ts.isDeleteExpression(node) && ts.isElementAccessExpression(node.expression) && arrayTarget(node.expression.expression)) fail(file, node, 'route table member deleted')
      node.forEachChild(walkMutations)
    }
    walkMutations(source)
  }
  return { routes, unresolved, incomplete }
}

/**
 * Recognizes a conservative subset of React Router declarative routes inside
 * the project's `App` component. Only literal paths beneath imported Router /
 * Routes / Route bindings are recorded. Lazy page components are followed only
 * through a single `lazy(() => import("./Page"))` expression with a unique
 * default component export; other route shapes remain incomplete.
 */
export function inspectDeclarativeRoutes(
  root: string,
  sources: Map<string, ts.SourceFile>,
  components: StaticRouteComponent[],
  checker: ts.TypeChecker,
): DeclarativeRouteResult {
  const routes: DeclarativeRouteResult['routes'] = []
  const unresolved: string[] = []
  let incomplete = false
  const byDeclaration = new Map(components.map(component => [component.node, component]))
  const normalizeFile = (value: string) => path.resolve(value).replaceAll('\\', '/')
  const componentFromSymbol = (raw: ts.Symbol | undefined): StaticRouteComponent | undefined => {
    if (!raw) return undefined
    const symbol = raw.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(raw) : raw
    const declarations = symbol.declarations ?? []
    const matches = declarations.flatMap(declaration => {
      const component = byDeclaration.get(declaration)
      return component ? [component] : []
    })
    return matches.length === 1 ? matches[0] : undefined
  }
  const isReactLazy = (callee: ts.Expression): boolean => {
    let binding: ts.Identifier | undefined
    let namespace = false
    if (ts.isIdentifier(callee)) binding = callee
    else if (ts.isPropertyAccessExpression(callee) && callee.name.text === 'lazy' && ts.isIdentifier(callee.expression)) {
      binding = callee.expression
      namespace = true
    }
    if (!binding) return false
    const symbol = checker.getSymbolAtLocation(binding)
    return Boolean(symbol?.declarations?.some(declaration => {
      if (namespace && ts.isNamespaceImport(declaration)) {
        const clause = declaration.parent.parent
        return ts.isImportDeclaration(clause) && ts.isStringLiteral(clause.moduleSpecifier) && clause.moduleSpecifier.text === 'react'
      }
      if (!namespace && ts.isImportSpecifier(declaration)) {
        const clause = declaration.parent.parent.parent
        return ts.isImportDeclaration(clause) && ts.isStringLiteral(clause.moduleSpecifier) && clause.moduleSpecifier.text === 'react' &&
          (declaration.propertyName?.text ?? declaration.name.text) === 'lazy'
      }
      return false
    }))
  }
  const resolveLazyDefault = (symbol: ts.Symbol | undefined, containingFile: string): StaticRouteComponent | undefined => {
    const declaration = symbol?.declarations?.find(ts.isVariableDeclaration)
    const initializer = declaration?.initializer && unwrap(declaration.initializer)
    if (!initializer || !ts.isCallExpression(initializer)) return undefined
    const callee = unwrap(initializer.expression)
    if (!isReactLazy(callee) || initializer.arguments.length !== 1) return undefined
    const callback = unwrap(initializer.arguments[0])
    const body = ts.isArrowFunction(callback) || ts.isFunctionExpression(callback) ? callback.body : undefined
    const importCall = body && !ts.isBlock(body) ? unwrap(body) : undefined
    if (!importCall || !ts.isCallExpression(importCall) || importCall.expression.kind !== ts.SyntaxKind.ImportKeyword ||
        importCall.arguments.length !== 1 || !ts.isStringLiteral(importCall.arguments[0])) return undefined
    const resolved = ts.resolveModuleName(importCall.arguments[0].text, containingFile,
      { moduleResolution: ts.ModuleResolutionKind.Bundler, allowJs: true, jsx: ts.JsxEmit.Preserve }, ts.sys).resolvedModule?.resolvedFileName
    if (!resolved || path.relative(root, resolved).startsWith('..')) return undefined
    const target = sources.get(normalizeFile(resolved))
    const moduleSymbol = target && checker.getSymbolAtLocation(target)
    const exportedDefault = moduleSymbol && checker.getExportsOfModule(moduleSymbol).filter(item => item.name === 'default')
    if (!exportedDefault || exportedDefault.length !== 1) return undefined
    return componentFromSymbol(exportedDefault[0])
  }
  const sameBinding = (left: ts.Symbol | undefined, right: ts.Symbol | undefined): boolean => {
    if (!left || !right) return false
    if (left === right) return true
    const resolveAlias = (symbol: ts.Symbol) => symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol
    return resolveAlias(left) === resolveAlias(right)
  }
  const jsxTagBinding = (node: ts.JsxOpeningLikeElement, expected: string, imports: Map<string, ts.Symbol>) =>
    ts.isIdentifier(node.tagName) && node.tagName.text === expected &&
    sameBinding(checker.getSymbolAtLocation(node.tagName), imports.get(expected))
  const jsxAncestorBinding = (node: ts.Node, expected: string, imports: Map<string, ts.Symbol>) =>
    ts.isJsxElement(node) ? jsxTagBinding(node.openingElement, expected, imports) :
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) ? jsxTagBinding(node, expected, imports) : false

  for (const [absolute, source] of sources) {
    const file = path.relative(root, absolute).replaceAll('\\', '/')
    const appCandidates = components.filter(component => component.file === file && component.name === 'App')
    if (!appCandidates.length) continue
    if (appCandidates.length !== 1) {
      incomplete = true
      unresolved.push(`declarative-router ${file}: multiple App declarations prevent unique route ownership`)
      continue
    }
    const app = appCandidates[0]
    const routerImports = new Map<string, ts.Symbol>()
    const routerRoles = new Map<string, string>()
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) ||
          !['react-router', 'react-router-dom'].includes(statement.moduleSpecifier.text)) continue
      const bindings = statement.importClause?.namedBindings
      if (!bindings || !ts.isNamedImports(bindings)) continue
      for (const specifier of bindings.elements) {
        const importedName = specifier.propertyName?.text ?? specifier.name.text
        if (['Route', 'Routes', 'HashRouter', 'BrowserRouter', 'MemoryRouter'].includes(importedName)) {
          const symbol = checker.getSymbolAtLocation(specifier.name)
          if (symbol) {
            routerImports.set(specifier.name.text, symbol)
            routerRoles.set(specifier.name.text, importedName)
          }
        }
      }
    }
    const routeBinding = [...routerImports.entries()].find(([name]) => routerRoles.get(name) === 'Route')
    const routesBinding = [...routerImports.entries()].find(([name]) => routerRoles.get(name) === 'Routes')
    const routerNames = [...routerImports.keys()].filter(name => {
      const role = routerRoles.get(name)
      return role !== undefined && ['HashRouter', 'BrowserRouter', 'MemoryRouter'].includes(role)
    })
    if (!routeBinding || !routesBinding || !routerNames.length) continue

    const routeElements: ts.JsxOpeningLikeElement[] = []
    const collect = (node: ts.Node) => {
      if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
          jsxTagBinding(node, routeBinding[0], routerImports)) routeElements.push(node)
      node.forEachChild(collect)
    }
    collect(app.node)
    for (const routeElement of routeElements) {
      const insideRoutes = (ancestor: ts.Node): boolean => {
        for (let current: ts.Node | undefined = ancestor; current && current !== app.node; current = current.parent) {
          if (jsxAncestorBinding(current, routesBinding[0], routerImports)) return true
        }
        return false
      }
      const insideRouter = (ancestor: ts.Node): boolean => {
        for (let current: ts.Node | undefined = ancestor; current && current !== app.node; current = current.parent) {
          if (routerNames.some(name => jsxAncestorBinding(current, name, routerImports))) return true
        }
        return false
      }
      if (!insideRoutes(routeElement) || !insideRouter(routeElement)) continue
      const attributes = routeElement.attributes.properties.filter(ts.isJsxAttribute)
      const pathAttributes = attributes.filter(attribute => attribute.name.getText(source) === 'path')
      const elementAttributes = attributes.filter(attribute => attribute.name.getText(source) === 'element')
      if (pathAttributes.length !== 1 || !pathAttributes[0].initializer || !ts.isStringLiteral(pathAttributes[0].initializer)) {
        incomplete = true
        unresolved.push(`declarative-router ${file}#${routeElement.getStart(source)}: route path is dynamic, absent or ambiguous`)
        continue
      }
      const page = path.posix.normalize(pathAttributes[0].initializer.text)
      if (!page.startsWith('/') || /[?#]/.test(page)) {
        incomplete = true
        unresolved.push(`declarative-router ${file}#${routeElement.getStart(source)}: route path cannot be normalized exactly`)
        continue
      }
      const elementExpression = elementAttributes.length === 1 && elementAttributes[0].initializer &&
        ts.isJsxExpression(elementAttributes[0].initializer) ? elementAttributes[0].initializer.expression : undefined
      const jsx = elementExpression && (ts.isJsxElement(elementExpression) || ts.isJsxSelfClosingElement(elementExpression))
        ? elementExpression : undefined
      const tag = jsx && (ts.isJsxElement(jsx) ? jsx.openingElement.tagName : jsx.tagName)
      const tagSymbol = tag && ts.isIdentifier(tag) ? checker.getSymbolAtLocation(tag) : undefined
      const target = componentFromSymbol(tagSymbol) ?? resolveLazyDefault(tagSymbol, absolute)
      const certain = Boolean(target && elementAttributes.length === 1)
      if (!certain) {
        incomplete = true
        unresolved.push(`declarative-router ${file}#${routeElement.getStart(source)}: route component is not a unique tracked component`)
      }
      routes.push({ page, ...(target ? { componentId: target.id } : {}), sourceFile: file,
        offset: routeElement.getStart(source), certain })
    }
  }
  return { routes, unresolved, incomplete }
}

