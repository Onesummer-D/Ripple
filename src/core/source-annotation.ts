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
          const alreadyAnnotated = node.attributes.properties.some(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(source) === 'data-ripple-source')
          if (/^[a-z]/.test(tag) && !alreadyAnnotated) {
            const position = node.getEnd() - (ts.isJsxSelfClosingElement(node) ? 2 : 1)
            insertions.push({ position, text: ` data-ripple-source="jsx:${relative.replaceAll('\\', '/')}#${node.getStart(source)}"` })
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
