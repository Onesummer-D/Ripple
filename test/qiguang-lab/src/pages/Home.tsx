import SharedFestivalImage from '../components/SharedFestivalImage'

/**
 * 首页：共享主视觉的 Hero 容器（16:9 · cover center），
 * 以及仅首页消费的本地图 /media/qiguang-home-local.jpg。
 */
export default function Home() {
  return (
    <main>
      <nav className="site-nav">
        <a href="/index.html">首页</a>
        <a href="/program.html">节目</a>
        <a href="/tickets.html">购票</a>
        <a href="/archive.html">往届</a>
      </nav>
      <h1>第六届栖光艺术节</h1>
      <section className="hero-container" data-container="home-hero">
        <SharedFestivalImage className="hero-img" />
      </section>
      <section className="local-section" data-container="home-local">
        <h2>城市光影驻地计划</h2>
        <img src="/media/qiguang-home-local.jpg" alt="驻地计划现场" data-consumer="home-local" />
      </section>
    </main>
  )
}
