import { describe, expect, it } from 'vitest'
import { parseCssTokenSource, selectorClassTokens } from './css-token-source'

describe('CSS Token source anchors', () => {
  it('records UTF-8 byte positions, exact selector scope, media context, and nested fallback references', () => {
    const css = `/* 主题 */\n:root { --accent: #123; }\n@media (max-width: 600px) { .badge::before { /* var(--comment) */ color: var(--accent, var(--fallback)); content: "var(--quoted)"; } }`
    const parsed = parseCssTokenSource('src/theme.css', css)
    const declaration = parsed.declarations.find(item => item.name === '--accent')!
    expect(declaration.offset).toBe(css.indexOf('--accent'))
    expect(declaration.byteOffset).toBe(Buffer.byteLength(css.slice(0, css.indexOf('--accent')), 'utf8'))
    expect(declaration.selectorScope).toBe(':root')

    const uses = parsed.uses.filter(item => item.name === '--accent' || item.name === '--fallback')
    expect(uses.map(item => item.name)).toEqual(['--accent', '--fallback'])
    expect(uses.map(item => item.offset)).toEqual([
      css.indexOf('var(--accent'), css.indexOf('var(--fallback'),
    ])
    expect(uses.map(item => item.selectorScope)).toEqual(['.badge::before', '.badge::before'])
    expect(uses.map(item => item.atRuleContext)).toEqual([
      ['@media (max-width: 600px)'], ['@media (max-width: 600px)'],
    ])
    expect(uses.every(item => item.byteOffset === Buffer.byteLength(css.slice(0, item.offset), 'utf8'))).toBe(true)
  })

  it('does not treat var() text inside CSS comments or strings as consumers', () => {
    const parsed = parseCssTokenSource('src/theme.css', '.badge { /* var(--comment) */ content: "var(--string)"; color: var(--real); }')
    expect(parsed.uses.map(item => item.name)).toEqual(['--real'])
  })

  it('ignores class-like text in attribute selectors and leaves escaped classes unsupported', () => {
    expect(selectorClassTokens('[data-class=".fake"] .real:hover').tokens).toEqual(['real'])
    expect(selectorClassTokens('.escaped\\:name').supported).toBe(false)
  })
})
