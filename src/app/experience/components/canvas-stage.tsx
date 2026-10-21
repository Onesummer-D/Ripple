import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { CanvasElementXp, ExperienceViewModel } from '../view-model'
import { CertaintyPill } from './status-pill'

const CANVAS_STATE_LABEL: Record<ExperienceViewModel['canvasState'], string> = {
  ready: '', loading: '预演加载中…', failed: '预演加载失败，请重试', unavailable: '该视口暂不可用',
  'stale-evidence': '证据已过期，需要重新验证',
}

/**
 * 中央画布：真实网页为视觉中心。
 * 演示模式渲染模拟 DOM（data-xp-demo），真实模式由适配器换成项目预演 iframe。
 */
export function CanvasStage({ model, onSelectElement, onViewportChange }: {
  model: ExperienceViewModel
  onSelectElement: (elementId: string) => void
  onViewportChange: (viewportId: string) => void
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [hostWidth, setHostWidth] = useState(0)
  const [hoveredId, setHoveredId] = useState<string>()
  const [demoCanvasState, setDemoCanvasState] = useState<ExperienceViewModel['canvasState']>('ready')
  const viewport = model.viewports.find(item => item.id === model.activeViewportId) ?? model.viewports[0]
  const scale = hostWidth ? Math.min(1, hostWidth / viewport.width) : 1
  const canvasState = model.dataProvenance === 'demo' ? demoCanvasState : model.canvasState
  const currentPage = model.pages.find(page => page.id === model.currentPageRef)
  const selected = model.elements.find(item => item.id === model.selectedElementId)

  useEffect(() => {
    const element = hostRef.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(entries => setHostWidth(entries[0]?.contentRect.width ?? 0))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const renderElement = (element: CanvasElementXp, children: ReactNode) => {
    const isSelected = element.id === model.selectedElementId
    const isHovered = element.id === hoveredId
    return (
      <div
        key={element.id}
        data-xp-demo={element.demoSelector.replace('[data-xp-demo="', '').replace('"]', '')}
        data-testid={`canvas-el-${element.id}`}
        role="button"
        tabIndex={0}
        aria-pressed={isSelected}
        className={`ripple-xp-demo-el ${isSelected ? 'is-selected' : ''} ${isHovered ? 'is-hovered' : ''} ${element.editable ? '' : 'is-locked'}`}
        onMouseEnter={() => setHoveredId(element.id)}
        onMouseLeave={() => setHoveredId(undefined)}
        onClick={() => onSelectElement(element.id)}
        onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelectElement(element.id) } }}
      >
        {children}
        {(isSelected || isHovered) && (
          <span className="ripple-xp-el-tag">
            {element.label}
            {!element.editable && ' · 来源未知，仅可查看'}
          </span>
        )}
      </div>
    )
  }

  const heroTitle = model.elements.find(item => item.id === 'el:hero-title')
  const heroSubtitle = model.elements.find(item => item.id === 'el:hero-subtitle')
  const seasonal = model.elements.find(item => item.id === 'el:seasonal-banner')
  const promo = model.elements.find(item => item.id === 'el:promo-card')

  const demoPage = (
    <div className="ripple-xp-demo-page" data-testid="demo-canvas">
      <header className="ripple-xp-demo-nav">
        <strong>青野文创</strong>
        <span>首页</span><span>全部商品</span><span>品牌故事</span><span>联系我们</span>
      </header>
      <section className="ripple-xp-demo-hero">
        {heroTitle && renderElement(heroTitle, <h1>{heroTitle.currentText}</h1>)}
        {heroSubtitle && renderElement(heroSubtitle, <p className="ripple-xp-demo-sub">{heroSubtitle.currentText}</p>)}
        <div className="ripple-xp-demo-cta-row">
          <span className="ripple-xp-demo-cta">逛市集</span>
          {seasonal && renderElement(seasonal, <span className="ripple-xp-demo-banner">{seasonal.currentText}</span>)}
        </div>
      </section>
      <section className="ripple-xp-demo-grid">
        {['柴烧茶壶', '素白陶碗', '手作风铃'].map(name => <div key={name} className="ripple-xp-demo-card"><span className="ripple-xp-demo-thumb" /><strong>{name}</strong></div>)}
        {promo && renderElement(promo, <div className="ripple-xp-demo-card is-promo"><span className="ripple-xp-demo-thumb" /><strong>{promo.currentText}</strong></div>)}
      </section>
    </div>
  )

  return <section className="ripple-xp-stage" aria-label="网页画布" data-testid="canvas-stage">
    <div className="ripple-xp-stage-toolbar">
      <div className="ripple-xp-viewport-switch" role="group" aria-label="视口选择">
        {model.viewports.map(item => (
          <button
            key={item.id}
            type="button"
            className={item.id === model.activeViewportId ? 'is-active' : ''}
            aria-pressed={item.id === model.activeViewportId}
            data-testid={`viewport-${item.id}`}
            onClick={() => onViewportChange(item.id)}
          >
            {item.label}
            {item.verificationStatus === 'in-verification' && <span className="ripple-xp-verify-badge">验证中</span>}
            {item.verificationStatus === 'unavailable' && <span className="ripple-xp-verify-badge">不可用</span>}
          </button>
        ))}
      </div>
      {model.dataProvenance === 'demo' && (
        <label className="ripple-xp-demo-state">
          演示状态
          <select
            data-testid="demo-canvas-state"
            value={demoCanvasState}
            onChange={event => setDemoCanvasState(event.target.value as ExperienceViewModel['canvasState'])}
          >
            <option value="ready">正常</option>
            <option value="loading">加载中</option>
            <option value="failed">加载失败</option>
            <option value="unavailable">不可用</option>
            <option value="stale-evidence">证据过期</option>
          </select>
        </label>
      )}
    </div>

    {selected && (
      <p className="ripple-xp-selection-summary" data-testid="selection-summary">
        已选中：{selected.label} · 源码 <code>{selected.sourcePath ?? '（未定位）'}</code>
        <CertaintyPill certainty={selected.certainty} />
        {selected.impactPageRefs.length > 0 && <span> · 影响 {selected.impactPageRefs.length} 个页面</span>}
      </p>
    )}

    <div className="ripple-xp-viewport-shell" ref={hostRef} data-testid="viewport-shell">
      <div
        className="ripple-xp-viewport-surface"
        style={{ width: viewport.width, height: viewport.height, transform: `scale(${scale})` }}
      >
        {canvasState === 'ready' ? (
          currentPage?.id === 'page:home' ? demoPage : (
            <div className="ripple-xp-demo-page is-placeholder" data-testid="demo-canvas-placeholder">
              <h2>{currentPage?.label}</h2>
              <p>演示数据：该页面的画布内容未包含在本轮演示中。</p>
              <p>页面关系：{currentPage?.relation === 'same-source' ? '与当前修改同源，修改会随范围决策生效。' : '影响范围未证明。'}</p>
            </div>
          )
        ) : (
          <div className={`ripple-xp-canvas-state ripple-xp-canvas-${canvasState}`} role="status" data-testid="canvas-state-banner">
            {CANVAS_STATE_LABEL[canvasState]}
            {canvasState === 'failed' && <button type="button" className="ripple-xp-quiet" data-testid="canvas-retry" onClick={() => setDemoCanvasState('ready')}>重试</button>}
          </div>
        )}
      </div>
    </div>
  </section>
}
