import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Port 5174 and the same /api + /socket.io proxy targets the other two
// frontends already use (Immiglance 5173, Admin 3002) — see
// PHASE0_FINDINGS.md §17.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      '/api': { target: 'http://localhost:7000', changeOrigin: true },
      '/socket.io': { target: 'http://localhost:7000', ws: true, changeOrigin: true },
    },
  },
})
