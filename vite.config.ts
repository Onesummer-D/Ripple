import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { localProjectApiPlugin } from './src/core/local-project-api'

export default defineConfig({
  plugins: [localProjectApiPlugin(), react()],
  server: { host: '127.0.0.1', port: 4173, strictPort: true },
})
