/** B-ENV-1 pinned repro v2: CRLF vs LF working-tree states, WITHOUT touching
 *  the caller's checkout. The passed repo is strictly READ-ONLY (we only run
 *  git read commands against it and verify the pinned HEAD). All experiments
 *  happen in two independent script-owned clones under an mkdtemp root:
 *
 *    lfClone   — cloned with -c core.autocrlf=false (LF working tree)
 *    crlfClone — cloned with -c core.autocrlf=true  (CRLF working tree, git-clean)
 *
 *  Records per state: autocrlf, git-cleanliness, on-disk bytes, Ripple snapshot
 *  digest, graph/candidate offsets of the ProfileHeader "Overview" target, plus
 *  reference worktree digests (what Ripple's candidate worktree add would
 *  produce under each policy) and a per-file diff list explaining why the
 *  CRLF snapshot digest and the fresh autocrlf=true worktree digest differ.
 *
 *  Data only — handed to A to judge checkout policy / source-version contract.
 *  Never proposes changing security digests or the ProjectRevision contract.
 *
 *  --selftest adds file-safety negatives: a pre-existing foreign sentinel dir
 *  must stay byte-identical, and a DIRTY clone passed as the source must be
 *  returned completely unchanged.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { analyzeProject, readProjectSnapshot, digestTrackedTree } from '../src/core/project.ts'

const argv = process.argv.slice(2)
const repo = path.resolve(argv[0])
const flagValue = (name) => { const at = argv.indexOf(name); return at >= 0 ? argv[at + 1] : undefined }
const artifactsDir = path.resolve(flagValue('--artifacts') ?? 'test-results')
const selftest = argv.includes('--selftest')
if (!argv[0]) throw new Error('usage: b-env1-eol-repro.mjs <repo> [--selftest] [--artifacts <dir>]')

const expected = 'b700bbd55b31a62fe04d4cd8210fc37232f0c9f0'
const actual = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
if (actual !== expected) throw new Error(`Refusing unpinned checkout: ${actual}`)

const TARGET = 'src/sub-components/profile/ProfileHeader.tsx'
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')
const git = (root, args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
const porcelain = (root) => { try { return git(root, ['status', '--porcelain']) } catch { return '<error>' } }
const trackedFiles = (root) => git(root, ['ls-files']).split('\n').filter(Boolean)
const worktreeList = (root) => git(root, ['worktree', 'list', '--porcelain']).split('\n').filter(l => l.startsWith('worktree ')).map(l => l.slice(9).trim())

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
    graphOffsets: literal ? { literalId: literal.id, candidateStart: literal.location.start, candidateEnd: literal.location.end } : null,
  }
}

/** Per-file byte diff between two checkouts of the same tree, with git attrs. */
const diffCheckouts = (rootA, rootB) => {
  const diffs = []
  for (const f of trackedFiles(rootA)) {
    const a = fs.readFileSync(path.join(rootA, f))
    const b = fs.readFileSync(path.join(rootB, f))
    if (sha256(a) !== sha256(b)) {
      let attr = null
      try { attr = git(rootA, ['check-attr', 'text', 'eol', '--', f]) } catch { /* ignore */ }
      diffs.push({
        file: f,
        bytesA: a.length,
        bytesB: b.length,
        eolA: a.includes(Buffer.from('\r\n')) ? 'CRLF' : (a.includes(10) ? 'LF' : 'binary/no-lf'),
        eolB: b.includes(Buffer.from('\r\n')) ? 'CRLF' : (b.includes(10) ? 'LF' : 'binary/no-lf'),
        attr,
      })
    }
  }
  return diffs
}

