import { describe, expect, it } from 'vitest'
import {
  CSS_SELECTOR_CANDIDATE_CONTRACT_VERSION,
  CSS_SELECTOR_CANDIDATE_PRODUCER,
  RELATION_IDENTITY_VERSION,
  canonicalJson,
  canonicalizeSelectorScope,
  createCssSelectorCandidateIdentity,
  createRelationIdRegistry,
} from './relation-id-v1'

const identityInput = () => ({
  kind: 'css-cascade' as const,
  from: 'token-use:src/theme.css#28',
  to: 'jsx:src/Footer.tsx#10',
  sourceUse: { path: 'src/theme.css', charOffset: 28, byteOffset: 28, offsetUnit: 'code-unit' as const, selectorScope: '.footer-cta' },
  definition: {
    id: 'token:src/theme.css#10', tokenName: '--accent', tokenOrigin: 'css-custom-property' as const,
    sourcePath: 'src/theme.css', charOffset: 10, byteOffset: 10, offsetUnit: 'code-unit' as const,
    rawSelectorScope: ':root', canonicalSelectorScope: ':root', selectorParserVersion: 'css-selector-static-subset/v1' as const,
    mediaContext: [],
  },
  relationRawSelectorScope: ':root', relationCanonicalSelectorScope: ':root', relationMediaContext: [],
})

