import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, resolve(process.cwd(), '../..'), '');
  const target = `http://localhost:${env.PORT || '4000'}`;
  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: Number(new URL(env.FRONTEND_URL || 'http://localhost:5173').port || 5173),
      strictPort: true,
      proxy: { '/api': target, '/admin': target, '/health': target },
    },
  };
});