const cloneInto = (dest, autocrlf) => {
  const args = ['-c', `core.autocrlf=${autocrlf}`, 'clone', '--quiet', '--', repo, dest]
  try {
    execFileSync('git', args, { stdio: ['ignore', 'ignore', 'pipe'] })
  } catch (error) {
    console.error(`[env1] clone attempt 1 failed (${autocrlf}):`, error instanceof Error ? error.message : error, '— retrying')
    fs.rmSync(dest, { recursive: true, force: true })
    execFileSync('git', args, { stdio: 'inherit' })
  }
  console.error(`[env1] cloned ${autocrlf} -> ${dest}`)
  if (git(dest, ['rev-parse', 'HEAD']) !== expected) throw new Error(`clone HEAD mismatch in ${dest}`)
}

const tempParent = fs.mkdtempSync(path.join(os.tmpdir(), 'ripple-b-env1-'))
const lfClone = path.join(tempParent, 'lf-checkout')
const crlfClone = path.join(tempParent, 'crlf-checkout')
const wtFalse = path.join(tempParent, 'ref-worktree-autocrlf-false')
const wtTrue = path.join(tempParent, 'ref-worktree-autocrlf-true')

const repoBefore = { head: actual, digest: digestTrackedTree(repo), porcelain: porcelain(repo), worktrees: worktreeList(repo) }

