import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('/element-plus/') || id.includes('\\element-plus\\')) return 'vendor-element-plus'
          if (id.includes('/@element-plus/') || id.includes('\\@element-plus\\')) return 'vendor-element-plus'
          return 'vendor'
        },
      },
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5180,
    strictPort: true,
    allowedHosts: ['localhost.localdomain'],
  },
  preview: {
    host: '127.0.0.1',
    port: 5180,
    strictPort: true,
    allowedHosts: ['localhost.localdomain'],
  },
})
