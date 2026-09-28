import { defineConfig } from 'vite'
export default defineConfig({
  base: '/zjcost/',
  server: { host: '127.0.0.1', port: 5175 },
  optimizeDeps: { noDiscovery: true, include: [] },
})
