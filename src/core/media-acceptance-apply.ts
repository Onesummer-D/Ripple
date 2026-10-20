import type { EditSession } from './model'
import type { CandidateRecord } from './candidate'
import { applyApprovedCandidate, rollbackAppliedCandidate } from './apply'
import { recordAppliedRevision } from './session'

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
  const next = recordApplied(session, candidate, at)
  try {
    hooks.afterApply?.()
    hooks.verifyApplied?.()
  } catch (applyError) {
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

const describe = (error: unknown) => (error instanceof Error ? `${error.name}: ${error.message}` : String(error))

function recordApplied(session: EditSession, candidate: CandidateRecord, at: string): EditSession {
  return recordAppliedRevision(session, applyApprovedCandidate(session, candidate, at))
}
