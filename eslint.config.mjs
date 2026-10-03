import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';

/** Monorepo-root ESLint — applied to every package. Strict: no `any`. */
export default [
  {
    files: ['**/*.ts', '**/*.tsx'],
    // supabase/functions is Deno-owned (see .vscode/settings.json deno.enablePaths
    // and supabase/functions/deno.json) — it's linted by Deno's own linter and
    // uses `deno-lint-ignore` directives, so the Node/monorepo ESLint must not
    // double-lint it (otherwise its `deno-lint-ignore`d `any`s report as errors).
    ignores: ['**/node_modules/**', '**/dist/**', '**/.next/**', '**/.expo/**', 'supabase/functions/**'],
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
