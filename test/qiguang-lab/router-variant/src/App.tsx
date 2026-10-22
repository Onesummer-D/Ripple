import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import Home from './pages/Home'
import Program from './pages/Program'
import Tickets from './pages/Tickets'
import Archive from './pages/Archive'

/**
 * data-router 路由表：/、/program、/tickets 三个页面消费共享主视觉组件，
 * /archive 独立素材。形态对齐 PR #28 已验证夹具（命名导出 App + Component 路由），
 * 保证 inspectDataRouter 可静态证明页面节点。
 */
const router = createBrowserRouter([
  { path: '/', Component: Home },
  { path: '/program', Component: Program },
  { path: '/tickets', Component: Tickets },
  { path: '/archive', Component: Archive },
])

export function App() {
  return <RouterProvider router={router} />
}
