import type { ReactNode } from 'react'
import type { CanvasElementXp, ExperienceViewModel } from '../view-model'
import { demoPage, projectDemoSlot, type DemoContentPage, type DemoContentSlot, type DemoPageRef } from '../demo-content'

export interface DemoPageRenderProps {
  model: ExperienceViewModel
  pageRef: DemoPageRef
  /** Demo-only preview layer. The baseline remains the default canvas view. */
  layer: 'baseline' | 'candidate'
  renderElement: (element: CanvasElementXp, children: ReactNode, note?: string) => ReactNode
}

function textFor(slot: DemoContentSlot, props: DemoPageRenderProps): { text: string; note?: string; state: string } {
  const page = props.model.pages.find(item => item.id === props.pageRef)
  const projection = projectDemoSlot(slot, props.pageRef, {
    selectedSourceKey: props.layer === 'candidate' && props.model.selectedElementId
      ? props.model.elements.find(item => item.id === props.model.selectedElementId)?.demoSourceKey
      : undefined,
    draftText: props.model.draftAfterText,
    scope: page?.scope ?? 'undecided',
  })
  return { text: projection.displayText, note: projection.reason, state: projection.state }
}

function renderSlot(slot: DemoContentSlot, props: DemoPageRenderProps, children: (text: string) => ReactNode): ReactNode {
  const projection = textFor(slot, props)
  const element = slot.selectableElement
    ? props.model.elements.find(item => item.id === slot.selectableElement?.elementId)
    : props.model.elements.find(item => item.demoSourceKey === slot.sourceKey)
  const body = children(projection.text)
  if (!element) return <div key={slot.slotId} data-demo-state={projection.state}>{body}</div>
  return props.renderElement(element, body, projection.note)
}

function header(page: DemoContentPage): ReactNode {
  return (
    <header className="ripple-xp-demo-nav">
      <strong>青野文创</strong>
      <span className={page.pageRef === 'page:home' ? 'is-current' : ''}>首页</span>
      <span className={page.pageRef === 'page:products' ? 'is-current' : ''}>商品专题</span>
      <span className={page.pageRef === 'page:seasonal' ? 'is-current' : ''}>活动页</span>
      <span className={page.pageRef === 'page:contact' ? 'is-current' : ''}>联系我们</span>
    </header>
  )
}

function pageShell(page: DemoContentPage, children: ReactNode): ReactNode {
  return (
    <div className="ripple-xp-demo-page" data-testid="demo-canvas" data-demo-page={page.pageRef}>
      <div className="ripple-xp-demo-source-badge" data-testid="demo-provenance">DEMO · SIMULATED</div>
      {header(page)}
      <div className="ripple-xp-demo-page-heading">
        <span className="ripple-xp-demo-kicker">{page.path}</span>
        <h2 data-testid="demo-page-title">{page.label}</h2>
      </div>
      {children}
    </div>
  )
}

