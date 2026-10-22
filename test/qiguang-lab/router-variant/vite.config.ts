import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * 栖光 Lab · data-router 联合验证变体（单页应用形态）。
 * 与扁平 MPA 主 Lab 的区别：路由表走 createBrowserRouter（React Router），
 * 使页面（route）节点可按 PR #28 的 inspectDataRouter 静态证明；
 * 受限静态服务的 SPA 回退正好把 /program 等路径落到本 index.html。
 */
export default defineConfig({
  plugins: [react()],
})
