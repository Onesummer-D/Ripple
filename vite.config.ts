import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { localProjectApiPlugin } from './src/core/local-project-api'

export default defineConfig({
  plugins: [localProjectApiPlugin(), react()],
  server: { host: '127.0.0.1', port: 4173, strictPort: true },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        experience: resolve(__dirname, 'experience.html'),
      },
    },
  },
})
