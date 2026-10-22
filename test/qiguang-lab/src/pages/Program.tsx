import SharedFestivalImage from '../components/SharedFestivalImage'

/**
 * 节目页：共享主视觉的展墙容器（4:3 · cover 50% 20%）。
 * 与首页 Hero 消费同一媒体源，但裁切窗口不同。
 */
export default function Program() {
  return (
    <main>
      <nav className="site-nav">
        <a href="/index.html">首页</a>
        <a href="/program.html">节目</a>
        <a href="/tickets.html">购票</a>
        <a href="/archive.html">往届</a>
      </nav>
      <h1>节目单</h1>
      <section className="wall-container" data-container="program-wall">
        <SharedFestivalImage className="wall-img" />
      </section>
      <ul className="program-list">
        <li>开幕光影秀 · 10 月 31 日</li>
        <li>河畔声景巡游 · 11 月 2 日</li>
        <li>闭幕对谈 · 11 月 9 日</li>
      </ul>
    </main>
  )
}
