/**
 * F 体验层适配器接口：体验工作台与真实 Project-first 能力之间的边界。
 *
 * 当前唯一实现是 demo-adapter（青野演示，全部数据标记 DEMO/SIMULATED）。
 * 真实实现应由集成方把 local-project-api（/__ripple/api/*）与
 * src/core/model.ts 的 EditSession / ScopeDecision / VerificationRun 映射到
 * ExperienceViewModel，缺口清单见 docs/experience/HANDOFF 第 4 节。
 *
 * 约定：
 * - 适配器不修改任何核心领域对象；只读投影。
 * - 演示数据绝不进入 Approval / Apply（体验层没有这两个动作，只有
 *   "演示审批"按钮且明确标 DEMO，真实生命周期仍由 A 的工作台负责）。
 */
import type { ExperienceViewModel, PageScopeChoiceXp } from './view-model'

export interface ExperienceAdapter {
  /** 数据来源标记，体验层必须把它渲染给用户看。 */
  readonly provenance: 'demo' | 'real'
  load(): Promise<ExperienceViewModel>
  /** 用户选择画布元素后的派生更新（演示为本地纯计算）。 */
  selectElement(model: ExperienceViewModel, elementId: string): ExperienceViewModel
  setDraftText(model: ExperienceViewModel, text: string): ExperienceViewModel
  setPageScope(model: ExperienceViewModel, pageRef: string, scope: PageScopeChoiceXp): ExperienceViewModel
  setViewport(model: ExperienceViewModel, viewportId: string): ExperienceViewModel
  setPage(model: ExperienceViewModel, pageRef: string): ExperienceViewModel
}
