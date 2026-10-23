import { Link } from 'react-router-dom'
import SharedFestivalImage from '../components/SharedFestivalImage'

/** 路由变体首页：共享主视觉 Hero 容器（16:9 · cover center）+ 首页本地图。 */
export default function Home() {
  return (
    <main>
      <h1>第六届栖光艺术节</h1>
      <nav data-testid="home-nav">
        <Link to="/program">节目</Link>
        <Link to="/tickets">购票</Link>
        <Link to="/archive">档案</Link>
      </nav>
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
