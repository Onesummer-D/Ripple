import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import type { AppliedRevision, EditSession } from './model'
import type { CandidateRecord } from './candidate'
import { assertCandidateCurrent } from './candidate'
import { digestTrackedTree, readProjectSnapshot } from './project'

export class PatchApplyError extends Error {
  constructor(message: string) { super(message); this.name = 'PatchApplyError' }
}

const sha256 = (value: Uint8Array) => createHash('sha256').update(value).digest('hex')
const git = (root: string, args: string[]) => execFileSync('git', ['-c', 'core.autocrlf=false', '-C', root, ...args], { stdio: 'pipe', maxBuffer: 32 * 1024 * 1024 })

function approvedCandidate(session: EditSession, candidate: CandidateRecord) {
  const approved = session.candidate
  const approval = session.approval
  const run = session.runs.find(item => item.id === approval?.verificationRunId)
  if (session.status !== 'approved' || !approved || !approval || !run || run.status !== 'passed' ||
      approval.candidateId !== candidate.id || approved.id !== candidate.id || approved.patchHash !== candidate.patchHash ||
      approved.baseSourceDigest !== candidate.baseSourceDigest || approved.candidateTreeDigest !== candidate.candidateTreeDigest ||
      approved.scopeDecisionId !== candidate.scopeDecisionId || approved.scopeVersion !== candidate.scopeVersion ||
      run.candidateId !== candidate.id || run.patchHash !== candidate.patchHash || run.baseSourceDigest !== candidate.baseSourceDigest ||
      run.candidateTreeDigest !== candidate.candidateTreeDigest || !session.projectRevision.gitCommit) {
    throw new PatchApplyError('只有当前已验证并获批的同一候选补丁可以应用')
  }
  return { approval }
}

function readPatch(candidate: CandidateRecord): string {
  if (!candidate.artifactPath || !fs.existsSync(candidate.artifactPath)) throw new PatchApplyError('候选补丁工件不存在')
  const bytes = fs.readFileSync(candidate.artifactPath)
  if (sha256(bytes) !== candidate.patchHash) throw new PatchApplyError('补丁工件哈希已变化')
  return candidate.artifactPath
}

export function applyApprovedCandidate(session: EditSession, candidate: CandidateRecord, at = new Date().toISOString()): AppliedRevision {
  const { approval } = approvedCandidate(session, candidate)
  assertCandidateCurrent(candidate)
  const baseline = readProjectSnapshot(candidate.projectRoot)
  if (baseline.revision.sourceDigest !== candidate.baseSourceDigest || baseline.revision.gitCommit !== session.projectRevision.gitCommit) {
    throw new PatchApplyError('原工程已偏离候选基线；拒绝覆盖其变更')
  }
  const patchPath = readPatch(candidate)
  git(candidate.projectRoot, ['apply', '--check', '--binary', '--', patchPath])
  git(candidate.projectRoot, ['apply', '--binary', '--', patchPath])

  const targetDigest = digestTrackedTree(candidate.projectRoot)
  if (targetDigest !== candidate.candidateTreeDigest) {
    try {
      git(candidate.projectRoot, ['apply', '--reverse', '--binary', '--', patchPath])
    } catch (rollbackError) {
      throw new PatchApplyError(`应用后的源码与已验证候选不一致，自动恢复也失败；现场已保留以便人工处理：${String(rollbackError)}`)
    }
    if (digestTrackedTree(candidate.projectRoot) !== candidate.baseSourceDigest) {
      throw new PatchApplyError('应用结果不匹配候选，补丁已逆向但原基线摘要仍不匹配；现场已保留')
    }
    throw new PatchApplyError('补丁应用结果与已验证候选树摘要不一致；已恢复原基线')
  }
  return {
    candidateId: candidate.id,
    approval: { ...approval },
    appliedPatchHash: candidate.patchHash,
    baseSourceDigest: candidate.baseSourceDigest,
    targetSourceDigest: candidate.candidateTreeDigest,
    appliedAt: at,
    commit: baseline.revision.gitCommit,
  }
}

export function rollbackAppliedCandidate(session: EditSession, candidate: CandidateRecord): void {
  const applied = session.applied
  if (session.status !== 'applied' || !applied || applied.candidateId !== candidate.id || applied.appliedPatchHash !== candidate.patchHash ||
      applied.baseSourceDigest !== candidate.baseSourceDigest || applied.targetSourceDigest !== candidate.candidateTreeDigest ||
      applied.commit !== session.projectRevision.gitCommit) {
    throw new PatchApplyError('回滚身份与已应用的候选补丁不匹配')
  }
  const current = readProjectSnapshot(candidate.projectRoot, false)
  if (current.revision.gitCommit !== applied.commit || current.revision.sourceDigest !== applied.targetSourceDigest) {
    throw new PatchApplyError('原工程在应用后又发生变化；拒绝回滚以免覆盖新修改')
  }
  const patchPath = readPatch(candidate)
  git(candidate.projectRoot, ['apply', '--reverse', '--check', '--binary', '--', patchPath])
  git(candidate.projectRoot, ['apply', '--reverse', '--binary', '--', patchPath])
  if (digestTrackedTree(candidate.projectRoot) !== applied.baseSourceDigest) {
    throw new PatchApplyError('回滚后工程摘要不等于候选基线；现场已保留以便人工处理')
  }
}
