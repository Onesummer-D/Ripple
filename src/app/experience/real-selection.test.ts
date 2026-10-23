import { describe, expect, it } from 'vitest'
import {
  assessDisplayIdentity,
  createSelectionNonce,
  isBoundProjectSelection,
  isCurrentEnvelope,
  isStableIdentity,
  selectionModeMessage,
} from './real-selection'
import type { PickerEnvelope } from './real-selection'

/**
 * 真实画布点选会话纯函数测试：
 * 信封校验/身份评估全部复用 A 核心（runtime-selection-bridge），
 * 这里只验证体验层的会话消息、响应绑定与稳定身份判定。
 */

const frame = {} as Window

function envelope(overrides: Partial<PickerEnvelope> = {}): PickerEnvelope {
  return {
    type: 'ripple:element-selected',
    protocol: 'ripple-runtime-identity/v1',
    previewId: 'preview-1',
    token: 'nonce-1',
    sourceRef: 'jsx:src/App.tsx#42',
    identityCertainty: 'stable-keyed-instance',
    reasons: [],
    tagName: 'h1',
    text: 'Acme 商店',
    ...overrides,
  }
}

describe('点选会话 · 一次性令牌与模式消息', () => {
  it('createSelectionNonce 生成互不相同的非空令牌', () => {
    const a = createSelectionNonce()
    const b = createSelectionNonce()
    expect(a).toBeTruthy()
    expect(b).toBeTruthy()
    expect(a).not.toBe(b)
  })

  it('selectionModeMessage：进入携带令牌，退出清空令牌', () => {
    expect(selectionModeMessage('nonce-1', 'preview-1', true))
      .toEqual({ type: 'ripple:selection-mode', previewId: 'preview-1', token: 'nonce-1', enabled: true })
    // 退出：与 A 工作台一致——enabled=false 是退出信号；nonce 一次性，下次进入重新轮换
    expect(selectionModeMessage('nonce-1', 'preview-1', false))
      .toEqual({ type: 'ripple:selection-mode', previewId: 'preview-1', token: 'nonce-1', enabled: false })
    // 没有令牌时强制退出
    expect(selectionModeMessage('', 'preview-1', true).enabled).toBe(false)
  })
})

describe('点选会话 · 信封归属校验（复用 A 核心）', () => {
  const context = { eventSource: frame, iframeSource: frame, previewId: 'preview-1', token: 'nonce-1' }

  it('当前会话的信封通过校验', () => {
    expect(isCurrentEnvelope(envelope(), context)).toBe(true)
  })

  it('过期令牌 / 跨会话 previewId / 非 jsx 来源 / 异源窗口一律拒绝', () => {
    expect(isCurrentEnvelope(envelope({ token: 'nonce-2' }), context)).toBe(false)
    expect(isCurrentEnvelope(envelope({ previewId: 'preview-2' }), context)).toBe(false)
    // data: 引用是分析层目标 id，不是点选桥 sourceRef，不得冒充信封
    expect(isCurrentEnvelope(envelope({ sourceRef: 'data:hero-title' }), context)).toBe(false)
    expect(isCurrentEnvelope(envelope(), { ...context, eventSource: {} })).toBe(false)
  })
})

describe('点选会话 · 显示身份与响应绑定', () => {
  it('assessDisplayIdentity 只授予 navigation-only；证据不全时降级 unknown', () => {
    const full = assessDisplayIdentity(
      envelope({ sourceVersion: 'a'.repeat(64), pageContext: { pathname: '/', search: '', hash: '' }, runtimeInstanceId: '/:app#1' }),
      { sourceRef: 'jsx:src/App.tsx#42', sourceVersion: 'a'.repeat(64), expectedPathname: '/' },
    )
    expect(full.permission).toBe('navigation-only')
    expect(full.certainty).toBe('stable-keyed-instance')

    const degraded = assessDisplayIdentity(envelope(), {
      sourceRef: 'jsx:src/App.tsx#42',
      sourceVersion: 'a'.repeat(64),
      expectedPathname: '/',
    })
    expect(degraded.permission).toBe('navigation-only')
    // 缺 sourceVersion / pageContext / 实例 id：不得保留稳定身份结论
    expect(degraded.certainty).toBe('unknown')
    expect(degraded.reasons.length).toBeGreaterThan(0)
  })

  it('isBoundProjectSelection：响应必须绑定当前预演会话且元素与信封 sourceRef 一致', () => {
    const expected = { projectId: 'proj-acme', previewId: 'preview-1', sourceDigest: 'digest-1', sourceRef: 'jsx:src/App.tsx#42' }
    expect(isBoundProjectSelection({
      projectId: 'proj-acme', previewId: 'preview-1', sourceDigest: 'digest-1',
      element: { id: 'jsx:src/App.tsx#42', label: '标题' }, editableText: [],
    }, expected)).toBe(true)
    // 预览已被替换：previewId 不符不得采信
    expect(isBoundProjectSelection({
      projectId: 'proj-acme', previewId: 'preview-2', sourceDigest: 'digest-1',
      element: { id: 'jsx:src/App.tsx#42', label: '标题' }, editableText: [],
    }, expected)).toBe(false)
    // 元素与信封 sourceRef 不一致：响应不属于本次点选
    expect(isBoundProjectSelection({
      projectId: 'proj-acme', previewId: 'preview-1', sourceDigest: 'digest-1',
      element: { id: 'jsx:src/Other.tsx#7', label: '别的' }, editableText: [],
    }, expected)).toBe(false)
  })

  it('isStableIdentity 只有 stable-keyed / stable-react 两种', () => {
    expect(isStableIdentity('stable-keyed-instance')).toBe(true)
    expect(isStableIdentity('stable-react-instance')).toBe(true)
    expect(isStableIdentity('position-dependent')).toBe(false)
    expect(isStableIdentity('unknown')).toBe(false)
    expect(isStableIdentity('unmapped')).toBe(false)
  })
})
