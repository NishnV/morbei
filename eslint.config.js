import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // .claude holds git worktrees — full copies of this repo. Linting them
  // doubled every error, and because their paths do not match the server/**
  // override below, every `process.env` in the copied backend was reported as
  // an undefined browser global. Forty phantom errors burying the real ones.
  globalIgnores(['dist', '.claude', 'coverage']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
    },
  },
  {
    // A context file exporting its provider and its hook together is the
    // pattern everything here uses; the rule wants them in separate files so
    // Vite's fast refresh can keep state across edits. That is a dev-server
    // convenience, and not worth splitting five files and every import of
    // them. Scoped off rather than disabled line by line so the rule still
    // applies to real components.
    files: ['src/context/**/*.jsx', 'src/components/Seo.jsx'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
  {
    // The backend is Node, not a browser. Linting it with browser globals
    // reported every `process.env` as an undefined variable — around forty
    // phantom errors that buried the real ones in server code.
    files: ['server/**/*.js', 'scripts/**/*.mjs', '*.config.js'],
    languageOptions: { globals: globals.node },
    rules: {
      // Express identifies error handlers by arity, so the unused `next` on a
      // four-argument handler is required, not dead.
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]', argsIgnorePattern: '^_' }],
      'react-refresh/only-export-components': 'off',
    },
  },
])
