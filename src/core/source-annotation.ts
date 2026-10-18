import * as path from 'node:path'
import ts from 'typescript'
import type { Plugin } from 'vite'

interface Component { node: ts.Node; ownerId: string; identityId: string }

const hasJsx = (node: ts.Node): boolean => ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || (node.forEachChild(hasJsx) ?? false)
const componentName = (node: ts.Node): string | undefined => {
  if (ts.isFunctionDeclaration(node)) return node.name?.text
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) return node.name.text
  return undefined
}
const jsxKey = (node: ts.JsxOpeningLikeElement, source: ts.SourceFile): string | undefined => {
  const key = node.attributes.properties.find(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(source) === 'key')
  if (!key || !ts.isJsxAttribute(key)) return undefined
  if (key.initializer && ts.isJsxExpression(key.initializer) && key.initializer.expression) return key.initializer.expression.getText(source)
  if (key.initializer && ts.isStringLiteral(key.initializer)) return JSON.stringify(key.initializer.text)
  return undefined
}
const jsxKeyForNode = (node: ts.Node, source: ts.SourceFile): string | undefined => {
  if (ts.isJsxElement(node)) return jsxKey(node.openingElement, source)
  if (ts.isJsxSelfClosingElement(node)) return jsxKey(node, source)
  return undefined
}

