import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', '.context/**', 'schemas/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      // Inference code deliberately uses `any` casts on formatters (see CLAUDE.md).
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Best-effort inference wraps every heuristic in try/catch and skips
      // gracefully on failure — empty catch blocks are intentional (see CLAUDE.md).
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
);
