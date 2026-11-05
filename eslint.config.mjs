import js from '@eslint/js';
import tsPlugin from 'typescript-eslint';

export default [
  js.configs.recommended,
  ...tsPlugin.configs.recommended,
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', '**/*.d.ts']
  },
  {
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly'
      }
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': ['warn', { allow: ['info', 'warn', 'error'] }]
    }
  }
];
