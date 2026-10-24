/**
 * 真实画布点选会话（F 第二阶段第一批）。
 *
 * 职责边界（与 A 核心一致，体验层不另建信任模型）：
 * - 父页（F）生成一次性 nonce，向预演 iframe 发送 `ripple:selection-mode`；
 * - iframe 内 D 采集脚本回投 `ripple:element-selected` 信封；
 * - 信封校验复用 A 核心 `isCurrentPickerEnvelope`（过期/跨会话信封一律丢弃）；
 * - 显示身份评估复用 A 核心 `assessPickerDisplayIdentity`（结果仅用于显示与导航，
 *   **不构成任何编辑或 Scope 授权**）；
 * - 最终授权永远在服务端：F 只把 sourceRef POST 到 `/project/source-selection`，
 *   并绑定响应到当前 previewId/projectId/sourceDigest 后才采信。
 */
import { assessPickerDisplayIdentity, isCurrentPickerEnvelope } from '../../core/runtime-selection-bridge'
import type { PickerCertainty, PickerEnvelope } from '../../core/runtime-selection-bridge'

export type { PickerCertainty, PickerEnvelope }

/** 生成一次性点选令牌（每次进入点选模式轮换）。 */
export function createSelectionNonce(): string {
  return crypto.randomUUID()
}

/** 进入/退出点选模式的父→iframe 消息。token 为空表示退出。 */
export function selectionModeMessage(nonce: string, previewId: string, enabled: boolean) {
  return { type: 'ripple:selection-mode', previewId, token: nonce, enabled: enabled && !!nonce }
}

/** 信封是否属于当前会话（复用 A 核心校验：来源窗口、previewId、token、协议字段）。 */
export function isCurrentEnvelope(
  data: unknown,
  context: { eventSource: unknown; iframeSource: unknown; previewId: string; token: string },
): data is PickerEnvelope {
  return isCurrentPickerEnvelope(data, context)
}

/** 显示身份评估（复用 A 核心；permission 恒为 'navigation-only'）。 */
export function assessDisplayIdentity(
  envelope: PickerEnvelope,
  trusted: { sourceRef: string; sourceVersion?: string; expectedPathname: string },
) {
  return assessPickerDisplayIdentity(envelope, trusted)
}

/** 服务端 /project/source-selection 响应（只读投影，字段以 A 为准）。 */
export interface ProjectSourceSelectionResponse {
  projectId: string
  previewId: string
  sourceDigest: string
  element: { id: string; label: string; location?: { path: string; start?: number; end?: number } }
  sourceVersion?: string
  editableText: Array<{
    id: string
    label: string
    value?: string
    location?: { path: string; start?: number; end?: number }
    impact: { pageRefs: string[]; unresolved: string[]; certainty: 'source-proven' | 'partial' | 'unknown' }
  }>
}

/**
 * 服务端响应绑定检查：响应必须属于当前预演会话，且元素与信封 sourceRef 一致。
 * 任何不匹配都意味着响应不可信（预览已被替换/工程已切换），调用方必须丢弃。
 */
export function isBoundProjectSelection(
  response: ProjectSourceSelectionResponse,
  expected: { projectId: string; previewId: string; sourceDigest: string; sourceRef: string },
): boolean {
  return response.projectId === expected.projectId
    && response.previewId === expected.previewId
    && response.sourceDigest === expected.sourceDigest
    && response.element.id === expected.sourceRef
}

/** 显示身份是否达到精准实例级（stable-keyed / stable-react）。 */
export function isStableIdentity(certainty: PickerCertainty): boolean {
  return certainty === 'stable-keyed-instance' || certainty === 'stable-react-instance'
}