export function renderDemoPage(props: DemoPageRenderProps): ReactNode {
  const page = demoPage(props.pageRef)
  const slot = (slotId: string) => page.slots.find(item => item.slotId === slotId)
  if (props.pageRef === 'page:products') {
    const hero = slot('products.hero.title')
    const productTitle = slot('products.hero.copy')
    const promo = slot('products.promo')
    return pageShell(page, <>
      <section className="ripple-xp-demo-hero ripple-xp-demo-products-hero">
        <img className="ripple-xp-demo-hero-media" src="demo-assets/vessels.jpg" alt="商品专题器物" />
        <div className="ripple-xp-demo-hero-overlay">
          {hero && renderSlot(hero, props, text => <h1>{text}</h1>)}
          {productTitle && renderSlot(productTitle, props, text => <p className="ripple-xp-demo-sub">{text}</p>)}
          <span className="ripple-xp-demo-cta">查看商品</span>
        </div>
      </section>
      <section className="ripple-xp-demo-grid" aria-label="商品目录">
        <DemoCard title="柴烧茶壶" art="demo-assets/workshop.jpg" />
        <DemoCard title="素白陶碗" art="demo-assets/vessels.jpg" />
        {promo && renderSlot(promo, props, text => <div className="ripple-xp-demo-card is-promo"><span className="ripple-xp-demo-thumb" style={{ backgroundImage: 'url(demo-assets/seasonal.jpg)' }} /><strong>{text}</strong></div>)}
      </section>
    </>)
  }
  if (props.pageRef === 'page:seasonal') {
    const hero = slot('seasonal.hero.title')
    const banner = slot('seasonal.banner')
    const story = slot('seasonal.story.copy')
    return pageShell(page, <>
      <section className="ripple-xp-demo-hero ripple-xp-demo-seasonal-hero">
        <img className="ripple-xp-demo-hero-media" src="demo-assets/seasonal.jpg" alt="季节活动" />
        <div className="ripple-xp-demo-hero-overlay">
          {hero && renderSlot(hero, props, text => <h1>{text}</h1>)}
          {banner && renderSlot(banner, props, text => <span className="ripple-xp-demo-banner">{text}</span>)}
        </div>
      </section>
      <section className="ripple-xp-demo-story">
        <span className="ripple-xp-demo-kicker">活动说明 · 来源状态随目标显示</span>
        {story && renderSlot(story, props, text => <p>{text}</p>)}
      </section>
    </>)
  }
  if (props.pageRef === 'page:contact') {
    const title = slot('contact.title')
    const copy = slot('contact.copy')
    return pageShell(page, <>
      <section className="ripple-xp-demo-contact-intro">
        <span className="ripple-xp-demo-kicker">来源关系 UNKNOWN</span>
        {title && renderSlot(title, props, text => <h1>{text}</h1>)}
        {copy && renderSlot(copy, props, text => <p>{text}</p>)}
        <p className="ripple-xp-demo-unknown-note" data-testid="demo-page-note">页面内容可浏览；来源未证明，不能作为编辑目标。</p>
      </section>
      <form className="ripple-xp-demo-contact-form" onSubmit={event => event.preventDefault()}>
        <label>你的称呼<input placeholder="输入称呼" aria-label="你的称呼" /></label>
        <label>想说的话<textarea placeholder="告诉我们你想了解什么" aria-label="想说的话" /></label>
        <button type="submit" disabled>发送（演示）</button>
      </form>
    </>)
  }
  const title = slot('home.hero.title')
  const subtitle = slot('home.hero.subtitle')
  const banner = slot('home.hero.banner')
  return pageShell(page, <>
    <section className="ripple-xp-demo-hero">
      <img className="ripple-xp-demo-hero-media" src="demo-assets/hero-market.jpg" alt="秋日茶器市集" />
      <div className="ripple-xp-demo-hero-overlay">
        {title && renderSlot(title, props, text => <h1>{text}</h1>)}
        {subtitle && renderSlot(subtitle, props, text => <p className="ripple-xp-demo-sub">{text}</p>)}
        <div className="ripple-xp-demo-cta-row">
          <span className="ripple-xp-demo-cta">逛市集</span>
          {banner && renderSlot(banner, props, text => <span className="ripple-xp-demo-banner">{text}</span>)}
        </div>
      </div>
    </section>
    <section className="ripple-xp-demo-grid" aria-label="精选商品">
      <DemoCard title="柴烧茶壶" art="demo-assets/workshop.jpg" />
      <DemoCard title="素白陶碗" art="demo-assets/vessels.jpg" />
      <DemoCard title="手作风铃" art="demo-assets/seasonal.jpg" />
    </section>
  </>)
}

function DemoCard({ title, art }: { title: string; art: string }): ReactNode {
  return <div className="ripple-xp-demo-card"><span className="ripple-xp-demo-thumb" style={{ backgroundImage: `url(${art})` }} /><strong>{title}</strong></div>
}
