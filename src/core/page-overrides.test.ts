import { describe, expect, it } from 'vitest'
import { ensureRuntimeImports, removeRuntimeImports } from './page-overrides'

describe('page override AST import transforms', () => {
  it.each([
    ['src/components/Navigation.jsx', `"use client";\nimport { useState } from 'react';\nexport function Navigation(){ return <nav /> }\n`],
    ['src/pages/HomePage.jsx', `export const HomePage = () => <main />;\n`],
  ])('adds one reusable import and removes it without leaving source churn in %s', (file, source) => {
    const specifier = '../../.ripple/overrides-runtime.js'
    const first = ensureRuntimeImports(source, file, specifier, ['RippleText', 'RipplePageForState'])
    const repeated = ensureRuntimeImports(first, file, specifier, ['RippleText', 'RipplePageForState'])

    expect(repeated).toBe(first)
    expect(first.match(/from ['"]\.\.\/\.\.\/\.ripple\/overrides-runtime\.js['"]/g)).toHaveLength(1)
    expect(first).toContain('RippleText')
    expect(first).toContain('RipplePageForState')

    expect(removeRuntimeImports(first, file, specifier, ['RippleText', 'RipplePageForState'])).toBe(source)
  })
})