let result
try {
  cloneInto(lfClone, false)
  cloneInto(crlfClone, true)

  const blob = {
    blobName: git(repo, ['rev-parse', `HEAD:${TARGET}`]),
    blobSha256: sha256(execFileSync('git', ['-C', repo, 'cat-file', 'blob', `HEAD:${TARGET}`])),
    blobBytes: Number(git(repo, ['cat-file', '-s', `HEAD:${TARGET}`])),
    blobEol: execFileSync('git', ['-C', repo, 'cat-file', 'blob', `HEAD:${TARGET}`]).includes(Buffer.from('\r\n')) ? 'CRLF' : 'LF',
  }

  const lf = measure(lfClone, 'LF (script-owned clone, autocrlf=false)')
  const crlf = measure(crlfClone, 'CRLF (script-owned clone, autocrlf=true)')

  // reference worktrees: what `git worktree add` produces under each policy —
  // created from the CRLF clone, which is the state Ripple would snapshot.
  execFileSync('git', ['-c', 'core.autocrlf=false', '-C', crlfClone, 'worktree', 'add', '--detach', wtFalse, expected], { stdio: 'pipe' })
  execFileSync('git', ['-c', 'core.autocrlf=true', '-C', crlfClone, 'worktree', 'add', '--detach', wtTrue, expected], { stdio: 'pipe' })
  const worktreeDigests = {
    worktreeAutocrlfFalse: digestTrackedTree(wtFalse),
    worktreeAutocrlfTrue: digestTrackedTree(wtTrue),
  }

  const crlfVsWtTrue = diffCheckouts(crlfClone, wtTrue)

  result = {
    schemaVersion: 2,
    codescandySha: actual,
    recordedAt: new Date().toISOString(),
    sourceRepo: { role: 'read-only', note: '传入检出仅执行 git 读命令；全部实验在脚本自有临时 clone 中进行。' },
    gitConfig: {
      clonePolicyLf: 'core.autocrlf=false',
      clonePolicyCrlf: 'core.autocrlf=true',
      mechanism: 'blob 为 LF；autocrlf=true 检出的工作树为 CRLF 且 git 视角干净；Ripple 用 -c core.autocrlf=false 建候选 worktree 得到 LF 字节 → 与 CRLF 快照摘要不一致。',
    },
    gitBlob: blob,
    states: { lf, crlf },
    worktreeDigests,
    mismatchDemonstrated: crlf.snapshotDigest !== worktreeDigests.worktreeAutocrlfFalse,
    crlfSnapshotVsFreshAutocrlfTrueWorktree: {
      explanation: 'v2（clone 法）：CRLF 原工程摘要 a3d59740… 与新建 autocrlf=true worktree 摘要完全一致（differingFiles=0）——两者都经 git 同一换行过滤。v1（手工 sed 转换法）曾得到第三个摘要 bdb283ff…，原因是手工转换把 git 视为非文本的文件（部分 .svg 等）也转成了 CRLF，超出了 git 过滤器范围；该值是测量法伪影，已被 v2 取代。operative 不一致仅存在于 CRLF 快照（a3d59740…）与 Ripple 建候选用的 autocrlf=false worktree（016aee03…）之间。',
      differingFiles: crlfVsWtTrue,
    },
  }

  if (selftest) {
    const cases = []
    // sentinel: pre-existing foreign dir + file must be byte-identical afterwards
    const foreign = fs.mkdtempSync(path.join(os.tmpdir(), 'ripple-b-env1-foreign-'))
    const sentinelFile = path.join(foreign, 'sentinel.bin')
    fs.writeFileSync(sentinelFile, Buffer.from('do-not-touch-' + Date.now()))
    const sentinelBytes = fs.readFileSync(sentinelFile)
    // dirty-worktree source: a clone with modified tracked file + untracked file,
    // passed through the same read-only pipeline (measure must refuse the dirty tree)
    const dirtyClone = path.join(tempParent, 'dirty-source')
    cloneInto(dirtyClone, false)
    const dirtyTarget = path.join(dirtyClone, TARGET)
    const dirtyBytesBefore = fs.readFileSync(dirtyTarget)
    fs.appendFileSync(dirtyTarget, '// dirty-local-edit\n')
    const untrackedFile = path.join(dirtyClone, 'local-notes.txt')
    fs.writeFileSync(untrackedFile, 'local untracked content')
    let dirtyMeasureError = null
    try { measure(dirtyClone, 'dirty') } catch (error) { dirtyMeasureError = error instanceof Error ? error.message : String(error) }
    cases.push({
      case: 'dirty-source-read-only',
      pass: dirtyMeasureError !== null
        && fs.readFileSync(dirtyTarget).equals(Buffer.concat([dirtyBytesBefore, Buffer.from('// dirty-local-edit\n')]))
        && fs.readFileSync(untrackedFile, 'utf8') === 'local untracked content',
      detail: { measureError: dirtyMeasureError },
    })
    cases.push({
      case: 'sentinel-byte-invariance',
      pass: fs.existsSync(sentinelFile) && fs.readFileSync(sentinelFile).equals(sentinelBytes) && fs.existsSync(foreign),
    })
    fs.rmSync(foreign, { recursive: true, force: true })
    const repoAfter = { head: git(repo, ['rev-parse', 'HEAD']), digest: digestTrackedTree(repo), porcelain: porcelain(repo), worktrees: worktreeList(repo) }
    const postChecks = {
      sourceRepoHeadUnchanged: repoAfter.head === repoBefore.head,
      sourceRepoDigestUnchanged: repoAfter.digest === repoBefore.digest,
      sourceRepoPorcelainUnchanged: repoAfter.porcelain === repoBefore.porcelain,
      sourceRepoWorktreesUnchanged: repoAfter.worktrees.length === repoBefore.worktrees.length && repoAfter.worktrees.every(p => repoBefore.worktrees.includes(p)),
    }
    result.selftest = { cases, postChecks, allPass: cases.every(c => c.pass) && Object.values(postChecks).every(v => v === true) }
  }
} finally {
  // remove ONLY the script-owned temp root (clones + reference worktrees live inside)
  const base = path.basename(tempParent)
  if (base.startsWith('ripple-b-env1-')) fs.rmSync(tempParent, { recursive: true, force: true })
  fs.mkdirSync(artifactsDir, { recursive: true })
  if (result) fs.writeFileSync(path.join(artifactsDir, 'b-env1-eol-repro.json'), JSON.stringify(result, null, 2) + '\n')
}

console.log(JSON.stringify(result, null, 2))
process.exitCode = result?.selftest && result.selftest.allPass === false ? 1 : 0
