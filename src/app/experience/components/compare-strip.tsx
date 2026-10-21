import { useState } from 'react'
import type { ExperienceViewModel } from '../view-model'
import { SectionTitle } from './status-pill'

type CompareSide = ExperienceViewModel['compare']['baseline']

const SIDE_STATE_LABEL: Record<CompareSide['state'], string> = {
  ready: '', loading: '加载中…', failed: '截图不可用', unavailable: '该视口无截图', stale: '截图已过期',
}

/** 真实截图：使用带来源标记的真实 imageUrl；加载失败/过期/缺失都有明确状态，不回退模拟图。 */
function RealShot({ side, label }: { side: CompareSide; label: string }) {
  const [broken, setBroken] = useState(false)
  if (side.state === 'stale') return <span className="ripple-xp-compare-note">截图已过期</span>
  if (side.state === 'unavailable' || !side.imageUrl) return <span className="ripple-xp-compare-note">尚无真实截图</span>
  if (side.state === 'loading') return <span className="ripple-xp-compare-note">加载中…</span>
  if (broken || side.state === 'failed') return <span className="ripple-xp-compare-note">截图不可用</span>
  return <img className="ripple-xp-compare-img" src={side.imageUrl} alt={`${label}真实截图`} data-testid="compare-real-img" onError={() => setBroken(true)} />
}

/**
 * 前后对照：修改前 vs 候选。
 * 演示模式渲染明确标记的模拟面板；真实模式只接受带来源的真实 imageUrl，
 * 绝不用前端动画假装已经做过真实浏览器验证。
 */
export function CompareStrip({ model }: { model: ExperienceViewModel }) {
  const { baseline, candidate, matchedViewport, focusArea } = model.compare
  const isDemo = model.dataProvenance === 'demo'
  const side = (label: string, sideState: CompareSide, testId: string) => (
    <figure className={`ripple-xp-compare-side ripple-xp-compare-${sideState.state}`} data-testid={testId}>
      <div className="ripple-xp-compare-shot" aria-label={`${label}截图`}>
        {isDemo ? (
          sideState.state === 'ready' ? (
            <>
              <span className="ripple-xp-compare-page-title">青野文创 · 首页</span>
              <span className={`ripple-xp-compare-title ${testId === 'compare-candidate' ? 'is-changed' : ''}`}>
                {testId === 'compare-candidate' && model.draftAfterText ? model.draftAfterText : '秋日茶器市集'}
              </span>
              {testId === 'compare-candidate' && <span className="ripple-xp-focus-ring" aria-hidden>⟶ {focusArea}</span>}
            </>
          ) : <span className="ripple-xp-compare-note">{SIDE_STATE_LABEL[sideState.state]}</span>
        ) : <RealShot side={sideState} label={label} />}
      </div>
      <figcaption>
        <strong>{label}</strong>
      </figcaption>
    </figure>
  )
  return <section className="ripple-xp-compare" aria-label="前后对照" data-testid="compare-strip">
    <SectionTitle aside={<span className={`ripple-xp-match-note ${matchedViewport ? '' : 'is-mismatch'}`} data-testid="viewport-match-note">
      {matchedViewport ? '两端视口与交互状态一致' : '两端视口不一致，对照结果仅供参考'}
    </span>}>
      前后对照
    </SectionTitle>
    <div className="ripple-xp-compare-row">
      {side('修改前', baseline, 'compare-baseline')}
      {side('候选修改后', candidate, 'compare-candidate')}
    </div>
  </section>
}
