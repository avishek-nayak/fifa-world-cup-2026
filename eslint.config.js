/**
 * ESLint flat config. Zero warnings tolerated in CI (`npm run lint`).
 */
export default [
  {
    files: ['src/**/*.js', 'tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        document: 'readonly', window: 'readonly', console: 'readonly',
        fetch: 'readonly', AbortController: 'readonly', performance: 'readonly',
        setTimeout: 'readonly', clearTimeout: 'readonly',
        requestAnimationFrame: 'readonly'
      }
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-undef': 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-var': 'error',
      'prefer-const': 'error',
      eqeqeq: ['error', 'smart'],
      'no-console': ['warn', { allow: ['warn', 'error'] }]
    }
  }
];
