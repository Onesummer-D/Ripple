import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'

const root = process.cwd()
const dir = path.resolve(root, 'docs/acceptance/2026-11-04/relation-id-v03-production')
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const git = args => execFileSync('git', args, { cwd: root, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 })
const commits = {
  reviewed: '93d528fce7a329c3e35c62d013dfaa1675cfc3fa',
  implementation: 'f6d1edf286d40314e83aa3121214dcf85d824fc0',
  integrationBase: 'fb2efe35c447eadf262d55f1d9755bb26cecabda',
}
const files = ['src/core/relation-id-v1.ts', 'src/core/relation-id-v1.test.ts', 'src/core/project.ts']
const createPatch = (from, to, name) => {
  const bytes = git(['diff', '--binary', '--full-index', from, to, '--', ...files])
  fs.writeFileSync(path.join(dir, name), bytes)
  return { path: name, bytes: bytes.length, sha256: sha256(bytes) }
}
const sourcePatch = createPatch(commits.reviewed, commits.implementation, 'source-safety-diff-93-to-f6.patch')
const integrationPatch = createPatch(commits.integrationBase, commits.implementation, 'source-integration-diff-fb2-to-f6.patch')
const stat = (from, to) => git(['diff', '--numstat', from, to, '--', ...files]).toString('utf8').trim().split(/\r?\n/).filter(Boolean).map(line => {
  const [added, deleted, file] = line.split('\t')
  return { file, added: Number(added), deleted: Number(deleted) }
})
const out = { schemaVersion: 'relation-id-v03-fb2-diff-evidence/v1', commits, files, reviewedToImplementation: { ...sourcePatch, numstat: stat(commits.reviewed, commits.implementation) }, integrationBaseToImplementation: { ...integrationPatch, numstat: stat(commits.integrationBase, commits.implementation) } }
fs.writeFileSync(path.join(dir, 'source-diff-fb2-evidence.json'), `${JSON.stringify(out, null, 2)}\n`)
console.log(JSON.stringify(out, null, 2))
