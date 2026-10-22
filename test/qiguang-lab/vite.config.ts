import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * 栖光 Lab Vite 配置：扁平多页面（.html 入口）。
 * 不能用目录式 MPA（/program/）：验收受限静态服务的 SPA 回退会把无扩展名路径
 * 落到根 index.html。相对 input 相对本配置所在目录（Vite root）解析。
 */
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        home: 'index.html',
        program: 'program.html',
        tickets: 'tickets.html',
        archive: 'archive.html',
      },
    },
  },
})
