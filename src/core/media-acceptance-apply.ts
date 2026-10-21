import type { EditSession } from './model'
import type { CandidateRecord } from './candidate'
import { applyApprovedCandidate, rollbackAppliedCandidate } from './apply'
import { recordAppliedRevision } from './session'
import { digestTrackedTree, trackedProjectFiles } from './project'

/**
 * MEDIA 验收的应用/回滚恢复保证（B 侧）。
 *
 * 验收脚本在审批通过后把补丁应用到**独立、可丢弃的工程副本**上；本模块封装
 * 「应用 → 应用后校验 →（失败时）自动回滚」的恢复语义，并提供故障注入点供测试：
 *
 * - `afterApply`：应用成功后立即抛出 —— 模拟应用后瞬时故障（进程被杀后的恢复路径）；
 * - `verifyApplied`：应用后校验（调用方传入树摘要 / 源码包含等真实检查）；
 * - `beforeRollback`：回滚执行前抛出 —— 模拟回滚本身失败。
 *
 * 三类场景的恢复语义（与验收脚本头注一致）：
 * 1. 正常成功：返回应用后的 session，由调用方继续显式回滚并校验恢复。
 * 2. 运行失败（应用后校验不过 / 注入故障）：尽力回滚；回滚成功则抛
 *    MediaAcceptanceRecoveryError（注明已恢复原基线，现场无遗留）；回滚也失败则抛
 *    MediaAcceptanceRecoveryError（同时携带两个错误，现场保留给人工处理）。
 * 3. 进程中断（SIGKILL 等）：finally/worktree 清理兜不住时，应用目标是可丢弃副本，
 *    原工程不受影响；副本由调用方按工作目录约定处理。
 *
 * 任何失败都向外抛错：本模块不吞异常、不强制重置任何工程。
 */
export class MediaAcceptanceRecoveryError extends Error {
  /** 回滚也失败时保留回滚错误供上层记录 */
  readonly rollbackError?: unknown
  constructor(message: string, rollbackError?: unknown) {
    super(message)
    this.name = 'MediaAcceptanceRecoveryError'
    this.rollbackError = rollbackError
  }
}

export interface ApplyRecoveryOutcome {
  session: EditSession
  /** 应用后校验失败但已成功回滚时的恢复记录 */
  recovery?: { rolledBack: true; restoredSourceDigest: string; rolledBackAt: string }
}

/**
 * 恢复结果的真实分类（独立审查 P1-1）：绝不按异常类型取反推导 recovered。
 * - `restored`：仅当回滚后经摘要复核确认恢复；
 * - `recovery-failed`：已证明未恢复（回滚抛错/双故障/复核不一致）；
 * - `unknown`：执行中断或磁盘结果无法复核，按未恢复保守处理。
 * `preserveScene` 指示是否必须保留现场供人工处理：除 confirmed restored 外一律保留，
 * 任何状态下都不能把未恢复现场记录为恢复成功。
 */
export type RecoveryVerification = boolean | 'unverifiable'

export interface ClassifiedRecovery {
  state: 'restored' | 'recovery-failed' | 'unknown'
  preserveScene: boolean
  note: string
}

export function classifyRecoveryOutcome(
  error: unknown,
  verifyRestored: () => RecoveryVerification,
): ClassifiedRecovery {
  if (error instanceof MediaAcceptanceRecoveryError) {
    if (error.rollbackError !== undefined) {
      return { state: 'recovery-failed', preserveScene: true, note: '自动回滚自身失败（双故障），现场保留。' }
    }
    // 模块声称回滚成功：必须用摘要复核确认，绝不直接记 recovered
    let verified: RecoveryVerification
    try {
      verified = verifyRestored()
    } catch {
      verified = 'unverifiable'
    }
    if (verified === true) return { state: 'restored', preserveScene: false, note: '回滚后摘要复核与基线一致。' }
    if (verified === false) return { state: 'recovery-failed', preserveScene: true, note: '回滚后摘要复核与基线不一致，按未恢复处理，现场保留。' }
    return { state: 'unknown', preserveScene: true, note: '回滚结果无法复核（磁盘读取失败/执行中断），按未恢复保守处理，现场保留。' }
  }
  // 显式回滚抛错（AcceptanceError 等任何非恢复封装错误）：凡进入恢复语义即视为未恢复
  return { state: 'recovery-failed', preserveScene: true, note: `显式回滚抛错：${describe(error)}` }
}

export function applyApprovedCandidateWithRecovery(
  session: EditSession,
  candidate: CandidateRecord,
  hooks: {
    afterApply?: () => void
    verifyApplied?: () => void
    beforeRollback?: () => void
  } = {},
  at = new Date().toISOString(),
): ApplyRecoveryOutcome {
  let next: EditSession | undefined
  try {
    next = recordApplied(session, candidate, at)
    hooks.afterApply?.()
    hooks.verifyApplied?.()
  } catch (applyError) {
    // 应用/记录阶段抛错（P2-1）：先判断是否真实发生写入，绝不盲目逆向补丁——
    // 只有工程确实偏离基线才可能需要回滚；读不出摘要时保守按"可能写入"处理。
    if (!next) {
      const wrote = treePossiblyWritten(candidate)
      throw new MediaAcceptanceRecoveryError(
        wrote
          ? `应用阶段抛错且工程已偏离基线（可能已部分写入）；会话未记录，无法安全自动回滚，现场保留。原始错误：${describe(applyError)}`
          : `应用阶段抛错，工程未偏离基线（未发生写入），无需回滚。原始错误：${describe(applyError)}`,
        wrote ? applyError : undefined,
      )
    }
    let rollback: { restoredSourceDigest: string; rolledBackAt: string }
    try {
      hooks.beforeRollback?.()
      rollback = rollbackAppliedCandidate(next, candidate, at)
    } catch (rollbackError) {
      throw new MediaAcceptanceRecoveryError(
        `应用后校验失败且自动回滚也失败，现场已保留以便人工处理。应用错误：${describe(applyError)}；回滚错误：${describe(rollbackError)}`,
        rollbackError,
      )
    }
    throw new MediaAcceptanceRecoveryError(
      `应用后校验失败，已自动回滚恢复原基线（${rollback.restoredSourceDigest.slice(0, 12)}…）。原始错误：${describe(applyError)}`,
    )
  }
  return { session: next }
}

function treePossiblyWritten(candidate: CandidateRecord): boolean {
  try {
    return digestTrackedTree(candidate.projectRoot, trackedProjectFiles(candidate.projectRoot)) !== candidate.baseSourceDigest
  } catch {
    return true // 读不出摘要：保守认为可能已写入，交由现场保留路径处理
  }
}

const describe = (error: unknown) => (error instanceof Error ? `${error.name}: ${error.message}` : String(error))

function recordApplied(session: EditSession, candidate: CandidateRecord, at: string): EditSession {
  return recordAppliedRevision(session, applyApprovedCandidate(session, candidate, at))
}
