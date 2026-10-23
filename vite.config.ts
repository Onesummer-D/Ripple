import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { localProjectApiPlugin } from './src/core/local-project-api'

export default defineConfig(({ mode }) => {
  // demo-static 模式：公网静态体验版（评委 Demo）。
  // 与正式构建的差异：强制演示适配器（VITE_STATIC_DEMO=1，入口在 experience-main.tsx 判定）、
  // 相对资源路径（可部署在任意子路径）、独立输出目录 dist-demo、不内嵌后端 API。
  const demoStatic = mode === 'demo-static'
  const input: Record<string, string> = demoStatic
    ? { experience: resolve(__dirname, 'experience.html') }
    : {
        main: resolve(__dirname, 'index.html'),
        experience: resolve(__dirname, 'experience.html'),
      }

  return {
    plugins: demoStatic ? [react()] : [localProjectApiPlugin(), react()],
    server: { host: '127.0.0.1', port: 4173, strictPort: true },
    base: demoStatic ? './' : '/',
    define: demoStatic ? { 'import.meta.env.VITE_STATIC_DEMO': JSON.stringify('1') } : {},
    build: {
      outDir: demoStatic ? 'dist-demo' : 'dist',
      rollupOptions: { input },
    },
  }
})
