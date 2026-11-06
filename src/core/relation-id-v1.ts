import { createHash } from 'node:crypto'
import { parseCssSelectorStructure } from './css-token-source'

export const RELATION_IDENTITY_VERSION = 'relation-id/v1' as const
export const CSS_SELECTOR_CANDIDATE_PRODUCER = 'css-selector-candidate' as const
export const CSS_SELECTOR_CANDIDATE_CONTRACT_VERSION = 'css-selector-candidate/v1' as const
export const CSS_SELECTOR_PARSER_VERSION = 'css-selector-static-subset/v1' as const

type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue }

export interface RelationSourceUseIdentity {
  path: string
  charOffset: number
  byteOffset: number
  offsetUnit: 'code-unit'
  selectorScope: string
}

export interface RelationDefinitionIdentity {
  id: string
  tokenName: string
  tokenOrigin: 'css-custom-property'
  sourcePath: string
  charOffset: number
  byteOffset: number
  offsetUnit: 'code-unit'
  rawSelectorScope: string
  canonicalSelectorScope: string
  selectorParserVersion: typeof CSS_SELECTOR_PARSER_VERSION
  mediaContext: string[]
}

export interface CssSelectorCandidateIdentityInput {
  kind: 'css-cascade'
  from: string
  to: string
  sourceUse: RelationSourceUseIdentity
  definition: RelationDefinitionIdentity
  relationRawSelectorScope: string
  relationCanonicalSelectorScope: string
  relationMediaContext: string[]
}

export interface CssSelectorCandidateIdentity {
  relationIdentityVersion: typeof RELATION_IDENTITY_VERSION
  producerIdentity: typeof CSS_SELECTOR_CANDIDATE_PRODUCER
  producerContractVersion: typeof CSS_SELECTOR_CANDIDATE_CONTRACT_VERSION
  tuple: JsonValue
  canonicalTuple: string
  id: string
}

export type RelationIdRegistration =
  | { accepted: true; id: string; payloadSha256: string }
  | { accepted: false; id: string; payloadSha256: string; existingPayloadSha256: string; reason: 'duplicate-equal-payload' | 'duplicate-conflicting-payload' }

/**
 * Canonical JSON for identity evidence. Keys are sorted recursively and strings
 * are kept byte-for-byte; no Unicode normalization is applied.
 */
function canonicalJsonValue(value: unknown, active: WeakSet<object>, path: string): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`canonical JSON rejects non-finite number at ${path}`)
    return JSON.stringify(value)
  }
  if (typeof value !== 'object' || value === undefined) throw new TypeError(`canonical JSON rejects ${typeof value} at ${path}`)
  if (active.has(value)) throw new TypeError(`canonical JSON rejects cyclic object at ${path}`)
  active.add(value)
  try {
    if (Array.isArray(value)) {
      const ownKeys = Reflect.ownKeys(value)
      for (const key of ownKeys) {
        if (key === 'length') continue
        if (typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length) {
          throw new TypeError(`canonical JSON rejects non-canonical array property at ${path}`)
        }
        const descriptor = Object.getOwnPropertyDescriptor(value, key)
        if (!descriptor?.enumerable || !('value' in descriptor)) throw new TypeError(`canonical JSON rejects non-canonical array property at ${path}[${key}]`)
      }
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) throw new TypeError(`canonical JSON rejects sparse array at ${path}[${index}]`)
      }
      return `[${value.map((item, index) => canonicalJsonValue(item, active, `${path}[${index}]`)).join(',')}]`
    }
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`canonical JSON rejects non-plain object at ${path}`)
    const keys = Reflect.ownKeys(value)
    if (keys.some(key => typeof key !== 'string')) throw new TypeError(`canonical JSON rejects symbol key at ${path}`)
    const stringKeys = keys as string[]
    for (const key of stringKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor?.enumerable || !('value' in descriptor)) throw new TypeError(`canonical JSON rejects non-data property at ${path}.${key}`)
    }
    stringKeys.sort((left, right) => Buffer.from(left, 'utf8').compare(Buffer.from(right, 'utf8')))
    return `{${stringKeys.map(key => `${JSON.stringify(key)}:${canonicalJsonValue((value as Record<string, unknown>)[key], active, `${path}.${key}`)}`).join(',')}}`
  } finally {
    active.delete(value)
  }
}

export function canonicalJson(value: unknown): string {
  return canonicalJsonValue(value, new WeakSet<object>(), '$')
}

