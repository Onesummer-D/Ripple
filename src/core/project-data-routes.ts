import * as path from 'node:path'
import ts from 'typescript'

/** Conservative static analysis of react-router data-router definitions.
 * A route declaration alone is not a mounted route: require a matching,
 * imported RouterProvider. Unresolvable route shapes never create proof edges.
 */
export interface StaticRouteComponent { id: string; name: string; file: string; isDefaultExport?: boolean }
export interface StaticRouteImport { file: string; exportName: string }
export interface StaticRouteResult {
  routes: Array<{ page: string; componentId: string; sourceFile: string; offset: number; certain: boolean }>
  unresolved: string[]
  incomplete: boolean
}

function prop(obj: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  const properties = obj.properties.filter(p =>
    (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) &&
    (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) && p.name.text === name)
  if (properties.length !== 1) return undefined
  const item = properties[0]
  return ts.isPropertyAssignment(item) ? item.initializer : item.name && ts.isIdentifier(item.name) ? item.name : undefined
}
function unwrap(expr: ts.Expression): ts.Expression {
  while (ts.isAsExpression(expr) || ts.isSatisfiesExpression(expr) || ts.isParenthesizedExpression(expr) || ts.isTypeAssertionExpression(expr)) expr = expr.expression
  return expr
}
const routeName = (parent: string, part: string) => part.startsWith('/')
  ? path.posix.normalize(part)
  : path.posix.normalize(`${parent.replace(/\/$/, '')}/${part}`)

