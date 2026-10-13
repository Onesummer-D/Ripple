import type { CaseId, ScopeMode } from '../domain/contracts'

export interface FixtureExpectation {
  fixtureId: string
  caseId: CaseId
  sourceId: string
  selectedSlotId: string
  expectedRoutes: string[]
  excludedRoutes: string[]
  instanceModeRoutes: string[]
  sharedModeRoutes: string[]
  notes: string
}

export const truthMatrix: FixtureExpectation[] = [
  { fixtureId: 'F01', caseId: 'qingye', sourceId: 'qingye-shared-title', selectedSlotId: 'qingye-home-title-slot', expectedRoutes: ['/', '/autumn', '/collection'], excludedRoutes: ['/about'], instanceModeRoutes: ['/'], sharedModeRoutes: ['/', '/autumn', '/collection'], notes: '共享标题与独立品牌故事标题分离' },
  { fixtureId: 'F02', caseId: 'qingye', sourceId: 'qingye-shared-title', selectedSlotId: 'qingye-home-title-slot', expectedRoutes: ['/', '/autumn', '/collection'], excludedRoutes: ['/about'], instanceModeRoutes: ['/'], sharedModeRoutes: ['/', '/autumn', '/collection'], notes: '当前实例只改首页' },
  { fixtureId: 'F03', caseId: 'qingye', sourceId: 'qingye-shared-title', selectedSlotId: 'qingye-home-title-slot', expectedRoutes: ['/', '/autumn', '/collection'], excludedRoutes: ['/about'], instanceModeRoutes: ['/'], sharedModeRoutes: ['/', '/autumn', '/collection'], notes: '共享预演覆盖三个消费位置' },
  { fixtureId: 'F04', caseId: 'qingye', sourceId: 'qingye-shared-title', selectedSlotId: 'qingye-home-title-slot', expectedRoutes: ['/', '/autumn', '/collection'], excludedRoutes: ['/about'], instanceModeRoutes: ['/'], sharedModeRoutes: ['/', '/autumn', '/collection'], notes: '重新预演清除旧的影响范围' },
  { fixtureId: 'F05', caseId: 'qiguang', sourceId: 'qiguang-shared-poster', selectedSlotId: 'qiguang-home-poster-slot', expectedRoutes: ['/', '/program', '/tickets'], excludedRoutes: ['/archive'], instanceModeRoutes: ['/'], sharedModeRoutes: ['/', '/program', '/tickets'], notes: '共享海报进入三个容器' },
  { fixtureId: 'F06', caseId: 'qiguang', sourceId: 'qiguang-shared-poster', selectedSlotId: 'qiguang-program-poster-slot', expectedRoutes: ['/', '/program', '/tickets'], excludedRoutes: ['/archive'], instanceModeRoutes: ['/program'], sharedModeRoutes: ['/', '/program', '/tickets'], notes: '节目页局部替换' },
  { fixtureId: 'F07', caseId: 'qiguang', sourceId: 'qiguang-shared-poster', selectedSlotId: 'qiguang-program-poster-slot', expectedRoutes: ['/', '/program', '/tickets'], excludedRoutes: ['/archive'], instanceModeRoutes: ['/program'], sharedModeRoutes: ['/', '/program', '/tickets'], notes: '共享模式保留媒体裁切证据' },
  { fixtureId: 'F08', caseId: 'third-party', sourceId: 'thirdparty-shared-token', selectedSlotId: 'thirdparty-accent-slot', expectedRoutes: ['/showcase', '/docs'], excludedRoutes: [], instanceModeRoutes: ['/showcase'], sharedModeRoutes: ['/showcase', '/docs'], notes: '共享 Token 的 CTA 与导航消费位置' },
  { fixtureId: 'F09', caseId: 'third-party', sourceId: 'thirdparty-shared-token', selectedSlotId: 'thirdparty-accent-slot', expectedRoutes: ['/showcase', '/docs'], excludedRoutes: [], instanceModeRoutes: ['/showcase'], sharedModeRoutes: ['/showcase', '/docs'], notes: '三视口结果必须由真实 Evidence 支持' },
  { fixtureId: 'F10', caseId: 'third-party', sourceId: 'thirdparty-shared-token', selectedSlotId: 'thirdparty-accent-slot', expectedRoutes: ['/showcase', '/docs'], excludedRoutes: [], instanceModeRoutes: ['/showcase'], sharedModeRoutes: ['/showcase', '/docs'], notes: '取消、应用、恢复状态可重复' },
]

export const expectedRoutesFor = (fixtureId: string, mode: ScopeMode): string[] => {
  const expectation = truthMatrix.find((item) => item.fixtureId === fixtureId)
  if (!expectation) return []
  return mode === 'INSTANCE' ? expectation.instanceModeRoutes : expectation.sharedModeRoutes
}
