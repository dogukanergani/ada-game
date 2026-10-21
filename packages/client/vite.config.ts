import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// The server answers on :3001. In development the page comes from Vite and the
// socket is proxied, so the client always talks to its own origin (a phone on
// the same network works the same way: http://<this machine>:5173).
const server = process.env.ADA_SERVER ?? 'http://localhost:3001';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: { '/socket.io': { target: server, ws: true, changeOrigin: true } },
  },
  preview: { host: true, port: 4173, proxy: { '/socket.io': { target: server, ws: true, changeOrigin: true } } },
  build: { outDir: 'dist', sourcemap: false, target: 'es2022' },
  test: { environment: 'node', include: ['test/**/*.test.ts', 'test/**/*.test.tsx'] },
});
