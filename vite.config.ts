/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the built site works from any path (GitHub Pages, a USB stick, a sub-folder).
  base: './',
  plugins: [react()],
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three')) return 'three';
          if (id.includes('node_modules/astronomy-engine')) return 'ephemeris';
          if (id.includes('node_modules/react')) return 'react';
        },
      },
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