export function sourceAnnotationPlugin(projectRoot: string): Plugin {
  const root = path.resolve(projectRoot)
  const identityModule = `\0ripple:identity`
  const identityRuntime = `import { createContext, createElement, useContext } from 'react'
const RippleIdentityContext = createContext(null)
export function useRippleIdentity() { return useContext(RippleIdentityContext) }
export function RippleIdentity({ instanceKey, sourceRef, certainty, children }) {
  const parent = useRippleIdentity()
  const identityCertainty = certainty === 'position-dependent' || parent?.certainty === 'position-dependent' ? 'position-dependent' : certainty === 'unknown' || parent?.certainty === 'unknown' ? 'unknown' : certainty
  const identity = { path: [parent?.path, sourceRef, instanceKey].filter(Boolean).join('/'), certainty: identityCertainty }
  return createElement(RippleIdentityContext.Provider, { value: identity }, children)
}
`
  return {
    name: 'ripple-runtime-source-annotation',
    enforce: 'pre',
    apply: 'serve',
    resolveId(id) { return id === 'virtual:ripple-identity' ? identityModule : undefined },
    load(id) { return id === identityModule ? identityRuntime : undefined },
    transform(code, id) {
      const file = path.resolve(id.split('?')[0])
      const relative = path.relative(root, file)
      if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) ||
        !/\.(tsx|jsx)$/i.test(file) || relative.split(path.sep).includes('node_modules')) return null

      const scriptKind = /\.jsx$/i.test(file) ? ts.ScriptKind.JSX : ts.ScriptKind.TSX
      const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, scriptKind)
      const components: Component[] = []
      const usedNames = new Set<string>()
      const generatedName = (base: string) => {
        let name = base
        while (usedNames.has(name) || new RegExp(`\\b${name}\\b`).test(code)) name += '_'
        usedNames.add(name)
        return name
      }
      const findComponents = (node: ts.Node) => {
        const name = componentName(node)
        if (name && /^[A-Z]/.test(name) && hasJsx(node)) {
          components.push({ node, ownerId: generatedName(`__rippleOwner${node.getStart(source)}`), identityId: generatedName(`__rippleIdentity${node.getStart(source)}`) })
        }
        node.forEachChild(findComponents)
      }
      findComponents(source)

      const insertions: Array<{ position: number; text: string }> = []
      const componentOwners = components.map(component => {
        const implementation = ts.isVariableDeclaration(component.node) ? component.node.initializer! : component.node
        const body = ts.isArrowFunction(implementation) || ts.isFunctionExpression(implementation) || ts.isFunctionDeclaration(implementation)
          ? implementation.body : undefined
        if (!body) return undefined
        if (ts.isBlock(body)) insertions.push({ position: body.getStart(source) + 1, text: `\nconst ${component.ownerId} = __rippleUseId(); const ${component.identityId} = __rippleUseIdentity();` })
        else {
          insertions.push({ position: body.getStart(source), text: `{\nconst ${component.ownerId} = __rippleUseId(); const ${component.identityId} = __rippleUseIdentity();\nreturn (` })
          insertions.push({ position: body.getEnd(), text: ');\n}' })
        }
        return { ...component, body }
      }).filter((owner): owner is Component & { body: ts.ConciseBody } => !!owner)

      const ownerFor = (node: ts.Node) => componentOwners
        .filter(owner => owner.node.pos <= node.pos && owner.node.end >= node.end)
        .sort((left, right) => (left.node.end - left.node.pos) - (right.node.end - right.node.pos))[0]

      const mapIndexes = new Map<ts.Node, string | undefined>()
      const mapIndexFor = (callback: ts.ArrowFunction | ts.FunctionExpression): string | undefined => {
        if (mapIndexes.has(callback)) return mapIndexes.get(callback)
        const existing = callback.parameters[1]
        if (existing) {
          const value = ts.isIdentifier(existing.name) ? existing.name.text : undefined
          mapIndexes.set(callback, value)
          return value
        }
        const indexName = generatedName(`__rippleIndex${callback.getStart(source)}`)
        const params = callback.parameters
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

      const enclosingMapCallbacks = (candidate: ts.Node, stopAt: ts.Node): Array<ts.ArrowFunction | ts.FunctionExpression> => {
        const callbacks: Array<ts.ArrowFunction | ts.FunctionExpression> = []
        let current: ts.Node | undefined = candidate
        while (current && current !== stopAt) {
          if ((ts.isArrowFunction(current) || ts.isFunctionExpression(current)) && ts.isCallExpression(current.parent) &&
            ts.isPropertyAccessExpression(current.parent.expression) && current.parent.expression.name.text === 'map') callbacks.unshift(current)
          current = current.parent
        }
        return callbacks
      }

      const jsxRoots = (node: ts.Node): ts.Node[] => {
        if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) return [node]
        if (ts.isParenthesizedExpression(node)) return jsxRoots(node.expression)
        if (ts.isConditionalExpression(node)) return [...jsxRoots(node.whenTrue), ...jsxRoots(node.whenFalse)]
        if (ts.isBinaryExpression(node) && (node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken || node.operatorToken.kind === ts.SyntaxKind.BarBarToken)) return jsxRoots(node.right)
        return []
      }

      const mapCallbackHasStableKey = (callback: ts.ArrowFunction | ts.FunctionExpression): boolean => {
        const expressions: ts.Node[] = []
        if (ts.isBlock(callback.body)) {
          const collectReturns = (node: ts.Node) => {
            if (ts.isReturnStatement(node) && node.expression) expressions.push(node.expression)
            else if (!ts.isFunctionLike(node) || node === callback.body) node.forEachChild(collectReturns)
          }
          collectReturns(callback.body)
        } else expressions.push(callback.body)
        const roots = expressions.flatMap(jsxRoots)
        return roots.length > 0 && roots.every(node => !!jsxKeyForNode(node, source))
      }

      let usesHook = false
      let usesWrapper = false
      const visit = (node: ts.Node) => {
        if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
          const tag = ts.isIdentifier(node.tagName) ? node.tagName.text : ''
          const fullElement = ts.isJsxSelfClosingElement(node) ? node : ts.isJsxElement(node.parent) ? node.parent : undefined
          const owner = ownerFor(node)
          const attributes = node.attributes.properties
          const has = (name: string) => attributes.some(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(source) === name)
          const sourceRef = `jsx:${relative.replaceAll('\\', '/') }#${node.getStart(source)}`
          const keyPath: string[] = []
          let cursor: ts.Node | undefined = node.parent
          while (cursor && cursor !== owner?.node) {
            if (ts.isJsxElement(cursor) || ts.isJsxSelfClosingElement(cursor)) {
              const key = jsxKeyForNode(cursor, source)
              if (key) keyPath.unshift(key)
            }
            cursor = cursor.parent
          }
          const directKey = jsxKey(node, source)
          const mapCallbacks = owner ? enclosingMapCallbacks(node, owner.node) : []
          const positionalCallbacks = mapCallbacks.filter(callback => !mapCallbackHasStableKey(callback))
          const positional = positionalCallbacks.length > 0
          const expressions = positionalCallbacks.map(mapIndexFor)
          const mapIndexesForElement = { expressions: expressions.filter((value): value is string => !!value), hasUnsupported: expressions.some(value => !value) }
          const instanceKeys = [...keyPath, ...(directKey ? [directKey] : []), ...mapIndexesForElement.expressions]
          const instanceKey = instanceKeys.length ? `[${instanceKeys.map(key => `String(${key})`).join(',')}].join('/')` : JSON.stringify(sourceRef)
          const identityCertainty = positional ? mapIndexesForElement.hasUnsupported ? 'unknown' : 'position-dependent' : directKey || keyPath.length ? 'stable-keyed-instance' : 'stable-react-instance'
          if (/^[A-Z]/.test(tag) && fullElement && owner) {
            const sourceRef = `jsx:${relative.replaceAll('\\', '/')}#${fullElement.getStart(source)}`
            const mapKey = positional && !mapIndexesForElement.hasUnsupported ? ` key={${instanceKey}}` : directKey ? ` key={${directKey}}` : ''
            insertions.push({ position: fullElement.getStart(source), text: `<RippleIdentity${mapKey} instanceKey={${instanceKey}} sourceRef={${JSON.stringify(sourceRef)}} certainty=${JSON.stringify(identityCertainty)}>` })
            insertions.push({ position: fullElement.getEnd(), text: '</RippleIdentity>' })
            usesWrapper = true
          }
          if (/^[a-z]/.test(tag) && (!has('data-ripple-source') || !has('data-ripple-instance'))) {
            const position = node.getEnd() - (ts.isJsxSelfClosingElement(node) ? 2 : 1)
            const identityOwner = owner
              ? `(${owner.identityId}?.path ? (${owner.identityId}.certainty === "position-dependent" ? ${owner.identityId}.path + ":" + ${owner.ownerId} : ${owner.identityId}.path) : ${owner.ownerId})`
              : undefined
            const instanceAvailable = !mapIndexesForElement.hasUnsupported
            const identity = owner
              ? instanceAvailable ? `window.location.pathname + ":" + ${identityOwner} + ":" + ${JSON.stringify(sourceRef)}${instanceKeys.length ? ` + ":" + [${instanceKeys.map(key => `String(${key})`).join(',')}].join("/")` : ''}` : undefined
              : JSON.stringify(`unmapped:${sourceRef}`)
            const additions = [
              ...(!has('data-ripple-source') ? [`data-ripple-source=${JSON.stringify(sourceRef)}`] : []),
              ...(!has('data-ripple-instance') && identity ? [`data-ripple-instance={${identity}}`] : []),
              ...(!has('data-ripple-identity-certainty') ? [`data-ripple-identity-certainty={${owner ? positional ? JSON.stringify(identityCertainty) : `${owner.identityId}?.certainty ?? ${JSON.stringify('stable-react-instance')}` : JSON.stringify('unmapped')}}`] : []),
              ...(jsxKey(node, source) && !has('data-ripple-list-key') ? [`data-ripple-list-key={String(${jsxKey(node, source)})}`] : []),
            ]
            insertions.push({ position, text: ` ${additions.join(' ')}` })
            usesHook ||= !!owner
          }
        }
        node.forEachChild(visit)
      }
      visit(source)
      if (!insertions.length) return null
      if (usesHook || components.length) {
        const hookName = generatedName('__rippleUseId')
        const identityHook = generatedName('__rippleUseIdentity')
        const wrapperName = usesWrapper ? generatedName('__rippleIdentityBoundary') : ''
        for (const insertion of insertions) insertion.text = insertion.text.replaceAll('__rippleUseIdentity', identityHook).replaceAll('__rippleUseId', hookName)
        if (usesWrapper) for (const insertion of insertions) insertion.text = insertion.text.replaceAll('<RippleIdentity ', `<${wrapperName} `).replaceAll('</RippleIdentity>', `</${wrapperName}>`)
        insertions.push({ position: 0, text: `import { useId as ${hookName} } from 'react';\nimport { useRippleIdentity as ${identityHook}${usesWrapper ? `, RippleIdentity as ${wrapperName}` : ''} } from 'virtual:ripple-identity';\n` })
      }
      let transformed = code
      for (const insertion of insertions.sort((left, right) => right.position - left.position)) {
        transformed = transformed.slice(0, insertion.position) + insertion.text + transformed.slice(insertion.position)
      }
      return { code: transformed, map: null }
    },
  }
}