const sha256 = (value: string) => createHash('sha256').update(Buffer.from(value, 'utf8')).digest('hex')

export interface CanonicalSelectorScope {
  supported: boolean
  canonical: string
  parserVersion: typeof CSS_SELECTOR_PARSER_VERSION
  reason?: string
}

/**
 * Canonicalizes only the selector subset that can produce a static owner.
 * Unsupported selectors retain their raw text but are never promoted by this
 * helper; the caller must keep the corresponding use unresolved.
 */
export function canonicalizeSelectorScope(rawSelectorScope: string): CanonicalSelectorScope {
  const parsed = parseCssSelectorStructure(rawSelectorScope)
  if (!parsed.supported) {
    return { supported: false, canonical: rawSelectorScope, parserVersion: CSS_SELECTOR_PARSER_VERSION, reason: parsed.reason }
  }
  const canonical = parsed.parts.map(part => `${part.tagName ?? ''}${[...part.classNames].sort().map(name => `.${name}`).join('')}`).join(' ')
  return { supported: true, canonical, parserVersion: CSS_SELECTOR_PARSER_VERSION }
}

function tupleFor(input: CssSelectorCandidateIdentityInput): JsonValue {
  return [
    RELATION_IDENTITY_VERSION,
    CSS_SELECTOR_CANDIDATE_PRODUCER,
    CSS_SELECTOR_CANDIDATE_CONTRACT_VERSION,
    input.kind,
    input.from,
    input.to,
    [
      input.definition.id,
      input.definition.tokenName,
      input.definition.tokenOrigin,
      input.definition.sourcePath,
      input.definition.charOffset,
      input.definition.byteOffset,
      input.definition.offsetUnit,
      input.definition.rawSelectorScope,
      input.definition.canonicalSelectorScope,
      input.definition.selectorParserVersion,
      input.definition.mediaContext,
    ],
    [
      input.sourceUse.path,
      input.sourceUse.charOffset,
      input.sourceUse.byteOffset,
      input.sourceUse.offsetUnit,
      input.sourceUse.selectorScope,
    ],
    [
      input.relationRawSelectorScope,
      input.relationCanonicalSelectorScope,
      CSS_SELECTOR_PARSER_VERSION,
      input.relationMediaContext,
    ],
  ]
}

function assertPlainRecord(value: unknown, field: string): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`relation identity requires ${field} to be a plain object`)
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`relation identity rejects non-plain ${field}`)
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') throw new TypeError(`relation identity rejects symbol key in ${field}`)
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !('value' in descriptor)) throw new TypeError(`relation identity rejects non-data property in ${field}`)
  }
}

function assertExactFields(value: unknown, field: string, allowedFields: readonly string[]): asserts value is Record<string, unknown> {
  assertPlainRecord(value, field)
  const allowed = new Set(allowedFields)
  const unknownFields = Reflect.ownKeys(value).filter(key => typeof key !== 'string' || !allowed.has(key))
  if (unknownFields.length) throw new TypeError(`relation identity rejects unknown field(s) in ${field}: ${unknownFields.map(String).join(', ')}`)
}

function assertNonPlaceholderString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0 || value.trim().length === 0 || /^<[^>]+>$/.test(value)) {
    throw new TypeError(`relation identity requires a concrete ${field}`)
  }
}

function assertOffset(value: unknown, field: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`relation identity requires a non-negative integer ${field}`)
  }
}

function assertOffsetUnit(value: unknown, field: string): asserts value is 'code-unit' {
  if (value !== 'code-unit') throw new TypeError(`relation identity rejects invalid ${field}`)
}

function assertStringArray(value: unknown, field: string): asserts value is string[] {
  if (!Array.isArray(value)) throw new TypeError(`relation identity requires ${field} to be an array`)
  canonicalJson(value)
  value.forEach((item, index) => assertNonPlaceholderString(item, `${field}[${index}]`))
}

function assertRepositoryRelativePosixPath(value: unknown, field: string): asserts value is string {
  assertNonPlaceholderString(value, field)
  if (value.startsWith('/') || /^[A-Za-z]:/.test(value) || value.includes('\\') || value.includes('\u0000') || value.includes('//')) {
    throw new TypeError(`relation identity requires a repository-relative POSIX ${field}`)
  }
  const segments = value.split('/')
  if (segments.some(segment => segment.length === 0 || segment === '.' || segment === '..')) {
    throw new TypeError(`relation identity rejects traversal or empty segment in ${field}`)
  }
}

