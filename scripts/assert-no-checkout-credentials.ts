import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { SpawnSyncReturns } from 'node:child_process'

type GitRunner = (args: string[]) => Pick<SpawnSyncReturns<Buffer>, 'status' | 'error'>

export function assertNoCheckoutCredentials(
  checkoutPaths: string[],
  runGit: GitRunner = args => spawnSync('git', args, { stdio: 'ignore' }),
): void {
  for (const checkoutPath of checkoutPaths) {
    const checkout = runGit(['-C', checkoutPath, 'rev-parse', '--git-dir'])
    if (checkout.error || checkout.status !== 0) throw new Error('Unable to inspect a checkout before project execution.')

    const authorization = runGit(['-C', checkoutPath, 'config', '--local', '--get-regexp', '^http\\..*\\.extraheader$'])
    if (authorization.status === 0) throw new Error('Checkout authorization unexpectedly persisted.')
    if (authorization.error || authorization.status !== 1) {
      throw new Error('Unable to inspect checkout authorization before project execution.')
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const checkoutPaths = process.argv.slice(2)
  if (checkoutPaths.length === 0) throw new Error('At least one checkout path is required.')
  assertNoCheckoutCredentials(checkoutPaths)
}
