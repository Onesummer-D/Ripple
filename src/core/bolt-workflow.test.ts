import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const workflow = readFileSync(resolve(process.cwd(), '.github', 'workflows', 'bolt-acceptance.yml'), 'utf8')

describe('manual Bolt workflow credential boundary', () => {
  it('limits the workflow token to read access and never persists checkout credentials before project code runs', () => {
    expect(workflow).toMatch(/^permissions:\s*\r?\n  contents: read\s*$/m)
    const checkoutSteps = workflow
      .split(/(?=^      - )/m)
      .filter(block => block.startsWith('      - uses: actions/checkout@v4'))
      .map(block => block.split(/\r?\n      - /, 1)[0])

    expect(checkoutSteps).toHaveLength(2)
    for (const checkout of checkoutSteps) expect(checkout).toMatch(/persist-credentials: false/)
  })
})