describe('relation-id/v1 css-selector-candidate identity', () => {
  it('uses the frozen version and producer identity', () => {
    const identity = createCssSelectorCandidateIdentity(identityInput())
    expect(identity.relationIdentityVersion).toBe(RELATION_IDENTITY_VERSION)
    expect(identity.producerIdentity).toBe(CSS_SELECTOR_CANDIDATE_PRODUCER)
    expect(identity.producerContractVersion).toBe(CSS_SELECTOR_CANDIDATE_CONTRACT_VERSION)
    expect(identity.id).toMatch(/^css-selector-candidate:relation-id\/v1:[0-9a-f]{64}$/)
  })

  it('is deterministic under object key order and stable under repeated calculation', () => {
    const first = createCssSelectorCandidateIdentity(identityInput())
    const second = createCssSelectorCandidateIdentity({ ...identityInput(), definition: { ...identityInput().definition } })
    expect(first.canonicalTuple).toBe(second.canonicalTuple)
    expect(first.id).toBe(second.id)
    expect(canonicalJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}')
  })

  it('sorts object keys by UTF-8 bytes and preserves non-ASCII identity inputs', () => {
    const ordered = canonicalJson({ '😀': 2, '\uE000': 1 })
    expect(ordered.indexOf('\uE000')).toBeLessThan(ordered.indexOf('😀'))
    const identity = createCssSelectorCandidateIdentity({
      ...identityInput(),
      sourceUse: { ...identityInput().sourceUse, path: '样式/主题.css', selectorScope: '.按钮' },
      definition: { ...identityInput().definition, sourcePath: '样式/主题.css', tokenName: '--颜色' },
    })
    expect(identity.id).toMatch(/^css-selector-candidate:relation-id\/v1:[0-9a-f]{64}$/)
  })

  it.each([
    ['empty source path', { sourceUse: { ...identityInput().sourceUse, path: '' } }],
    ['placeholder source path', { sourceUse: { ...identityInput().sourceUse, path: '<unknown-source>' } }],
    ['absolute POSIX source path', { sourceUse: { ...identityInput().sourceUse, path: '/src/theme.css' } }],
    ['parent traversal source path', { sourceUse: { ...identityInput().sourceUse, path: '../theme.css' } }],
    ['dot segment source path', { sourceUse: { ...identityInput().sourceUse, path: 'src/./theme.css' } }],
    ['Windows drive source path', { sourceUse: { ...identityInput().sourceUse, path: 'C:/src/theme.css' } }],
    ['backslash source path', { sourceUse: { ...identityInput().sourceUse, path: 'src\\theme.css' } }],
    ['NUL source path', { sourceUse: { ...identityInput().sourceUse, path: 'src/theme\u0000.css' } }],
    ['duplicate separator source path', { sourceUse: { ...identityInput().sourceUse, path: 'src//theme.css' } }],
    ['negative offset', { sourceUse: { ...identityInput().sourceUse, charOffset: -1 } }],
    ['non-integer offset', { sourceUse: { ...identityInput().sourceUse, byteOffset: 1.5 } }],
    ['unsafe integer offset', { sourceUse: { ...identityInput().sourceUse, byteOffset: Number.MAX_SAFE_INTEGER + 1 } }],
    ['invalid offset unit', { sourceUse: { ...identityInput().sourceUse, offsetUnit: 'bytes' } }],
    ['NaN offset', { definition: { ...identityInput().definition, charOffset: Number.NaN } }],
    ['Infinity offset', { definition: { ...identityInput().definition, byteOffset: Number.POSITIVE_INFINITY } }],
    ['missing definition identity', { definition: undefined }],
  ])('rejects %s instead of creating a governance id', (_label, change) => {
    expect(() => createCssSelectorCandidateIdentity({ ...identityInput(), ...change } as any)).toThrow()
  })

  it('rejects undefined, cycles, and non-canonical runtime objects', () => {
    expect(() => canonicalJson(undefined)).toThrow(/undefined/)
    expect(() => canonicalJson(Number.NaN)).toThrow(/non-finite/)
    expect(() => canonicalJson(Number.POSITIVE_INFINITY)).toThrow(/non-finite/)
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(() => canonicalJson(cyclic)).toThrow(/cyclic/)
    expect(() => canonicalJson(new Date())).toThrow(/non-plain/)
    const accessor = {} as Record<string, unknown>
    Object.defineProperty(accessor, 'value', { enumerable: true, get: () => 1 })
    expect(() => canonicalJson(accessor)).toThrow(/non-data/)
    const nonPlainInput = Object.create({ inherited: true })
    Object.assign(nonPlainInput, identityInput())
    expect(() => createCssSelectorCandidateIdentity(nonPlainInput)).toThrow(/non-plain/)
  })

  it('rejects unknown fields at every governed identity boundary', () => {
    expect(() => createCssSelectorCandidateIdentity({ ...identityInput(), extra: true } as any)).toThrow(/unknown field/)
    expect(() => createCssSelectorCandidateIdentity({ ...identityInput(), sourceUse: { ...identityInput().sourceUse, extra: true } } as any)).toThrow(/unknown field/)
    expect(() => createCssSelectorCandidateIdentity({ ...identityInput(), definition: { ...identityInput().definition, extra: true } } as any)).toThrow(/unknown field/)
    const mediaContext = [] as string[] & { extra?: boolean }
    mediaContext.extra = true
    expect(() => createCssSelectorCandidateIdentity({ ...identityInput(), relationMediaContext: mediaContext } as any)).toThrow(/non-canonical array property|unknown field/)
  })

  it.each([
    ['definition identity', { definition: { ...identityInput().definition, id: 'token:src/theme.css#11' } }],
    ['sourceUse span', { sourceUse: { ...identityInput().sourceUse, byteOffset: 29, charOffset: 29 } }],
    ['raw selector scope', { relationRawSelectorScope: '.other' }],
    ['media context', { relationMediaContext: ['@media (min-width: 800px)'] }],
  ])('changes identity when %s changes', (_label, change) => {
    const base = createCssSelectorCandidateIdentity(identityInput())
    const changed = createCssSelectorCandidateIdentity({ ...identityInput(), ...change })
    expect(changed.id).not.toBe(base.id)
  })

  it('keeps raw selector text while producing a deterministic supported canonical form', () => {
    expect(canonicalizeSelectorScope('  article .Card  ')).toMatchObject({
      supported: true,
      canonical: 'article .Card',
      parserVersion: 'css-selector-static-subset/v1',
    })
    expect(canonicalizeSelectorScope('.beta.alpha')).toMatchObject({ supported: true, canonical: '.alpha.beta' })
    expect(canonicalizeSelectorScope(':root')).toMatchObject({ supported: false, canonical: ':root' })
  })

  it('rejects repeated IDs for equal and conflicting payloads', () => {
    const identity = createCssSelectorCandidateIdentity(identityInput())
    const registry = createRelationIdRegistry()
    expect(registry.register(identity.id, { from: identityInput().from, to: identityInput().to })).toMatchObject({ accepted: true })
    expect(registry.register(identity.id, { from: identityInput().from, to: identityInput().to })).toMatchObject({
      accepted: false, reason: 'duplicate-equal-payload',
    })
    expect(registry.register(identity.id, { from: identityInput().from, to: 'jsx:other#10' })).toMatchObject({
      accepted: false, reason: 'duplicate-conflicting-payload',
    })
    expect(registry.size()).toBe(1)
  })
})
