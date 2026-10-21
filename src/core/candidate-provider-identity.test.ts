import { describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { createHash } from 'node:crypto'
import { sourceAnnotationPlugin } from './source-annotation'

// Copied exactly from the generator in candidate.ts; keep the hash in the
// annotation plugin synchronized with the generator, never weaken the check.
const canonicalProvider = "import { createContext, createElement, useContext } from 'react'\nimport overrides from './overrides.json'\n\nconst RipplePageContext = createContext(null)\nexport function RipplePageForState({ state, pageRefs, children }) {\n  return createElement(RipplePageContext.Provider, { value: pageRefs[state] ?? null }, children)\n}\nexport function RippleText({ targetRef, fallback }) {\n  const pageRef = useContext(RipplePageContext)\n  return overrides.pages?.[pageRef]?.[targetRef] ?? fallback\n}\n"
const acceptedHash = '910b34dbb01740e72a4bc04fbb33b142049a63502dcbeb8c65201bb75e793815'

const annotate = (options: {
  importedFrom?: string
  editedProvider?: string
  alias?: string
  shadow?: boolean
  includeProvider?: boolean
}) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ripple-provider-identity-'))
  try {
    fs.mkdirSync(path.join(root, 'src'), { recursive: true })
    fs.mkdirSync(path.join(root, '.ripple'), { recursive: true })
    fs.writeFileSync(path.join(root, '.ripple', 'overrides-runtime.js'), options.editedProvider ?? canonicalProvider)
    if (options.importedFrom === '../vendor/overrides-runtime.js') {
      fs.mkdirSync(path.join(root, 'vendor'), { recursive: true })
      fs.writeFileSync(path.join(root, 'vendor', 'overrides-runtime.js'), canonicalProvider)
    }
    const alias = options.alias ?? 'RipplePageForState'
    const importPath = options.importedFrom ?? '../.ripple/overrides-runtime.js'
    const importLine = `import { RipplePageForState as ${alias} } from '${importPath}'`
    const shadow = options.shadow ? `const ${alias} = ({ children }: { children: any }) => <>{children}</>;` : ''
    const code = `${importLine}
import { HomePage } from './HomePage'
export function App() { ${shadow} return <${alias} state="home" pageRefs={{ home: "page:home" }}>{<main><HomePage /></main>}</${alias}> }`
    const file = path.join(root, 'src', 'App.tsx')
    fs.writeFileSync(file, code)
    fs.writeFileSync(path.join(root, 'src', 'HomePage.tsx'), 'export function HomePage() { return <h1>Title</h1> }')
    const plugin = sourceAnnotationPlugin(root) as unknown as {
      transform: (source: string, id: string) => { code: string } | null
    }
    const output = plugin.transform(code, file)?.code
    expect(output).toBeTruthy()
    return output!
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

describe('canonical candidate page provider as a proven JSX consumer', () => {
  it('matches exactly the generated provider implementation', () => {
    expect(createHash('sha256').update(canonicalProvider).digest('hex')).toBe(acceptedHash)
  })
  it('preserves the HomePage instance boundary under a verified candidate provider', () => {
    expect(annotate({})).toContain('component={HomePage}')
  })
  it('supports a provable aliased provider import', () => {
    expect(annotate({ alias: 'RouteProvider' })).toContain('component={HomePage}')
  })
  it('fails closed when provider implementation changes even slightly', () => {
    expect(annotate({ editedProvider: canonicalProvider + '// unsafe edit\n' }))
      .not.toContain('component={HomePage}')
  })
  it('does not trust a similarly named provider from an unrelated module', () => {
    expect(annotate({ importedFrom: '../vendor/overrides-runtime.js' }))
      .not.toContain('component={HomePage}')
  })
  it('fails closed if an inner binding shadows the genuine imported provider', () => {
    expect(annotate({ alias: 'RouteProvider', shadow: true }))
      .not.toContain('component={HomePage}')
  })
})
