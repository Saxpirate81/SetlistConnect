import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // Warn when a chunk is over 500kb (down from default 1000kb)
    chunkSizeWarningLimit: 500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          // Keep React and scheduler together — they must be co-located
          if (id.includes('react') || id.includes('scheduler')) return 'react-vendor'
          // Supabase is large but needed early — its own chunk
          if (id.includes('@supabase')) return 'supabase-vendor'
          // html2pdf is already dynamically imported; this ensures it stays split
          if (id.includes('html2pdf') || id.includes('html2canvas') || id.includes('jspdf')) {
            return 'vendor-pdf'
          }
          // Everything else gets its own per-package chunk
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
