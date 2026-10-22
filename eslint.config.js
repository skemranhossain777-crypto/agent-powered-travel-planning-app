import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      '.firebase/**',
      'dataconnect/.dataconnect/**',
      'devserver.log',
      'coverage/**',
      // Compiled Cloud Functions output: a gitignored deploy-time build
      // artifact, linted through its TypeScript sources in functions/src.
      'functions/lib/**',
    ],
  },

  // Recommended JS rules.
  js.configs.recommended,

  // Recommended TypeScript rules (correctness focused, no stylistic configs —
  // formatting is owned by Prettier).
  ...tseslint.configs.recommended,

  // React plugin: legacy-recommended + jsx-runtime (automatic runtime). The
  // project uses TypeScript for prop types, so prop-types is turned off.
  react.configs.flat.recommended,
  react.configs.flat['jsx-runtime'],
  {
    files: ['**/*.{js,mjs,cjs,ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.es2020,
      },
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
    rules: {
      'react/prop-types': 'off',
      'react/no-unknown-property': 'error',
      // React 18 + the automatic runtime; the legacy runtime rules are noise.
      'react/jsx-uses-react': 'off',
      'react/react-in-jsx-scope': 'off',
    },
  },

  // React Hooks + React Refresh (Vite fast-refresh correctness).
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.flat['recommended-latest'].rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },

  {
    files: ['functions/**/*.{ts,js}'],
    languageOptions: {
      globals: {
        ...globals.node,
        fetch: 'readonly',
        Request: 'readonly',
        Response: 'readonly',
        Headers: 'readonly',
      },
    },
  },

  // Prettier compatibility: disable any remaining rules that conflict with
  // formatting. Prettier owns formatting; ESLint owns correctness.
  prettier
);
