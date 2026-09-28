import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/zjcost/',
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8098',
    },
  },
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          const normalized = id.replace(/\\/g, '/')
          if (normalized.match(/node_modules\/(react|react-dom|react-router|react-router-dom|scheduler)\//)) {
            return 'vendor-react'
          }
          if (normalized.includes('/node_modules/three/')) return 'vendor-three'
          if (normalized.match(/node_modules\/d3[^/]*\//)) return 'vendor-d3'
          return undefined
        },
      },
    },
  },
})
