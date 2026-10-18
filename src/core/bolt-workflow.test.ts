import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { assertNoCheckoutCredentials } from '../../scripts/assert-no-checkout-credentials'

const workflow = readFileSync(resolve(process.cwd(), '.github', 'workflows', 'bolt-acceptance.yml'), 'utf8')

describe('manual Bolt workflow credential boundary', () => {
  it('limits the workflow token to read access and never persists checkout credentials before project code runs', () => {
    expect(workflow).toMatch(/^permissions:\r?\n  contents: read\r?\n\r?\njobs:$/m)
    expect(workflow).not.toMatch(/^ {4,}permissions:/m)
    expect(workflow.match(/\$\{\{\s*secrets\.BOLT_REPO_TOKEN\s*\}\}/g)).toHaveLength(1)

    const checkoutSteps = workflow
      .split(/(?=^      - )/m)
      .filter(block => block.startsWith('      - uses: actions/checkout@v4'))
      .map(block => block.split(/\r?\n      - /, 1)[0])

    expect(checkoutSteps).toHaveLength(2)
    expect(checkoutSteps[0]).toMatch(/persist-credentials: false/)
    expect(checkoutSteps[0]).not.toContain('BOLT_REPO_TOKEN')
    expect(checkoutSteps[1]).toMatch(/repository: Onesummer-D\/ripple-qingye-bolt[\s\S]*token: \$\{\{ secrets\.BOLT_REPO_TOKEN \}\}[\s\S]*persist-credentials: false/)

    const credentialAssertion = workflow.indexOf('- name: Assert checkout credentials were not persisted')
    const firstProjectExecution = workflow.indexOf('- name: Install Bolt dependencies without running lifecycle scripts')
    expect(credentialAssertion).toBeGreaterThan(-1)
    expect(firstProjectExecution).toBeGreaterThan(credentialAssertion)
    expect(workflow).toContain('scripts/assert-no-checkout-credentials.ts')
    expect(workflow).not.toMatch(/continue-on-error:\s*true/)
  })

  it.each([
    { configStatus: 0, failure: 'Checkout authorization unexpectedly persisted.' },
    { configStatus: 1, failure: null },
    { configStatus: 128, failure: 'Unable to inspect checkout authorization before project execution.' },
  ])('treats git config exit $configStatus according to Git semantics', ({ configStatus, failure }) => {
    const results = [{ status: 0 }, { status: configStatus }]
    const commands: string[][] = []
    const runGit = (args: string[]) => {
      commands.push(args)
      return results.shift()!
    }

    if (failure) expect(() => assertNoCheckoutCredentials(['/checkout'], runGit)).toThrow(failure)
    else expect(() => assertNoCheckoutCredentials(['/checkout'], runGit)).not.toThrow()

    expect(commands).toEqual([
      ['-C', '/checkout', 'rev-parse', '--git-dir'],
      ['-C', '/checkout', 'config', '--local', '--get-regexp', '^http\\..*\\.extraheader$'],
    ])
  })

  it('fails before reading config when the checkout is not a Git worktree', () => {
    const commands: string[][] = []
    const runGit = (args: string[]) => {
      commands.push(args)
      return { status: 128 }
    }

    expect(() => assertNoCheckoutCredentials(['/missing'], runGit)).toThrow(
      'Unable to inspect a checkout before project execution.',
    )
    expect(commands).toEqual([['-C', '/missing', 'rev-parse', '--git-dir']])
  })
})
