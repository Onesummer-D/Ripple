import SharedFestivalImage from '../components/SharedFestivalImage'

/** 路由变体节目页：共享主视觉展墙容器（4:3 · cover 50% 20%）。 */
export default function Program() {
  return (
    <main>
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
