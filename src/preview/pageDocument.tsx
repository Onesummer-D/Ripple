import { renderToStaticMarkup } from 'react-dom/server'
import type { CSSProperties } from 'react'
import type { CaseId, EditableSlot } from '../domain/contracts'
import type { MediaResource } from '../adapters/mediaLibrary'

const pageStyles = `
*{box-sizing:border-box}body{margin:0;font:16px/1.6 system-ui,sans-serif;color:#3c3128;background:#f3ecdf}header{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:22px 5vw;border-bottom:1px solid #46372b22}header strong{font:700 23px Georgia,serif}nav{display:flex;gap:18px;font-size:13px}main{max-width:1280px;margin:auto;padding:36px 5vw 64px}h1,h2,h3,p{margin:0}h1{font:600 clamp(36px,4vw,64px)/1.18 Georgia,serif;margin:22px 0}h2{font:600 38px/1.2 Georgia,serif}p{color:#786b5e}.eyebrow{font-size:12px;letter-spacing:.14em;text-transform:uppercase}.hero{padding:50px 0;max-width:900px}.cta{display:inline-block;margin-top:24px;padding:12px 22px;background:#735341;color:#fff;border-radius:4px;font-size:14px}.cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:22px;margin-top:30px}.card{background:#fff8ee;border:1px solid #89745633;padding:24px;border-radius:6px}.card .art{height:160px;background:linear-gradient(135deg,#bca980,#e5d8bc);margin-bottom:18px}.promotion{position:relative;background:#e8d9c1;padding:28px;height:230px;border-radius:8px}.promotion h1{margin:0;font-size:42px;max-width:780px}.purchase{position:absolute;bottom:18px;left:28px;margin:0}.about{max-width:800px;padding:60px 0}.about p{margin-top:20px;font-size:19px}.page-name{margin-bottom:28px}.festival{color:#f6f1ff;background:#151120}.festival header{border-color:#ffffff33}.festival main{max-width:1300px}.festival p{color:#c3b4d1}.festival h1{font:700 clamp(42px,6vw,82px)/1 sans-serif;letter-spacing:-.05em}.festival .cards{grid-template-columns:repeat(3,minmax(0,1fr))}.festival .card{background:#241b30;border-color:#58446c}.poster{display:block;width:100%;object-fit:cover;object-position:center;border-radius:5px}.banner-poster{aspect-ratio:16/9}.wall-poster{aspect-ratio:4/5;max-width:480px}.ticket-poster{aspect-ratio:1/1}.poster-frame{margin-top:28px}.festival .cta{background:#f97316;color:#17101b}.ticket-card{max-width:700px;display:grid;grid-template-columns:1fr 1fr;gap:28px;padding:28px;background:#241b30;border:1px solid #645172;border-radius:8px}.archive{max-width:680px}.token-page{background:#f7f7fa;color:#252233}.token-page p{color:#777}.token-card{padding:28px;border:1px solid #d5d2de;border-radius:12px;background:#fff}.token-button{padding:13px 22px;color:white;background:var(--token);border:0;border-radius:8px}.token-badge{display:inline-block;color:var(--token);border:1px solid currentColor;padding:5px 12px;border-radius:999px}.token-icon{color:var(--token);font-size:44px}.fixture-label{font-size:12px;color:#8b735f;margin-top:30px}.festival .fixture-label{color:#b5a4c1}
@media(max-width:600px){header{padding:18px 22px;flex-wrap:wrap}nav{gap:14px;flex-wrap:wrap}main{padding:24px 22px 48px}.hero{padding:28px 0}.cards,.festival .cards{grid-template-columns:1fr}.promotion{height:148px;padding:20px}.promotion h1{font-size:32px;line-height:1.22}.purchase{left:20px;bottom:16px}.ticket-card{grid-template-columns:1fr;padding:18px}.festival h1{font-size:44px}.about{padding:24px 0}}
`

const identity = (slot: EditableSlot) => ({ 'data-slot-id': slot.id, 'data-instance-id': slot.instanceId, 'data-source-id': slot.sourceId })

