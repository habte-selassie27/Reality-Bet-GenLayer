import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Mirrors the /api/rpc rewrite in vercel.json so dev and production hit the
    // same same-origin endpoint (see rpcUrl() in src/lib/chains.ts).
    proxy: {
      '/api/rpc': {
        target: 'https://studio.genlayer.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/rpc/, '/api'),
      },
    },
  },
})
