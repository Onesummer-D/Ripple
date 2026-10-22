import SharedFestivalImage from '../components/SharedFestivalImage'

/** 路由变体购票页：共享主视觉购票卡片容器（3:4 · cover top）。 */
export default function Tickets() {
  return (
    <main>
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
