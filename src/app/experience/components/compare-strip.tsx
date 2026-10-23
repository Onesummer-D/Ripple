import { useState } from 'react'
import type { ExperienceViewModel } from '../view-model'
import { SectionTitle } from './status-pill'

type CompareSide = ExperienceViewModel['compare']['baseline']

const SIDE_STATE_LABEL: Record<CompareSide['state'], string> = {
  ready: '', loading: '加载中…', failed: '截图不可用', unavailable: '该视口无截图', stale: '截图已过期',
}

/** 真实截图：使用带来源标记的真实 imageUrl；加载失败/过期/缺失都有明确状态，不回退模拟图。 */
function RealShot({ side, label }: { side: CompareSide; label: string }) {
  // key 绑定 imageUrl：地址更新时重建内部组件，旧的 broken 状态不会滞留。
  return <RealShotInner key={side.imageUrl ?? 'none'} side={side} label={label} />
}

function RealShotInner({ side, label }: { side: CompareSide; label: string }) {
  const [broken, setBroken] = useState(false)
  if (side.state === 'stale') return <span className="ripple-xp-compare-note is-warn">截图已过期，不能作为审批依据</span>
  if (side.state === 'unavailable' || !side.imageUrl) return <span className="ripple-xp-compare-note">尚无真实截图</span>
  if (side.state === 'loading') return <span className="ripple-xp-compare-note">加载中…</span>
  if (broken || side.state === 'failed') return <span className="ripple-xp-compare-note is-warn">截图不可用</span>
  return <img className="ripple-xp-compare-img" src={side.imageUrl} alt={`${label}真实截图`} data-testid="compare-real-img" onError={() => setBroken(true)} />
}

/**
 * 前后对照：修改前 vs 候选。
 * 演示模式渲染明确标记的模拟面板；真实模式只接受带来源的真实 imageUrl，
 * 绝不用前端动画假装已经做过真实浏览器验证。
 */
const COMPARE_STATE_NOTE: Record<ExperienceViewModel['compare']['compareState'], { text: string; className: string }> = {
  comparable: { text: '两端真实截图身份、视口与交互状态一致，可比较', className: '' },
  partial: { text: '真实截图尚不齐全，对照结果不完整', className: 'is-mismatch' },
  none: { text: '尚未生成候选，暂无可比较内容', className: 'is-empty' },
}

/** DEMO 对照的明确标注：绝不显示真实截图校验通过的结论 */
const DEMO_COMPARE_NOTE = { text: '演示对照：模拟内容，未经真实浏览器验证', className: 'is-demo' }

export function CompareStrip({ model }: { model: ExperienceViewModel }) {
  const { baseline, candidate, compareState, focusArea } = model.compare
  const isDemo = model.dataProvenance === 'demo'
  const selected = model.elements.find(item => item.id === model.selectedElementId)
  const hasDraft = !!model.draftAfterText.trim() && !!selected
  const side = (label: string, sideState: CompareSide, testId: string) => {
    // 占位态（无真实内容可显示）收为紧凑虚线框，消除大块空白；
    // 有真实内容（原文/草稿/真实截图）时才展开为完整对照面板。
    const placeholder = isDemo
      ? sideState.state !== 'ready' || (testId === 'compare-baseline' ? !selected : !hasDraft)
      : sideState.state !== 'ready' || !sideState.imageUrl
    return (
      <figure className={`ripple-xp-compare-side ripple-xp-compare-${sideState.state}`} data-testid={testId}>
        <figcaption>
          <strong>{label}</strong>
        </figcaption>
        <div className={`ripple-xp-compare-shot ${placeholder ? 'is-placeholder' : ''}`} aria-label={`${label}截图`}>
          {isDemo ? (
            sideState.state === 'ready' ? (
              testId === 'compare-baseline' ? (
                // 修改前 = 当前选中目标的原文；未选中时如实提示，不回显旧目标内容
                selected
                  ? <span className="ripple-xp-compare-title">{selected.currentText}</span>
                  : <span className="ripple-xp-compare-note">尚未选中要修改的位置</span>
              ) : (
                // 候选 = 当前目标的草稿；没有有效草稿时如实提示"尚未生成候选"，
                // 绝不把原文伪装成修改后结果
                <>
                  {hasDraft ? (
                    <span className="ripple-xp-compare-title is-changed">{model.draftAfterText}</span>
                  ) : (
                    <span className="ripple-xp-compare-note">尚未生成候选</span>
                  )}
                  {selected && <span className="ripple-xp-focus-ring" aria-hidden>⟶ {focusArea}</span>}
                </>
              )
            ) : <span className="ripple-xp-compare-note">{SIDE_STATE_LABEL[sideState.state]}</span>
          ) : <RealShot side={sideState} label={label} />}
        </div>
      </figure>
    )
  }
  const note = isDemo ? DEMO_COMPARE_NOTE : COMPARE_STATE_NOTE[compareState]
  // 任务状态驱动的下一步指引：未选中元素 / 无候选时，告诉用户该做什么，
  // 而不是留两块空白面板。文案只描述操作引导，不虚构任何验证结论。
  const guide = isDemo
    ? !selected
      ? '下一步：在中间画布点选要修改的文字，这里会展示修改前后的对照。'
      : !hasDraft
        ? '下一步：在右侧「改成」中输入修改后的文字，候选内容会实时呈现在这里。'
        : ''
    : compareState === 'none'
      ? '下一步：完成范围决策并生成真实候选后，这里会展示修改前后的真实截图对照。'
      : compareState === 'partial'
        ? '真实截图尚未齐全：运行四视口验证后，这里会补齐各视口的对照证据。'
        : ''
  return <section className={`ripple-xp-compare reveal ${isDemo ? 'is-demo-mode' : ''} ${guide ? 'is-guided' : ''}`} aria-label="前后对照" data-testid="compare-strip">
    <SectionTitle aside={<span className={`ripple-xp-match-note ${note.className}`} data-testid="viewport-match-note">
      {note.text}
    </span>}>
      前后对照
    </SectionTitle>
    {guide && <p className="ripple-xp-compare-guide" data-testid="compare-guide">{guide}</p>}
    <div className="ripple-xp-compare-row">
      {side('修改前', baseline, 'compare-baseline')}
      {side('修改后 · 候选', candidate, 'compare-candidate')}
    </div>
  </section>
}
