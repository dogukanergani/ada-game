import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In dev the client talks to the game server through Vite's proxy, so a
// phone on the same Wi‑Fi (http://<your-ip>:5173) works with no extra config.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: { '/socket.io': { target: 'http://localhost:3001', ws: true } },
  },
});