function QingyePage({ route, slots }: { route: string; slots: EditableSlot[] }) {
  const title = slots[0]
  const names: Record<string, string> = { '/': '秋日生活提案', '/autumn': '秋季活动', '/collection': '秋日精选专题', '/about': '青野的故事' }
  return <><header><strong>青野 QINGYE</strong><nav><span>首页</span><span>秋季活动</span><span>精选好物</span><span>品牌故事</span></nav></header><main>
    <p className="eyebrow page-name">{names[route] ?? route}</p>
    {route === '/autumn' ? <><section className="promotion"><h1 {...identity(title)}>{title.value}</h1><span className="cta purchase" data-testid="purchase-cta">立即购买秋日精选</span></section><p style={{ marginTop: 24 }}>会员周末专属礼遇 · 活动页移动版</p></>
      : route === '/about' ? <section className="about"><h1 {...identity(title)}>{title.value}</h1><p>从一片叶子，到一件留在生活里的好物。青野把自然的颜色与手作的温度，带进每一天。</p><p>这个页面使用独立的品牌故事来源。</p></section>
      : <section className="hero"><p className="eyebrow">QINGYE / AUTUMN COLLECTION</p><h1 {...identity(title)}>{title.value}</h1><p>{route === '/collection' ? '属于这个季节的材料、纹理与小小心意。' : '把秋日的温柔，带回日常。'}</p><span className="cta">探索秋日精选</span></section>}
    {route !== '/about' && <section className="cards">{['纸间秋色', '织物小记', '日常器物'].map((name) => <article className="card" key={name}><div className="art" /><h3>{name}</h3><p>青野秋日系列 · 精选好物</p></article>)}</section>}
    <p className="fixture-label">A 本地案例页面 · {route}</p>
  </main></>
}

function QiguangPage({ route, slots, resources }: { route: string; slots: EditableSlot[]; resources: Record<string, MediaResource> }) {
  const poster = slots[0]
  const resource = poster.value.startsWith('media://') ? resources[poster.value.slice(8)] : undefined
  const src = resource?.dataUrl ?? (poster.value.startsWith('/assets/') ? poster.value : undefined)
  const image = (className: string) => src ? <img {...identity(poster)} className={`poster ${className}`} src={src} alt={poster.label} /> : <p {...identity(poster)}>图片资源待接入</p>
  return <><header><strong>栖光 / MIRAGE</strong><nav><span>主视觉</span><span>节目</span><span>购票</span><span>往届</span></nav></header><main>
    {route === '/tickets' ? <><h1>GET YOUR PASS</h1><div className="ticket-card">{image('ticket-poster')}<div><h2>栖光艺术节</h2><p>声音、影像与现场艺术</p><p>10.17—10.20 · 城市艺术中心</p><span className="cta">选择场次</span></div></div></>
      : route === '/program' ? <><p className="eyebrow">PROGRAM / 2026</p><h1>作品与现场</h1><div className="poster-frame">{image('wall-poster')}</div><section className="cards">{['光的边界', '城市回声', '夜间剧场'].map((name) => <article className="card" key={name}><h3>{name}</h3><p>影像 / 装置 / 表演</p></article>)}</section></>
      : route === '/archive' ? <div className="archive"><p className="eyebrow">ARCHIVE / INDEPENDENT POSTER</p><h1>往届回顾</h1><div className="poster-frame">{image('banner-poster')}</div><p>这一季的作品与主视觉被独立保留。</p></div>
      : <><p className="eyebrow">ARTS FESTIVAL / 2026</p><h1>看见另一种可能</h1><div className="poster-frame">{image('banner-poster')}</div><span className="cta">探索节目</span></>}
    <p className="fixture-label">A 本地案例页面 · {route}{resource ? ` · ${resource.width} × ${resource.height}` : ''}</p>
  </main></>
}

function TokenPage({ route, slots }: { route: string; slots: EditableSlot[] }) {
  return <><header><strong>Token 消费演示</strong><nav><span>Showcase</span><span>Docs</span></nav></header><main><p className="eyebrow">INTERACTION FIXTURE / {route}</p><h1>共享色彩的消费位置</h1><p>第三方原站待接入，当前展示色彩交互契约。</p><section className="cards">{slots.map((slot) => <article className="token-card" key={slot.id}><h3>{slot.label}</h3><div {...identity(slot)} style={{ '--token': /^#[0-9a-f]{6}$/i.test(slot.value) ? slot.value : '#8b5cf6' } as CSSProperties}>{slot.id.includes('badge') ? <span data-token-consumer="badge" className="token-badge">进行中</span> : slot.id.includes('icon') ? <span data-token-consumer="icon" className="token-icon">✦</span> : <button data-token-consumer="button" type="button" className="token-button">开始探索</button>}</div><p>{slot.value}</p></article>)}</section></main></>
}

export function createPageDocument(caseId: CaseId, route: string, values: EditableSlot[], resources: Record<string, MediaResource>) {
  const slots = values.filter((slot) => slot.route === route)
  const page = slots.length === 0 ? <main><h1>该路由没有可预览内容</h1><p>{route}</p></main> : caseId === 'qingye' ? <QingyePage route={route} slots={slots} /> : caseId === 'qiguang' ? <QiguangPage route={route} slots={slots} resources={resources} /> : <TokenPage route={route} slots={slots} />
  return '<!doctype html>' + renderToStaticMarkup(<html lang="zh-CN"><head><meta charSet="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>{`${caseId} ${route}`}</title><style>{pageStyles}</style></head><body className={caseId === 'qiguang' ? 'festival' : caseId === 'third-party' ? 'token-page' : undefined} data-case-id={caseId} data-route={route}>{page}</body></html>)
}
