import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import {
  findMissingFirebaseEnvVars,
  formatMissingFirebaseEnvVarsMessage,
} from './src/config/firebaseEnv';

function validateFirebaseEnvPlugin(): Plugin {
  return {
    name: 'voyageai-validate-firebase-env',
    apply: 'build',
    configResolved(config) {
      if (config.mode !== 'production') return;
      const env = { ...loadEnv(config.mode, config.root, 'VITE_'), ...process.env };
      const missing = findMissingFirebaseEnvVars(env);
      if (missing.length > 0) {
        throw new Error(formatMissingFirebaseEnvVarsMessage(missing));
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), validateFirebaseEnvPlugin()],
  server: {
    port: 3000,
    open: true
  }
});
