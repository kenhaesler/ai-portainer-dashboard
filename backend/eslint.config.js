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
            // Within same element type
            { from: 'scheduler', allow: ['scheduler'] },
            // app.ts / routes / sockets can import from each other
            {
              from: ['app', 'routes', 'sockets'],
              allow: ['routes', 'sockets'],
            },
          ],
        },
      ],
      'boundaries/entry-point': [
        'error',
        {
          default: 'disallow',
          rules: [
            // core, routes, sockets: allow any file (fine-grained imports OK)
            { target: 'core', allow: '**' },
            { target: 'routes', allow: '**' },
            { target: 'sockets', allow: '**' },
          ],
        },
      ],
    },
  }
);