export function validateCssSelectorCandidateIdentityInput(input: unknown): asserts input is CssSelectorCandidateIdentityInput {
  assertExactFields(input, 'input', [
    'kind', 'from', 'to', 'sourceUse', 'definition',
    'relationRawSelectorScope', 'relationCanonicalSelectorScope', 'relationMediaContext',
  ])
  const candidate = input
  assertNonPlaceholderString(candidate.kind, 'kind')
  if (candidate.kind !== 'css-cascade') throw new TypeError('relation identity rejects invalid kind')
  assertNonPlaceholderString(candidate.from, 'from identity')
  assertNonPlaceholderString(candidate.to, 'to identity')
  assertNonPlaceholderString(candidate.relationRawSelectorScope, 'raw selector scope')
  assertNonPlaceholderString(candidate.relationCanonicalSelectorScope, 'canonical selector scope')
  assertStringArray(candidate.relationMediaContext, 'relation media context')

  assertExactFields(candidate.sourceUse, 'sourceUse', ['path', 'charOffset', 'byteOffset', 'offsetUnit', 'selectorScope'])
  const sourceUse = candidate.sourceUse
  assertRepositoryRelativePosixPath(sourceUse.path, 'sourceUse path')
  assertOffset(sourceUse.charOffset, 'sourceUse charOffset')
  assertOffset(sourceUse.byteOffset, 'sourceUse byteOffset')
  assertOffsetUnit(sourceUse.offsetUnit, 'sourceUse offsetUnit')
  assertNonPlaceholderString(sourceUse.selectorScope, 'sourceUse selector scope')

  assertExactFields(candidate.definition, 'definition', [
    'id', 'tokenName', 'tokenOrigin', 'sourcePath', 'charOffset', 'byteOffset', 'offsetUnit',
    'rawSelectorScope', 'canonicalSelectorScope', 'selectorParserVersion', 'mediaContext',
  ])
  const definition = candidate.definition
  assertNonPlaceholderString(definition.id, 'definition id')
  assertNonPlaceholderString(definition.tokenName, 'definition token name')
  if (definition.tokenOrigin !== 'css-custom-property') throw new TypeError('relation identity rejects invalid token origin')
  assertRepositoryRelativePosixPath(definition.sourcePath, 'definition source path')
  assertOffset(definition.charOffset, 'definition charOffset')
  assertOffset(definition.byteOffset, 'definition byteOffset')
  assertOffsetUnit(definition.offsetUnit, 'definition offsetUnit')
  assertNonPlaceholderString(definition.rawSelectorScope, 'definition raw selector scope')
  assertNonPlaceholderString(definition.canonicalSelectorScope, 'definition canonical selector scope')
  if (definition.selectorParserVersion !== CSS_SELECTOR_PARSER_VERSION) throw new TypeError('relation identity rejects invalid selector parser version')
  assertStringArray(definition.mediaContext, 'definition media context')
}

export function createCssSelectorCandidateIdentity(input: CssSelectorCandidateIdentityInput): CssSelectorCandidateIdentity {
  validateCssSelectorCandidateIdentityInput(input)
  const tuple = tupleFor(input)
  const canonicalTuple = canonicalJson(tuple)
  return {
    relationIdentityVersion: RELATION_IDENTITY_VERSION,
    producerIdentity: CSS_SELECTOR_CANDIDATE_PRODUCER,
    producerContractVersion: CSS_SELECTOR_CANDIDATE_CONTRACT_VERSION,
    tuple,
    canonicalTuple,
    id: `${CSS_SELECTOR_CANDIDATE_PRODUCER}:${RELATION_IDENTITY_VERSION}:${sha256(canonicalTuple)}`,
  }
}

/**
 * A governed producer must reject every repeated ID, including equal payloads.
 * The registry is intentionally local to one graph analysis and never silently
 * deduplicates an occurrence.
 */
export function createRelationIdRegistry() {
  const payloads = new Map<string, string>()
  return {
    register(id: string, payload: JsonValue): RelationIdRegistration {
      const payloadSha256 = sha256(canonicalJson(payload))
      const existingPayloadSha256 = payloads.get(id)
      if (existingPayloadSha256 !== undefined) {
        return {
          accepted: false,
          id,
          payloadSha256,
          existingPayloadSha256,
          reason: existingPayloadSha256 === payloadSha256 ? 'duplicate-equal-payload' : 'duplicate-conflicting-payload',
        }
      }
      payloads.set(id, payloadSha256)
      return { accepted: true, id, payloadSha256 }
    },
    size: () => payloads.size,
  }
}
