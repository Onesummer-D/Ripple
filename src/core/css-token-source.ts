import postcss, { type AtRule, type Declaration, type Rule } from 'postcss'

export interface CssTokenDeclaration {
  name: string
  value: string
  /** JavaScript source index of the property name. */
  offset: number
  /** JavaScript source index of the trimmed value start, retained for legacy token IDs. */
  valueStart: number
  valueEnd: number
  /** UTF-8 byte position of the property name. */
  byteOffset: number
  selectorScope: string
  atRuleContext: string[]
}

export interface CssTokenUse {
  name: string
  /** JavaScript source index of `var(`. */
  offset: number
  /** UTF-8 byte position of `var(`. */
  byteOffset: number
  selectorScope: string
  atRuleContext: string[]
  property: string
  /** Present when the var() occurs inside a custom-property declaration. */
  ownerToken?: string
  ownerTokenOffset?: number
}

export interface CssTokenSource {
  declarations: CssTokenDeclaration[]
  uses: CssTokenUse[]
}

const ruleScope = (declaration: Declaration): { selectorScope: string; atRuleContext: string[] } => {
  let nearestRule: Rule | undefined
  const atRules: AtRule[] = []
  for (let parent = declaration.parent; parent && parent.type !== 'root'; parent = parent.parent) {
    if (!nearestRule && parent.type === 'rule') nearestRule = parent
    if (parent.type === 'atrule') atRules.push(parent)
  }
  const context = atRules.reverse().map(rule => `@${rule.name}${rule.params ? ` ${rule.params}` : ''}`)
  const nearestAtRule = atRules.at(-1)
  return {
    selectorScope: nearestRule?.selector ?? (nearestAtRule
      ? `@${nearestAtRule.name}${nearestAtRule.params ? ` ${nearestAtRule.params}` : ''}`
      : '<top-level>'),
    atRuleContext: context,
  }
}

function rawDeclarationValue(declaration: Declaration): string {
  const raw = declaration.raws.value
  if (typeof raw === 'string') return raw
  if (raw && typeof raw === 'object' && typeof raw.raw === 'string') return raw.raw
  return declaration.value
}

/** Finds var() references in one parsed declaration while ignoring comments and strings. */
function varReferences(value: string): Array<{ name: string; offset: number }> {
  const found: Array<{ name: string; offset: number }> = []
  let quote = ''
  for (let index = 0; index < value.length; index++) {
    const char = value[index]
    if (quote) {
      if (char === '\\') index++
      else if (char === quote) quote = ''
      continue
    }
    if (char === '"' || char === "'") { quote = char; continue }
    if (char === '/' && value[index + 1] === '*') {
      const end = value.indexOf('*/', index + 2)
      index = end < 0 ? value.length : end + 1
      continue
    }
    if (value.slice(index, index + 3).toLowerCase() !== 'var') continue
    if (index > 0 && /[\w-]/.test(value[index - 1])) continue
    let cursor = index + 3
    while (/\s/.test(value[cursor] ?? '')) cursor++
    if (value[cursor] !== '(') continue
    cursor++
    while (/\s/.test(value[cursor] ?? '')) cursor++
    const name = /^--[\w-]+/.exec(value.slice(cursor))?.[0]
    if (name) found.push({ name, offset: index })
  }
  return found
}