export function inspectDataRouter(
  root: string,
  sources: Map<string, ts.SourceFile>,
  importsByFile: Map<string, Map<string, StaticRouteImport>>,
  components: StaticRouteComponent[],
): StaticRouteResult {
  const routes: StaticRouteResult['routes'] = []
  const unresolved: string[] = []
  let incomplete = false
  const byName = new Map(components.map(item => [`${item.file}#${item.name}`, item]))
  for (const component of components) if (component.isDefaultExport) byName.set(`${component.file}#default`, component)

  const fail = (file: string, node: ts.Node, message: string) => {
    incomplete = true
    unresolved.push(`data-router ${file}#${node.getStart()}: ${message}`)
  }

  for (const [absolute, source] of sources) {
    const file = path.relative(root, absolute).replaceAll('\\', '/')
    const imports = importsByFile.get(absolute) ?? new Map()
    const routerFactories = new Set<string>()
    const providerNames = new Set<string>()
    const staticVars = new Map<string, ts.Expression>()
    const routerVars = new Map<string, ts.CallExpression>()
    for (const stmt of source.statements) {
      if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier) &&
        (stmt.moduleSpecifier.text === 'react-router-dom' || stmt.moduleSpecifier.text === 'react-router')) {
        if (stmt.importClause?.namedBindings && ts.isNamedImports(stmt.importClause.namedBindings)) {
          for (const item of stmt.importClause.namedBindings.elements) {
            const imported = item.propertyName?.text ?? item.name.text
            if (imported === 'createBrowserRouter') routerFactories.add(item.name.text)
            if (imported === 'RouterProvider') providerNames.add(item.name.text)
          }
        }
      }
      if (ts.isVariableStatement(stmt)) {
        const constant = (stmt.declarationList.flags & ts.NodeFlags.Const) !== 0
        for (const dec of stmt.declarationList.declarations) {
          if (!ts.isIdentifier(dec.name) || !dec.initializer) continue
          if (constant) staticVars.set(dec.name.text, dec.initializer)
          const init = unwrap(dec.initializer)
          if (ts.isCallExpression(init) && ts.isIdentifier(init.expression) && routerFactories.has(init.expression.text)) routerVars.set(dec.name.text, init)
        }
      }
    }
    if (!routerFactories.size) continue
    // Route definitions are only proof if an imported RouterProvider actually
    // consumes this exact router binding in the current file.
    const mounted = new Set<string>()
    const visitProvider = (node: ts.Node) => {
      if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) &&
        ts.isIdentifier(node.tagName) && providerNames.has(node.tagName.text)) {
        const attribute = node.attributes.properties.find(p => ts.isJsxAttribute(p) && ts.isIdentifier(p.name) && p.name.text === 'router')
        if (attribute && ts.isJsxAttribute(attribute) && attribute.initializer &&
          ts.isJsxExpression(attribute.initializer) && attribute.initializer.expression &&
          ts.isIdentifier(attribute.initializer.expression)) {
          // A conditionally mounted provider does not prove that its route
          // consumers are active in every run. Preserve the known edges only
          // as partial topology, never as a complete Scope authorization.
          let parent: ts.Node | undefined = node.parent
          while (parent && !ts.isSourceFile(parent) && !ts.isFunctionDeclaration(parent) &&
            !ts.isArrowFunction(parent) && !ts.isFunctionExpression(parent)) {
            if (ts.isConditionalExpression(parent) || ts.isIfStatement(parent) ||
              ts.isBinaryExpression(parent) &&
                (parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
                 parent.operatorToken.kind === ts.SyntaxKind.BarBarToken)) {
              fail(file, node, 'conditional RouterProvider mount')
              break
            }
            parent = parent.parent
          }
          mounted.add(attribute.initializer.expression.text)
        }
      }
      node.forEachChild(visitProvider)
    }
    visitProvider(source)
    const resolveLocal = (expr: ts.Expression, seen = new Set<string>()): ts.Expression | undefined => {
      const raw = unwrap(expr)
      if (!ts.isIdentifier(raw)) return raw
      if (seen.has(raw.text) || !staticVars.has(raw.text)) return undefined
      seen.add(raw.text)
      return resolveLocal(staticVars.get(raw.text)!, seen)
    }
    const resolveComponent = (expr: ts.Expression): StaticRouteComponent | undefined => {
      const raw = unwrap(expr)
      const name = ts.isIdentifier(raw) ? raw.text : ts.isJsxElement(raw) || ts.isJsxSelfClosingElement(raw)
        ? ts.isIdentifier(ts.isJsxElement(raw) ? raw.openingElement.tagName : raw.tagName)
          ? (ts.isJsxElement(raw) ? raw.openingElement.tagName : raw.tagName).getText(source)
          : undefined : undefined
      if (!name) return undefined
      const target = imports.get(name)
      return target ? byName.get(`${target.file}#${target.exportName}`) : byName.get(`${file}#${name}`)
    }
    const emit = (node: ts.ObjectLiteralExpression, prefix: string, layouts: StaticRouteComponent[], inheritedDynamic: boolean, stack: Set<ts.Node>) => {
      // An object spread or computed key can overwrite a previously visible
      // path/component/children. The known fields remain useful diagnostics,
      // but the route table as a whole is not full source proof.
      if (node.properties.some(item => ts.isSpreadAssignment(item) ||
        ('name' in item && item.name && ts.isComputedPropertyName(item.name)) ||
        ts.isMethodDeclaration(item) || ts.isGetAccessor(item) || ts.isSetAccessor(item))) {
        fail(file, node, 'route object has dynamic or overriding properties')
      }
      if (prop(node, 'Component') && prop(node, 'element')) fail(file, node, 'conflicting Component and element fields')
      if (prop(node, 'index')?.kind === ts.SyntaxKind.TrueKeyword && prop(node, 'path')) fail(file, node, 'index route also declares a path')
      const rawPath = prop(node, 'path')
      const indexExpr = prop(node, 'index')
      const isIndex = indexExpr?.kind === ts.SyntaxKind.TrueKeyword
      const pathExpr = rawPath && resolveLocal(rawPath)
      if (rawPath && (!pathExpr || (!ts.isStringLiteral(pathExpr) && !ts.isNoSubstitutionTemplateLiteral(pathExpr)))) {
        fail(file, node, 'non-literal route path'); return
      }
      if (!rawPath && indexExpr && !isIndex) { fail(file, node, 'conditional index route'); return }
      const full = pathExpr && (ts.isStringLiteral(pathExpr) || ts.isNoSubstitutionTemplateLiteral(pathExpr))
        ? routeName(prefix, pathExpr.text) : prefix
      const dynamic = inheritedDynamic || /[:*?]/.test(full)
      const componentValue = prop(node, 'Component') ?? prop(node, 'element')
      const component = componentValue ? resolveComponent(componentValue) : undefined
      if (componentValue && !component) fail(file, node, 'component binding cannot be proven')
      if (prop(node, 'lazy') || prop(node, 'loader') && !componentValue && !prop(node, 'children')) fail(file, node, 'runtime-dependent route component')
      const currentLayouts = [...layouts]
      const childrenValue = prop(node, 'children')
      const isLayout = Boolean(childrenValue)
      if (component && isLayout) currentLayouts.push(component)
      if ((rawPath || isIndex || !childrenValue) && component) {
        for (const item of [...layouts, component]) routes.push({ page: full, componentId: item.id, sourceFile: file, offset: node.getStart(source), certain: !dynamic })
      }
      if (childrenValue) {
        const children = resolveLocal(childrenValue)
        if (!children || !ts.isArrayLiteralExpression(children)) fail(file, childrenValue, 'children is not a statically bounded array')
        else visitArray(children, full, currentLayouts, dynamic, stack)
      }
    }
    const visitArray = (expr: ts.ArrayLiteralExpression, parent: string, layouts: StaticRouteComponent[], dynamic: boolean, stack: Set<ts.Node>) => {
      if (stack.has(expr)) { fail(file, expr, 'cyclic route array'); return }
      stack.add(expr)
      for (const element of expr.elements) {
        if (ts.isSpreadElement(element)) {
          const spread = resolveLocal(element.expression)
          if (spread && ts.isArrayLiteralExpression(spread)) visitArray(spread, parent, layouts, dynamic, stack)
          else fail(file, element, 'unresolved spread route consumer')
          continue
        }
        const value = resolveLocal(element)
        if (value && ts.isObjectLiteralExpression(value)) emit(value, parent, layouts, dynamic, stack)
        else fail(file, element, 'non-static route table member')
      }
      stack.delete(expr)
    }
    for (const [name, call] of routerVars) {
      if (!mounted.has(name)) continue
      const arg = call.arguments[0] && resolveLocal(call.arguments[0])
      if (arg && ts.isArrayLiteralExpression(arg)) visitArray(arg, '/', [], false, new Set())
      else fail(file, call, 'mounted router does not have a static route table')
    }
    // A recognized factory without a provably mounted RouterProvider provides
    // no source-proven page identity; do not invent a runtime consumer.
    if (routerVars.size && ![...routerVars.keys()].some(x => mounted.has(x))) {
      fail(file, [...routerVars.values()][0], 'router was not proven mounted by RouterProvider')
    }
  }
  return { routes, unresolved, incomplete }
}
