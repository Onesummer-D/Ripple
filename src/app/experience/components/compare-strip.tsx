import type { ExperienceViewModel } from '../view-model'
import { SectionTitle } from './status-pill'

const SIDE_STATE_LABEL: Record<ExperienceViewModel['compare']['baseline']['state'], string> = {
  ready: '', loading: '加载中…', failed: '截图不可用', unavailable: '该视口无截图', stale: '截图已过期',
}

/**
 * 前后对照：修改前 vs 候选。没有真实截图时渲染明确标记的演示面板，
 * 绝不用前端动画假装已经做过真实浏览器验证。
 */
export function CompareStrip({ model }: { model: ExperienceViewModel }) {
  const { baseline, candidate, matchedViewport, focusArea } = model.compare
  const side = (label: string, sideState: typeof baseline, testId: string) => (
    <figure className={`ripple-xp-compare-side ripple-xp-compare-${sideState.state}`} data-testid={testId}>
      <div className="ripple-xp-compare-shot" aria-label={`${label}截图占位`}>
        {sideState.state === 'ready' ? (
          <>
            <span className="ripple-xp-compare-page-title">青野文创 · 首页</span>
            <span className={`ripple-xp-compare-title ${testId === 'compare-candidate' ? 'is-changed' : ''}`}>
              {testId === 'compare-candidate' && model.draftAfterText ? model.draftAfterText : '秋日茶器市集'}
            </span>
            {testId === 'compare-candidate' && <span className="ripple-xp-focus-ring" aria-hidden>⟶ {focusArea}</span>}
          </>
        ) : <span className="ripple-xp-compare-note">{SIDE_STATE_LABEL[sideState.state]}</span>}
      </div>
      <figcaption>
        <strong>{label}</strong>
        {sideState.note && <small>{sideState.note}</small>}
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
    {model.dataProvenance === 'demo' && <p className="ripple-xp-hint">演示数据：尚未经过真实浏览器验证；真实候选会以同版本四视口截图对照。</p>}
  </section>
}