export function parseCssTokenSource(file: string, css: string): CssTokenSource {
  const root = postcss.parse(css, { from: file })
  const declarations: CssTokenDeclaration[] = []
  const uses: CssTokenUse[] = []

  root.walkDecls(declaration => {
    const sourceStart = declaration.source?.start?.offset
    if (sourceStart === undefined || !Number.isInteger(sourceStart)) return
    const { selectorScope, atRuleContext } = ruleScope(declaration)
    const between = typeof declaration.raws.between === 'string' ? declaration.raws.between : ':'
    const rawValueStart = sourceStart + declaration.prop.length + between.length
    const rawValue = rawDeclarationValue(declaration)
    const leading = rawValue.length - rawValue.trimStart().length
    const valueStart = rawValueStart + leading
    const value = declaration.value.trim()
    const isCustomProperty = /^--[\w-]+$/.test(declaration.prop)
    const ownerTokenOffset = isCustomProperty ? sourceStart : undefined

    if (isCustomProperty) {
      declarations.push({
        name: declaration.prop,
        value,
        offset: sourceStart,
        valueStart,
        valueEnd: valueStart + value.length,
        byteOffset: Buffer.byteLength(css.slice(0, sourceStart), 'utf8'),
        selectorScope,
        atRuleContext,
      })
    }

    for (const reference of varReferences(rawValue)) {
      const offset = rawValueStart + reference.offset
      uses.push({
        name: reference.name,
        offset,
        byteOffset: Buffer.byteLength(css.slice(0, offset), 'utf8'),
        selectorScope,
        atRuleContext,
        property: declaration.prop,
        ...(isCustomProperty ? { ownerToken: declaration.prop, ownerTokenOffset } : {}),
      })
    }
  })

  return { declarations, uses }
}

/** Returns simple CSS class identifiers; escaped selector syntax is left unlinked. */
export function selectorClassTokens(selector: string): { tokens: string[]; supported: boolean } {
  const tokens = new Set<string>()
  let inAttribute = 0
  let quote = ''
  let supported = true
  for (let index = 0; index < selector.length; index++) {
    const char = selector[index]
    if (quote) {
      if (char === '\\') index++
      else if (char === quote) quote = ''
      continue
    }
    if (char === '"' || char === "'") { quote = char; continue }
    if (char === '[') { inAttribute++; continue }
    if (char === ']' && inAttribute) { inAttribute--; continue }
    if (char === '\\') { supported = false; index++; continue }
    if (inAttribute || char !== '.') continue
    const match = /^[\w-]+/.exec(selector.slice(index + 1))
    if (match) {
      tokens.add(match[0])
      index += match[0].length
    }
  }
  return { tokens: [...tokens], supported }
}

export interface CssSelectorPart {
  tagName?: string
  classNames: string[]
}

export interface CssSelectorStructure {
  supported: boolean
  parts: CssSelectorPart[]
  reason?: string
}

/**
 * Parses the conservative selector subset used for static JSX owner matching.
 *
 * A selector list, attribute/id selector, combinator other than descendant
 * whitespace, escaped identifier, and pseudo state/generated-content selector
 * is deliberately left unsupported. The original selectorScope remains on
 * the SourceNode; this structure is only a comparison aid.
 */
export function parseCssSelectorStructure(selector: string): CssSelectorStructure {
  const input = selector.trim()
  const unsupported = (reason: string): CssSelectorStructure => ({ supported: false, parts: [], reason })
  if (!input) return unsupported('empty selector')
  if (input.includes(',')) return unsupported('selector list is ambiguous')
  if (/[\\[\]#,:+~>*]/.test(input)) return unsupported('selector requires unsupported syntax')

  const parts: CssSelectorPart[] = []
  for (const rawPart of input.split(/\s+/)) {
    let cursor = 0
    let tagName: string | undefined
    const tag = /^[A-Za-z][\w-]*/.exec(rawPart)
    if (tag) {
      tagName = tag[0].toLowerCase()
      cursor = tag[0].length
    }
    const classNames: string[] = []
    while (cursor < rawPart.length) {
      if (rawPart[cursor] !== '.') return unsupported('compound selector contains unsupported syntax')
      const className = /^[\w-]+/.exec(rawPart.slice(cursor + 1))
      if (!className) return unsupported('class selector is not a static identifier')
      classNames.push(className[0])
      cursor += className[0].length + 1
    }
    if (!tagName && !classNames.length) return unsupported('selector part has no static tag or class')
    parts.push({ ...(tagName ? { tagName } : {}), classNames })
  }
  return { supported: true, parts }
}

