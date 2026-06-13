import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';

/** Monorepo-root ESLint — applied to every package. Strict: no `any`. */
export default [
  {
    files: ['**/*.ts', '**/*.tsx'],
    ignores: ['**/node_modules/**', '**/dist/**', '**/.next/**', '**/.expo/**'],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    },
    plugins: { '@typescript-eslint': tsPlugin },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'warn',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
];
