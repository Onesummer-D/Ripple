import SharedFestivalImage from '../components/SharedFestivalImage'

/**
 * 购票页：共享主视觉的购票卡片容器（约 3:4 · cover top）。
 * 第三个消费位置：窄高容器对横/竖版源的裁切差异最大。
 */
export default function Tickets() {
  return (
    <main>
      <nav className="site-nav">
        <a href="/index.html">首页</a>
        <a href="/program.html">节目</a>
        <a href="/tickets.html">购票</a>
        <a href="/archive.html">往届</a>
      </nav>
      <h1>购票</h1>
      <section className="ticket-grid">
        <article className="ticket-card" data-container="ticket-card">
          <SharedFestivalImage className="ticket-img" />
          <div className="ticket-info">
            <strong>通票 · 三日</strong>
            <span>¥ 299</span>
          </div>
        </article>
      </section>
    </main>
  )
}
