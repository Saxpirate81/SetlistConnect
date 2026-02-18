import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('react') || id.includes('scheduler')) return 'react-vendor'
          if (id.includes('@supabase')) return 'supabase-vendor'
          const parts = id.split('node_modules/')[1]?.split('/') ?? []
          if (parts.length === 0) return 'vendor'
          const packageName = parts[0].startsWith('@')
            ? `${parts[0]}-${parts[1] ?? 'pkg'}`
            : parts[0]
          return `vendor-${packageName.replace(/[^a-zA-Z0-9_-]/g, '_')}`
        },
      },
    },
  },
})
