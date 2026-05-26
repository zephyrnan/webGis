import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    environment: 'jsdom',
    globals: true,
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
  },
  resolve: {
    alias: {
      '@wasm/geosurgical': resolve(__dirname, 'src-wasm/pkg/geosurgical_wasm.js'),
    },
  },
  optimizeDeps: {
    exclude: ['geosurgical-wasm'],
  },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  build: {
    rollupOptions: {
      external: [],
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) return 'react';
          if (id.includes('node_modules/ol')) return 'openlayers';
          if (id.includes('node_modules/zod')) return 'validation';
          if (id.includes('node_modules/@sentry')) return 'monitoring';
        },
      },
    },
  },
});
