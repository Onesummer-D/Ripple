import * as path from 'node:path'
import ts from 'typescript'
import type { Plugin } from 'vite'

export function sourceAnnotationPlugin(projectRoot: string): Plugin {
  const root = path.resolve(projectRoot)
  return {
    name: 'ripple-runtime-source-annotation',
    enforce: 'pre',
    apply: 'serve',
    transform(code, id) {
      const file = path.resolve(id.split('?')[0])
      const relative = path.relative(root, file)
      if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) ||
        !/\.(tsx|jsx)$/i.test(file) || relative.split(path.sep).includes('node_modules')) return null
      const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
      const insertions: Array<{ position: number; text: string }> = []
      const visit = (node: ts.Node) => {
        if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
          const tag = ts.isIdentifier(node.tagName) ? node.tagName.text : ''
          const hasSourceRef = node.attributes.properties.some(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(source) === 'data-ripple-source')
          const hasInstanceRef = node.attributes.properties.some(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(source) === 'data-ripple-instance')
          if (/^[a-z]/.test(tag) && (!hasSourceRef || !hasInstanceRef)) {
            const position = node.getEnd() - (ts.isJsxSelfClosingElement(node) ? 2 : 1)
            const sourceRef = `jsx:${relative.replaceAll('\\', '/')}#${node.getStart(source)}`
            const additions = [
              ...(!hasSourceRef ? [`data-ripple-source="${sourceRef}"`] : []),
              ...(!hasInstanceRef ? [`data-ripple-instance={(() => { const runtime = globalThis as typeof globalThis & { __rippleInstanceCounters?: Map<string, number> }; const counters = runtime.__rippleInstanceCounters ??= new Map<string, number>(); const key = ${JSON.stringify(sourceRef)}; const index = counters.get(key) ?? 0; counters.set(key, index + 1); return key + "@" + index; })()}`] : []),
            ]
            insertions.push({ position, text: ` ${additions.join(' ')}` })
          }
        }
        node.forEachChild(visit)
      }
      visit(source)
      if (!insertions.length) return null
      let transformed = code
      for (const insertion of insertions.sort((a, b) => b.position - a.position)) {
        transformed = transformed.slice(0, insertion.position) + insertion.text + transformed.slice(insertion.position)
      }
      return { code: transformed, map: null }
    },
  }
}
