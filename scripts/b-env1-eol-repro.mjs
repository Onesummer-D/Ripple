/** B-ENV-1 pinned repro: CRLF vs LF working-tree state of the fixed codescandy
 *  checkout. Git blobs are LF; a CRLF working tree arises when the checkout was
 *  materialized with core.autocrlf=true (git still considers such a tree CLEAN).
 *  This script records, for BOTH states on the SAME pinned HEAD:
 *    - core.autocrlf (repo/global), git status cleanliness, git blob identity
 *    - on-disk bytes (size/sha256/EOL)
 *    - Ripple snapshot digest vs fresh-worktree digests (autocrlf=false/true)
 *    - Ripple graph offsets and candidate (node.location) offsets of the
 *      ProfileHeader "Overview" TEXT target
 *  Data only — handed to A to judge checkout policy / source-version contract.
 *
 *  Safety: only the passed scratch checkout is temporarily converted and it is
 *  ALWAYS restored (git checkout -f) in finally; worktrees are script-created.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { analyzeProject, readProjectSnapshot, digestTrackedTree } from '../src/core/project.ts'

const repo = process.argv[2]
const artifactsDir = path.resolve(process.argv[3] ?? 'test-results')
const expected = 'b700bbd55b31a62fe04d4cd8210fc37232f0c9f0'
const actual = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
if (actual !== expected) throw new Error(`Refusing unpinned checkout: ${actual}`)

const TARGET = 'src/sub-components/profile/ProfileHeader.tsx'
const TEXT_EXT = /\.(ts|tsx|js|jsx|json|scss|css|html|md|txt|svg|yml|yaml|map)$/i
const sha256 = buf => createHash('sha256').update(buf).digest('hex')
const git = (root, args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
const porcelain = (root) => git(root, ['status', '--porcelain'])
const trackedFiles = (root) => git(root, ['ls-files']).split('\n').filter(Boolean)

const measure = (root, label) => {
  const graph = analyzeProject(root, true)
  const literal = graph.nodes.find(n => n.kind === 'data' && n.value?.trim() === 'Overview' && n.location?.path.endsWith('ProfileHeader.tsx'))
  const bytes = fs.readFileSync(path.join(root, TARGET))
  return {
    state: label,
    eol: bytes.includes(Buffer.from('\r\n')) ? 'CRLF' : 'LF',
    fileBytes: bytes.length,
    fileSha256: sha256(bytes),
    gitClean: porcelain(root) === '',
    snapshotDigest: readProjectSnapshot(root).revision.sourceDigest,
    graphOffsets: literal ? {
      literalId: literal.id,
      candidateStart: literal.location.start,
      candidateEnd: literal.location.end,
    } : null,
  }
}

const toCrlf = () => {
  for (const f of trackedFiles(repo)) {
    if (!TEXT_EXT.test(f)) continue
    const p = path.join(repo, f)
    const buf = fs.readFileSync(p)
    if (buf.includes(Buffer.from('\r\n'))) continue
    fs.writeFileSync(p, buf.toString('utf8').replace(/\n/g, '\r\n'))
  }
}

const tempParent = fs.mkdtempSync(path.join(os.tmpdir(), 'ripple-b-env1-'))
const wtFalse = path.join(tempParent, 'wt-autocrlf-false')
const wtTrue = path.join(tempParent, 'wt-autocrlf-true')
const savedAutocrlf = (() => { try { return git(repo, ['config', '--get', 'core.autocrlf']) } catch { return null } })()
let result
try {
  const blob = {
    blobName: git(repo, ['rev-parse', `HEAD:${TARGET}`]),
    blobSha256: sha256(execFileSync('git', ['-C', repo, 'cat-file', 'blob', `HEAD:${TARGET}`])),
    blobBytes: Number(git(repo, ['cat-file', '-s', `HEAD:${TARGET}`])),
    blobEol: execFileSync('git', ['-C', repo, 'cat-file', 'blob', `HEAD:${TARGET}`]).includes(Buffer.from('\r\n')) ? 'CRLF' : 'LF',
  }

  const lf = measure(repo, 'LF')

  // CRLF state: convert tracked text files, declare autocrlf=true, then force a
  // checkout so the index stat cache is rewritten under autocrlf=true — this
  // reproduces the original-clone condition where git considers CRLF bytes CLEAN.
  toCrlf()
  execFileSync('git', ['-C', repo, 'config', 'core.autocrlf', 'true'], { stdio: 'pipe' })
  execFileSync('git', ['-c', 'core.autocrlf=true', '-C', repo, 'checkout', '-f', 'HEAD'], { stdio: 'pipe' })
  let crlf
  try {
    crlf = measure(repo, 'CRLF')
  } catch (error) {
    crlf = { state: 'CRLF', measureError: error instanceof Error ? error.message : String(error), gitClean: porcelain(repo) === '', porcelainSample: porcelain(repo).split('\n').slice(0, 5) }
  }

  // reference worktrees: what `git worktree add` would produce under each policy
  execFileSync('git', ['-c', 'core.autocrlf=false', '-C', repo, 'worktree', 'add', '--detach', wtFalse, actual], { stdio: 'pipe' })
  execFileSync('git', ['-c', 'core.autocrlf=true', '-C', repo, 'worktree', 'add', '--detach', wtTrue, actual], { stdio: 'pipe' })
  const worktreeDigests = {
    worktreeAutocrlfFalse: digestTrackedTree(wtFalse),
    worktreeAutocrlfTrue: digestTrackedTree(wtTrue),
  }

  result = {
    schemaVersion: 1,
    codescandySha: actual,
    recordedAt: new Date().toISOString(),
    gitConfig: {
      repoCoreAutocrlfDuringCrlfState: 'true',
      repoCoreAutocrlfRestored: savedAutocrlf,
      globalCoreAutocrlf: (() => { try { return execFileSync('git', ['config', '--global', '--get', 'core.autocrlf'], { encoding: 'utf8' }).trim() || null } catch { return null } })(),
      mechanism: 'blob 为 LF；autocrlf=true 检出的工作树为 CRLF 且 git 视角干净；Ripple 用 -c core.autocrlf=false 建候选 worktree 得到 LF 字节 → 摘要不一致。',
    },
    gitBlob: blob,
    states: { lf, crlf },
    worktreeDigests,
    mismatchDemonstrated: crlf.snapshotDigest !== worktreeDigests.worktreeAutocrlfFalse,
  }
} finally {
  // restore: original config, then delete+re-extract all tracked files (bypasses
  // the stat-cache illusion that lets CRLF bytes look clean), verify target bytes.
  try {
    if (savedAutocrlf === null) execFileSync('git', ['-C', repo, 'config', '--unset', 'core.autocrlf'], { stdio: 'pipe' })
    else execFileSync('git', ['-C', repo, 'config', 'core.autocrlf', savedAutocrlf], { stdio: 'pipe' })
  } catch { /* best effort */ }
  try {
    const files = trackedFiles(repo)
    for (const f of files) { try { fs.rmSync(path.join(repo, f), { force: true }) } catch { /* best effort */ } }
    execFileSync('git', ['-C', repo, 'checkout', '--', '.'], { stdio: 'pipe' })
  } catch { /* best effort */ }
  const blobBytes = execFileSync('git', ['-C', repo, 'cat-file', 'blob', `HEAD:${TARGET}`])
  if (sha256(fs.readFileSync(path.join(repo, TARGET))) !== sha256(blobBytes)) {
    for (const f of trackedFiles(repo)) {
      if (!TEXT_EXT.test(f)) continue
      const p = path.join(repo, f)
      const buf = fs.readFileSync(p)
      fs.writeFileSync(p, buf.toString('utf8').replace(/\r\n/g, '\n'))
    }
    try { execFileSync('git', ['-C', repo, 'checkout', '--', '.'], { stdio: 'pipe' }) } catch { /* best effort */ }
  }
  for (const wt of [wtFalse, wtTrue]) {
    try { execFileSync('git', ['-c', 'core.longpaths=true', '-C', repo, 'worktree', 'remove', '--force', wt], { stdio: 'pipe' }) } catch { /* best effort */ }
  }
  if (path.basename(tempParent).startsWith('ripple-b-env1-')) fs.rmSync(tempParent, { recursive: true, force: true })
  fs.mkdirSync(artifactsDir, { recursive: true })
  if (result) fs.writeFileSync(path.join(artifactsDir, 'b-env1-eol-repro.json'), JSON.stringify(result, null, 2) + '\n')
}
console.log(JSON.stringify(result, null, 2))
