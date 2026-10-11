// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Lint configuration.
 *
 * The rule set is deliberately `recommendedTypeChecked` and not
 * `strictTypeChecked`. Turning on the stricter preset produced 147 errors across
 * this repository and almost none of them described a defect: `restrict-template-expressions`
 * objects to `\`port ${n}\``, `no-confusing-void-expression` to
 * `onReady?.(port)`, `no-unnecessary-condition` to a defensive check that is not
 * unnecessary in the version of the type a caller sees. A lint run that fails on
 * every file teaches the team to ignore it, so the preset is the one that
 * reports things worth reading, and the rules that describe properties this
 * project actually depends on are named explicitly below.
 *
 * The trade-off is real and worth stating: this configuration will not catch a
 * `number` interpolated into a URL. It will catch a floating promise, an `any`,
 * and an `eval`.
 */
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/out/**',
      '**/.data*/**',
      // Next's build output. Without this, `next build` puts several hundred
      // generated files in front of ESLint and every one of them is a
      // parse-or-unsafe-access error that describes the code Next emitted.
      '**/.next/**',
      'apps/character-lab/public/**',
      // The plain-HTML and WordPress fixtures' own browser scripts -- the
      // WordPress page's "plugin", which is an IIFE with `var` and a `window`
      // global because that is what a plugin looks like. They belong to no
      // tsconfig project, so leaving them in reports a parse failure that says
      // nothing about them, and rewriting them as TypeScript would make the
      // fixture less like the thing it exists to imitate.
      'apps/widget-demo/public/**/*.js',
      // The React fixture's bundle, built next to the page that loads it. It is
      // gitignored, so this only matters for a developer who has just built it;
      // without the ignore, `npm run lint` fails on a generated file.
      'apps/widget-demo-react/public/**',
      // The same bundle, copied in for the Next fixture and the marketing site.
      // Listed per app because each is a separate origin the widget is served
      // from, and a new host means a new entry rather than a broad ignore.
      'apps/widget-demo-next/public/**',
      'apps/marketing/public/**',
      'packages/widget/dist/**',
      '**/*.d.ts',
      // Linting the lint config itself buys nothing, and the file belongs to no
      // tsconfig project, so the project service reports it as a parse failure.
      'eslint.config.js',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
        fetch: 'readonly',
        // The two the build scripts reach for: the emulator runner polls with
        // `setTimeout` and gives each readiness probe its own deadline with
        // `AbortSignal.timeout`. Listed the same way `fetch` is -- a host global
        // the scripts may use without importing anything.
        setTimeout: 'readonly',
        AbortSignal: 'readonly',
      },
      parserOptions: {
        // Root-level config files are real TypeScript and belong to no workspace,
        // so `tsconfig.json` names them explicitly. That is load-bearing rather
        // than tidiness: without a project the service types every import as
        // `any`, and `playwright.config.ts` reported seven "unsafe member access"
        // errors that described the missing project rather than the file. Being
        // in the project also means `tsc --noEmit` checks them like everything
        // else.
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // The assistant's contract is that model output is data and never
      // behaviour. These three are the lint-level expression of it.
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',

      // `any` erases exactly the guarantees the strict tsconfig spends effort
      // establishing.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',

      // A promise nobody awaits is how a failed persistence quietly becomes a
      // successful-looking turn.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',

      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],

      // The style rules worth having are the ones that change how a diff reads.
      'prefer-const': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',

      // `console.log` is how a debug statement survives into production; `warn`
      // and `error` are how a library tells an integrator that something is
      // wrong with their configuration. The widget's boot path uses the latter
      // deliberately -- a customer who pastes a malformed snippet into their own
      // page needs to be told why nothing appeared, and the browser console is
      // the only channel that reaches them.
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },

  // The `.mjs` build and smoke scripts belong to no tsconfig project, so every
  // value in them types as `any` and the type-aware rules report hundreds of
  // "unsafe" accesses that describe the absence of a project rather than a
  // defect. They keep the non-type-aware rules and lose only the type-aware
  // ones -- an `eval` or a `no-var` is still caught there.
  {
    files: ['**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
  },

  // Scripts, demo servers and the process entry point are command-line
  // programs: printing to the terminal is their entire interface.
  {
    files: [
      'scripts/**/*.ts',
      'scripts/**/*.mjs',
      '**/scripts/**/*.mjs',
      '**/scripts/**/*.ts',
      '**/serve.ts',
      'apps/api/src/main.ts',
    ],
    rules: { 'no-console': 'off' },
  },

  // Tests reach into fixtures and assert on shapes the production types work to
  // keep narrow. The rules that fight that are about the test's own ergonomics,
  // so they are relaxed here rather than in the source.
  {
    files: ['**/test/**/*.ts', 'apps/*/test/**/*.ts', 'tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      'no-console': 'off',
    },
  },

  // The tool registry is a set of async implementations of an async interface.
  // Several are honest stubs -- `retrieve_knowledge` and its neighbours return
  // "not implemented" rather than pretending -- and a stub of an async method
  // has nothing to await. The rule is about accidental synchronicity, which this
  // is not, so it is switched off for the one file where the shape is the point
  // rather than the behaviour.
  {
    files: ['apps/api/src/agent/tools.ts'],
    rules: { '@typescript-eslint/require-await': 'off' },
  },
);
