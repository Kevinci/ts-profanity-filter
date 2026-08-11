// Flat config, ESLint 9.
//
// The rules here are the ones this codebase already follows and would notice
// breaking. Anything Prettier decides — quotes, commas, line breaks — is left to
// Prettier: a linter and a formatter arguing about the same character is how a
// repository ends up with a `lint` script nobody runs.

import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // dist/ is generated, docs/index.html is generated, and the playground
    // template is a hand-built page rather than a module.
    ignores: [
      'dist/**',
      'docs/**',
      'demo/**',
      'node_modules/**',
      'adversarial/dist/**',
      // Outside adversarial/tsconfig.json, which includes only src/.
      'adversarial/test/**',
      // A local smoke test against the built package, owned by no tsconfig and
      // run by hand. Linting it would mean pulling dist/ into a project.
      'temp-test.ts',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        // Named projects rather than `projectService`, which discovers files by
        // looking for the nearest `tsconfig.json` — and the one spanning src
        // *and* test here is called tsconfig.test.json, so it would never be
        // found. The type-aware rules refuse to run on a file no project owns.
        project: ['./tsconfig.test.json', './adversarial/tsconfig.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // The library ships types; an exported function without them is a bug that
      // reaches consumers rather than a style question.
      '@typescript-eslint/explicit-module-boundary-types': 'error',

      // `any` is how a typed filter quietly stops being typed. The AI providers
      // genuinely need it at the SDK boundary, so it warns rather than errors.
      '@typescript-eslint/no-explicit-any': 'warn',

      // An unused parameter named `_` is a deliberate hole in a signature; an
      // unused variable is a leftover.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],

      // A floating promise in a moderation path is a request that finishes
      // before its own check does.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',

      // Off, and not as a matter of taste: `new Error(msg, { cause })` is
      // ES2022, and this package compiles to ES2020 because its engine floor is
      // Unicode property escapes, not error causes. Turning the rule on would
      // mean raising the floor past Node 16 for a debugging convenience.
      'preserve-caught-error': 'off',

      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },

  {
    // The CLI and the build script are programs whose whole job is to print.
    files: ['src/cli.ts', 'scripts/**/*.mjs', 'adversarial/src/cli.ts', 'examples/**/*.mjs'],
    rules: { 'no-console': 'off' },
  },

  {
    // Tests assert against shapes the compiler cannot see through `dist/`.
    files: ['test/**/*.ts', 'adversarial/test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      // `test()` from node:test returns a promise that the runner owns. Not
      // awaiting it is the documented usage, not a floating promise.
      '@typescript-eslint/no-floating-promises': 'off',
    },
  },

  {
    // Plain JavaScript: no type-aware rules to apply, and the Node globals have
    // to be declared because nothing else here does it. Listed by hand rather
    // than pulling in the `globals` package for five names.
    files: ['**/*.mjs', '**/*.js'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
        fetch: 'readonly',
        setInterval: 'readonly',
        setTimeout: 'readonly',
      },
    },
  },
);
