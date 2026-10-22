import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import Home from './pages/Home'
import Program from './pages/Program'
import Tickets from './pages/Tickets'
import Archive from './pages/Archive'
import './styles.css'

/**
 * 扁平多页共享入口：各 .html 以 <body data-page="..."> 声明身份，
 * 同一 bundle 按 dataset 渲染对应页组件（模拟真实工程的多页共享 chunk）。
 */
const pages = {
  home: Home,
  program: Program,
  tickets: Tickets,
  archive: Archive,
} as const

type PageName = keyof typeof pages

function pageNameFromDataset(): PageName {
  const value = document.body.dataset.page
  return value && value in pages ? (value as PageName) : 'home'
}

const Page = pages[pageNameFromDataset()]
const container = document.getElementById('root')
if (!container) throw new Error('缺少 #root 挂载点')

createRoot(container).render(
  <StrictMode>
    <Page />
  </StrictMode>,
)
