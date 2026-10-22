import { describe, expect, it } from 'vitest'
import { Script } from 'node:vm'
import { insertCandidateSelectionBridge } from './candidate-selection-bridge-html'

describe('candidate selection bridge HTML injection', () => {
  it('preserves React Fiber property names with the special dollar-apostrophe sequence', () => {
    const body = "<script>if (name.startsWith('__reactFiber$') || name.startsWith('__reactInternalInstance$')) {};</script>"
    const html = '<!doctype html><html><body><main>Page</main></body></html>'
    const injected = insertCandidateSelectionBridge(html, body)
    expect(injected).toContain("__reactFiber$'")
    expect(injected).toContain("__reactInternalInstance$'")
    expect(injected).not.toContain('__reactFiber</html>')
    const js = injected.split('<script>')[1].split('</script>')[0]
    expect(() => new Script(js)).not.toThrow()
  })

  it('removes the Vite client script while preserving content and inserting the picker once', () => {
    const html = '<html><body><script type="module" src="/@vite/client"></script><h1>Heading</h1></body></html>'
    const injected = insertCandidateSelectionBridge(html, '<script>window.__pickerReady = true;</script>')
    expect(injected).not.toContain('/@vite/client')
    expect(injected).toContain('<h1>Heading</h1>')
    expect(injected.match(/__pickerReady/g)).toHaveLength(1)
  })
})
