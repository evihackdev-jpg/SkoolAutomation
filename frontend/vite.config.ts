import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const { DEV_API_TARGET = 'http://127.0.0.1:3002' } = loadEnv(mode, '.', 'DEV_API_TARGET');
  const proxy = { '/api': { target: DEV_API_TARGET, changeOrigin: true } };
  return {
  plugins: [react()],
  server: {
    // IPv4 loopback only: keeps the dev server off the LAN and avoids ::1/localhost mismatches.
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy,
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
    proxy,
  },
  };
});
