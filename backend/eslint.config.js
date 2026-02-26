import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import boundaries from 'eslint-plugin-boundaries';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
  {
    rules: {
      // Relax rules for existing codebase
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-asserted-optional-chain': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      'prefer-const': 'off',
    },
  },
  {
    plugins: { boundaries },
    settings: {
      'import/resolver': {
        typescript: {
          alwaysTryTypes: true,
          project: './tsconfig.json',
        },
      },
      'boundaries/elements': [
        { type: 'core', pattern: 'src/core/**', mode: 'folder' },
        { type: 'ai-intelligence', pattern: 'src/modules/ai-intelligence/**', mode: 'folder' },
        { type: 'observability', pattern: 'src/modules/observability/**', mode: 'folder' },
        { type: 'security', pattern: 'src/modules/security/**', mode: 'folder' },
        { type: 'operations', pattern: 'src/modules/operations/**', mode: 'folder' },
        { type: 'infrastructure', pattern: 'src/modules/infrastructure/**', mode: 'folder' },
        { type: 'scheduler', pattern: 'src/scheduler/**', mode: 'folder' },
        { type: 'app', pattern: 'src/app.ts', mode: 'file' },
        { type: 'routes', pattern: 'src/routes/**', mode: 'folder' },
        { type: 'sockets', pattern: 'src/sockets/**', mode: 'folder' },
      ],
      'boundaries/ignore': ['**/*.test.ts', '**/*.spec.ts', '**/test-utils/**'],
    },
    rules: {
      'boundaries/element-types': [
        'error',
        {
          default: 'disallow',
          rules: [
            // Everything can import from core
            { from: '*', allow: ['core'] },
            // Within same module
            { from: 'ai-intelligence', allow: ['ai-intelligence'] },
            { from: 'observability', allow: ['observability'] },
            { from: 'security', allow: ['security'] },
            { from: 'operations', allow: ['operations'] },
            { from: 'infrastructure', allow: ['infrastructure'] },
            { from: 'scheduler', allow: ['scheduler'] },
            // app.ts / routes / sockets can import from any module
            {
              from: ['app', 'routes', 'sockets'],
              allow: [
                'ai-intelligence',
                'observability',
                'security',
                'operations',
                'infrastructure',
                'routes',
                'sockets',
              ],
            },
            // scheduler can import from any module
            {
              from: 'scheduler',
              allow: [
                'ai-intelligence',
                'observability',
                'security',
                'operations',
                'infrastructure',
              ],
            },
          ],
        },
      ],
      'boundaries/entry-point': [
        'error',
        {
          default: 'disallow',
          rules: [
            // All domain modules: only allow index.* (barrel)
            {
              target: ['ai-intelligence', 'observability', 'security', 'operations', 'infrastructure'],
              allow: 'index.*',
            },
            // core and routes: allow any file (fine-grained imports OK)
            { target: 'core', allow: '**' },
            { target: 'routes', allow: '**' },
            { target: 'sockets', allow: '**' },
          ],
        },
      ],
    },
  }
);
