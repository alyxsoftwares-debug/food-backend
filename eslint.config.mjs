// eslint.config.mjs
// ESLint Flat Config (v9+) para TypeScript + Node.js

import tsParser    from '@typescript-eslint/parser';
import tsPlugin    from '@typescript-eslint/eslint-plugin';

/** @type {import('eslint').Linter.FlatConfig[]} */
export default [
  // -------------------------------------------------------------------------
  // Arquivos ignorados
  // -------------------------------------------------------------------------
  {
    ignores: [
      'dist/**',
      'coverage/**',
      'node_modules/**',
      '*.js',
      '*.mjs',
    ],
  },

  // -------------------------------------------------------------------------
  // Configuração principal — TypeScript
  // -------------------------------------------------------------------------
  {
    files          : ['src/**/*.ts'],
    languageOptions: {
      parser       : tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType : 'module',
        project    : './tsconfig.json',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      // -----------------------------------------------------------------------
      // TypeScript — Regras de qualidade
      // -----------------------------------------------------------------------
      '@typescript-eslint/no-explicit-any'            : 'warn',
      '@typescript-eslint/no-unused-vars'             : ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/explicit-function-return-type': 'off',   // Desabilitado — inferência suficiente
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-non-null-assertion'      : 'warn',
      '@typescript-eslint/no-floating-promises'       : 'error',   // Proíbe Promises não tratadas
      '@typescript-eslint/await-thenable'             : 'error',
      '@typescript-eslint/no-misused-promises'        : 'error',
      '@typescript-eslint/require-await'              : 'error',
      '@typescript-eslint/prefer-nullish-coalescing'  : 'warn',
      '@typescript-eslint/prefer-optional-chain'      : 'warn',
      '@typescript-eslint/consistent-type-imports'    : ['warn', { prefer: 'type-imports' }],

      // -----------------------------------------------------------------------
      // JavaScript — Boas práticas gerais
      // -----------------------------------------------------------------------
      'no-console'                  : 'warn',           // Use o logger, não console.log
      'no-debugger'                 : 'error',
      'no-duplicate-imports'        : 'error',
      'no-var'                      : 'error',
      'prefer-const'                : 'error',
      'prefer-template'             : 'warn',
      'eqeqeq'                      : ['error', 'always'],
      'curly'                       : ['error', 'all'],
      'no-throw-literal'            : 'error',
      'no-return-await'             : 'error',          // Evita await desnecessário no return
      'object-shorthand'            : 'warn',
      'no-nested-ternary'           : 'warn',
      'no-else-return'              : 'warn',
    },
  },

  // -------------------------------------------------------------------------
  // Relaxa regras nos arquivos de teste
  // -------------------------------------------------------------------------
  {
    files: ['**/*.spec.ts', '**/*.test.ts', '**/__tests__/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
      'no-console': 'off',
    },
  },
];
