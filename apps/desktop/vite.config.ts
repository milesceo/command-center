import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Tauri expects a fixed dev port; strictPort makes a clash fail loudly.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  // The highlighter worker code-splits (one chunk per grammar), which needs ES module workers.
  worker: { format: 'es' },
  server: { port: 1420, strictPort: true },
  test: { environment: 'node', include: ['src/**/*.test.{ts,tsx}'] },
});
