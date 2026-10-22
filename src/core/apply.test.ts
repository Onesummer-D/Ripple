// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { assertAppliedCandidatePreviewable } from './apply'
import { readProjectSnapshot } from './project'
import type { CandidateRecord } from './candidate'
import type { AppliedRevision, EditSession } from './model'

const roots: string[] = []
const tempParent = path.join(process.cwd(), 'node_modules', '.tmp')
fs.mkdirSync(tempParent, { recursive: true })

/** Some Git files are read-only; clear the read-only bit before removing (keep directories traversable). */
function removeTree(root: string): void {
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const target = path.join(dir, entry.name)
      try { fs.chmodSync(target, entry.isDirectory() ? 0o777 : 0o666) } catch { /* keep walking */ }
      if (entry.isDirectory()) walk(target)
    }
  }
  try { walk(root) } catch { /* root may already be gone */ }
  fs.rmSync(root, { recursive: true, force: true })
}

afterEach(() => {
  for (const root of roots.splice(0)) removeTree(root)
})

function makeAppliedFixture(): { root: string; session: EditSession; candidate: CandidateRecord } {
  const root = fs.mkdtempSync(path.join(tempParent, 'ripple-apply-'))
  roots.push(root)
  fs.mkdirSync(path.join(root, 'src'), { recursive: true })
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'apply-fixture', private: true }))
  fs.writeFileSync(path.join(root, 'src', 'a.txt'), 'baseline\n')
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' })
  git('init', '-q'); git('config', 'user.email', 'ripple-test@example.invalid'); git('config', 'user.name', 'Ripple apply test'); git('add', '.'); git('commit', '-qm', 'baseline')
  const revision = readProjectSnapshot(root, false).revision
  const candidate: CandidateRecord = {
    id: 'candidate-apply-preview', baseSourceDigest: revision.sourceDigest, scopeDecisionId: 'scope-apply', scopeVersion: 1,
    patchHash: 'patch-hash', candidateTreeDigest: revision.sourceDigest, projectRoot: root, markerPath: 'src/a.txt',
    modifiedPaths: ['src/a.txt'], operationTargetRefs: {}, operations: [], diffArtifact: 'artifact',
  }
  const applied: AppliedRevision = {
    candidateId: candidate.id, approval: { candidateId: candidate.id, verificationRunId: 'run-apply', by: 'test-user', at: '2026-10-22T00:00:00Z' },
    appliedPatchHash: candidate.patchHash, baseSourceDigest: candidate.baseSourceDigest, targetSourceDigest: candidate.candidateTreeDigest,
    appliedAt: '2026-10-22T00:00:01Z', commit: revision.gitCommit,
  }
  const session: EditSession = {
    id: 'session-apply-preview', projectRevision: revision, rawIntent: 'preview the applied revision', selectedElementRefs: [],
    operations: [], status: 'applied', runs: [], applied,
  }
  return { root, session, candidate }
}

describe('assertAppliedCandidatePreviewable', () => {
  it('accepts a consistent applied record bound to the unchanged applied tree', () => {
    const { session, candidate } = makeAppliedFixture()
    expect(() => assertAppliedCandidatePreviewable(session, candidate)).not.toThrow()
  })

  it('rejects sessions that are not the currently applied candidate', () => {
    const { session, candidate } = makeAppliedFixture()
    expect(() => assertAppliedCandidatePreviewable({ ...session, status: 'approved' }, candidate)).toThrow(/身份不一致/)
    expect(() => assertAppliedCandidatePreviewable({ ...session, applied: undefined }, candidate)).toThrow(/身份不一致/)
    expect(() => assertAppliedCandidatePreviewable(session, { ...candidate, id: 'candidate-other' })).toThrow(/身份不一致/)
    expect(() => assertAppliedCandidatePreviewable(session, { ...candidate, patchHash: 'tampered-hash' })).toThrow(/身份不一致/)
    expect(() => assertAppliedCandidatePreviewable(session, { ...candidate, candidateTreeDigest: 'tampered-digest' })).toThrow(/身份不一致/)
  })

  it('rejects preview when HEAD moved, the applied tree changed, or unexpected untracked files appeared', () => {
    const { root, session, candidate } = makeAppliedFixture()
    fs.writeFileSync(path.join(root, 'src', 'a.txt'), 'modified after apply\n')
    expect(() => assertAppliedCandidatePreviewable(session, candidate)).toThrow(/拒绝预览/)
    execFileSync('git', ['-C', root, 'checkout', '--', 'src/a.txt'], { stdio: 'pipe' })

    fs.writeFileSync(path.join(root, 'unexpected.txt'), 'surprise')
    expect(() => assertAppliedCandidatePreviewable(session, candidate)).toThrow(/拒绝预览/)
    fs.rmSync(path.join(root, 'unexpected.txt'))

    fs.writeFileSync(path.join(root, 'src', 'b.txt'), 'new tracked file\n')
    execFileSync('git', ['-C', root, 'add', 'src/b.txt'], { stdio: 'pipe' })
    execFileSync('git', ['-C', root, '-c', 'user.email=ripple-test@example.invalid', '-c', 'user.name=Ripple apply test', 'commit', '-qm', 'moved head'], { stdio: 'pipe' })
    expect(() => assertAppliedCandidatePreviewable(session, candidate)).toThrow(/拒绝预览/)
  })
})
