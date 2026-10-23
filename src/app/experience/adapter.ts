/**
 * F 体验层适配器接口：体验工作台与真实 Project-first 能力之间的边界。
 *
 * 实现：
 * - demo-adapter（青野演示，全部数据标记 DEMO/SIMULATED）——原有能力与测试原样保留；
 * - real-adapter（真实模式，映射 /__ripple/api/* 的真实响应，数据标记 real）。
 *
 * 约定：
 * - 适配器不修改任何核心领域对象；只读投影。
 * - 演示数据绝不进入 Approval / Apply（体验层没有这两个动作，只有
 *   "演示审批"按钮且明确标 DEMO，真实生命周期仍由 A 的工作台负责）。
 * - real 模式同样不开放真实 Approval/Apply：real-adapter 只做只读映射与本地的
 *   草稿/范围意向，审批入口由 UI 明确提示"尚未接入"。
 *
 * 异步契约（最小升级，2026-10-22 Real Adapter 第一阶段）：
 * - `load()` 是唯一必需方法；`selectElement/setDraftText/setPageScope/setViewport/setPage`
 *   保持同步纯派生，真实实现同样在本地派生（草稿/范围意向不直接写服务端）。
 * - 三个可选方法构成真实异步契约，demo-adapter 无需实现：
 *   - `openProject(projectRoot)`：打开/切换真实工程。实现方必须使旧工程的全部
 *     缓存数据（候选、证据、范围、预演会话）立即失效，并丢弃切换前发出的
 *     所有在途响应（generation 守卫），绝不让旧候选/旧证据残留。
 *   - `refresh(model)`：重新拉取服务端状态（历史、验证结果、预演会话），
 *     候选身份（candidateId/patchHash）变化时 Evidence 与 Scope 投影随之重建。
 *   - `dispose()`：工作台卸载或真实画布关闭时清理资源——停止项目预演
 *     （POST project/preview/stop）、作废在途请求，不得泄漏 iframe 会话。
 * - 错误与重试：请求失败不得用演示默认值兜底；失败信息通过 load() 的
 *   rejected promise 或 model.projectStatus/blockedReasons 如实透出，
 *   由工作台展示重试入口。
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
  /** 异步契约（真实实现提供，见文件头注释）。 */
  openProject?(projectRoot: string): Promise<ExperienceViewModel>
  refresh?(model: ExperienceViewModel): Promise<ExperienceViewModel>
  dispose?(): Promise<void> | void
  /**
   * 第二阶段：画布点选结果落位（真实实现提供）。
   * picked.sourceRef 已经过 D 桥信封校验（调用方负责）；本方法负责：
   * POST /project/source-selection → 校验响应绑定当前 previewId/projectId/sourceDigest
   * → 评估显示身份 → 选中对应的真实目标。响应不绑定当前会话时抛错，绝不本地臆造。
   */
  applyPickedSource?(model: ExperienceViewModel, picked: {
    sourceRef: string
    envelope: import('./real-selection').PickerEnvelope
  }): Promise<ExperienceViewModel>
  /**
   * 第二阶段：创建真实候选（真实实现提供）。
   * operations 由当前选中目标 + 本地草稿派生，scope 由用户的页面范围决策
   * 显式构建——服务端是唯一权威，前端不得模拟候选生命周期。
   */
  createCandidate?(model: ExperienceViewModel, input: { rawIntent: string }): Promise<ExperienceViewModel>
  /** 第二阶段：打开/关闭真实候选预演（POST /candidate/preview[/stop]）。 */
  openCandidatePreview?(model: ExperienceViewModel): Promise<ExperienceViewModel>
  closeCandidatePreview?(model: ExperienceViewModel): Promise<ExperienceViewModel>
  /**
   * 第二批：运行真实四视口验证（POST /candidate/verify）。
   * 必须消费服务端 VerificationRun 投影（断言/证据截图/执行记录哈希/E 视觉证据），
   * 不得自行生成 pass 或模拟验证状态；响应与当前候选不一致时丢弃。
   */
  runVerification?(model: ExperienceViewModel): Promise<ExperienceViewModel>
}
