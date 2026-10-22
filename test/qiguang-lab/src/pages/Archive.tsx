/**
 * 往届档案页：独立素材 /media/qiguang-archive.jpg，不消费共享主视觉。
 * 共享媒体被替换（wide→tall）时，本页的字节与渲染必须完全不变——
 * collect-evidence.ts 对两端做 HTTP 字节相等断言。
 */
export default function Archive() {
  return (
    <main>
      <nav className="site-nav">
        <a href="/index.html">首页</a>
        <a href="/program.html">节目</a>
        <a href="/tickets.html">购票</a>
        <a href="/archive.html">往届</a>
      </nav>
      <h1>往届档案</h1>
      <section className="archive-container" data-container="archive-banner">
        <img src="/media/qiguang-archive.jpg" alt="往届栖光艺术节档案" data-consumer="archive" />
      </section>
    </main>
  )
}
