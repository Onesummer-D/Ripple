import { describe, expect, it } from 'vitest'
import { projectPreviewViewports } from './project-viewports'

describe('Project-first preview viewports', () => {
  it('keeps the product baseline and existing 390px mobile coverage in one ordered contract', () => {
    expect(projectPreviewViewports.map(({ width }) => width)).toEqual([1440, 768, 375, 390])
    expect(new Set(projectPreviewViewports.map(({ name }) => name)).size).toBe(projectPreviewViewports.length)
  })
})
