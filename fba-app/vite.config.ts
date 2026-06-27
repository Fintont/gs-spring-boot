import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // Proxy market-data API calls to the Node server (npm run dev:server).
    proxy: { '/api': `http://localhost:${process.env.PORT ?? 8787}` },
  },
  test: {
    globals: true,
    environment: 'node',
  },
});
