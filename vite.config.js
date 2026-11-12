import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2020',
    cssCodeSplit: true,
    rollupOptions: {
      output: {
        // Split the framework out of the app chunk: React and the router change
        // far less often than page code, so they stay cached across deploys.
        manualChunks: {
          // react-dom/client is a different module id from react-dom, and
          // main.jsx imports the former — so the renderer, around 180 KB of
          // it, was never pulled in here and shipped in the app chunk
          // instead, re-downloaded on every deploy. Verify after a build with:
          //   grep -c __reactContainer dist/assets/react-vendor-*.js
          'react-vendor': [
            'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client',
            'react-router', 'react-router-dom',
          ],
        },
      },
    },
  },
})
