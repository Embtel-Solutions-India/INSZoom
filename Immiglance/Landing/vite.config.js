import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'

// Copied verbatim from the pre-split Immiglance/Frontend/vite.config.js, with
// one addition: an explicit server.port. The single fused app relied on Vite's
// 5173 default; now that Landing and Client are two apps that run side by
// side, each needs its own port (Landing keeps the historic 5173, Client
// takes 5175 — 5174 is Attorney's and 3002 is Admin's).
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    babel({ presets: [reactCompilerPreset()] }),
  ],
  test: {
    environment: "jsdom",
    globals: true,
  },
  server: {
    port: 5173,
    headers: {
      'Cross-Origin-Opener-Policy': 'unsafe-none',
      'Cross-Origin-Embedder-Policy': 'unsafe-none',
    },
    proxy: {
      '/api': {
        target: 'http://localhost:7000',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:7000',
        ws: true,
        changeOrigin: true,
      },
    },
  },
})
