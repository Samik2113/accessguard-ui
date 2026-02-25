import fs from 'fs';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    server: {
      host: 'localhost',           // bind to VM’s IP so it’s reachable outside RDP
      port: 3000,
      /*https: {
        key: fs.readFileSync('./172.16.0.4-key.pem'),
        cert: fs.readFileSync('./172.16.0.4.pem'),
      },*/
      
    },
    plugins: [react()],
    define: {
      'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: { '@': path.resolve(__dirname, '.') },
    },
  };
});
