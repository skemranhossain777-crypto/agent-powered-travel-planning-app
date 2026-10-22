import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // STEP 38: the default 5000ms cap times out heavy TripWorkspacePage tests
    // under full-suite coverage instrumentation (parallel page renders under
    // the v8 profiler). 20000ms matches the per-test timeout those heavy page
    // tests already declare individually (precedent TripWorkspacePage.test.tsx).
    // Verified: `npm run test:coverage` at 5000ms flaked 3 consecutive runs
    // (3-4 timeouts in TripWorkspacePage.test.tsx); at 20000ms the same suite
    // passes 1342/1342. No assertion or coverage reduction involved.
    testTimeout: 20000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      include: ['src/services/**', 'src/components/ErrorBoundary.tsx'],
      exclude: [
        'src/services/authService.ts',
        'src/services/firebase.ts',
        'src/services/firestoreService.ts',
        'src/**/*.test.{ts,tsx}',
        'src/test/**',
      ],
    },
  },
});
