import { useState } from 'react'
import { SiteFooter } from '../components/SiteFooter'

export function HomePage() {
  const [expanded, setExpanded] = useState(false)
  return (
    <main>
      <h1>青野家居生活馆</h1>
      <p>精选天然材质的家居用品。</p>
      <button type="button" onClick={() => setExpanded(true)}>
        展开服务详情
      </button>
      {expanded && <p>服务详情已展开</p>}
      <SiteFooter />
    </main>
  )
}
