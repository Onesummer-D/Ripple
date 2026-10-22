import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { analyzeProject, readProjectSnapshot, digestTrackedTree } from '../src/core/project.ts'

const repo = process.argv[2]
const tempWt = path.join(path.dirname(repo), '.ripple-wt-debug')
try { execFileSync('git', ['-c', 'core.longpaths=true', '-C', repo, 'worktree', 'remove', '--force', tempWt], { stdio: 'pipe' }) } catch {}
fs.rmSync(tempWt, { recursive: true, force: true })
const snapshot = readProjectSnapshot(repo)
execFileSync('git', ['-c', 'core.autocrlf=false', '-C', repo, 'worktree', 'add', '--detach', tempWt, snapshot.revision.gitCommit], { stdio: 'pipe' })
const wtDigest = digestTrackedTree(tempWt)
const origDigest = snapshot.revision.sourceDigest
console.log('snapshot digest:', origDigest)
console.log('worktree digest:', wtDigest)
console.log('tracked files:', snapshot.trackedFiles.length)
// per-file diff
const { createHash } = await import('node:crypto')
const hash = b => createHash('sha256').update(b).digest('hex')
const diffs = []
for (const f of snapshot.trackedFiles) {
  const a = fs.readFileSync(path.join(snapshot.root, f))
  let b
  try { b = fs.readFileSync(path.join(tempWt, f)) } catch { diffs.push({ file: f, issue: 'missing in worktree' }); continue }
  if (hash(a) !== hash(b)) diffs.push({ file: f, sizeA: a.length, sizeB: b.length, headA: JSON.stringify(a.slice(0, 40).toString('utf8').slice(0, 60)), headB: JSON.stringify(b.slice(0, 40).toString('utf8').slice(0, 60)) })
}
console.log('differing files:', diffs.length)
for (const d of diffs.slice(0, 10)) console.log(JSON.stringify(d))
try { execFileSync('git', ['-c', 'core.longpaths=true', '-C', repo, 'worktree', 'remove', '--force', tempWt], { stdio: 'pipe' }) } catch {}
fs.rmSync(tempWt, { recursive: true, force: true })
