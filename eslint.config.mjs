import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import prettier from 'eslint-config-prettier'

// Non-type-aware setup: no `parserOptions.project`, so linting never needs a
// full type-check pass. `npm run typecheck` remains the type gate.
export default tseslint.config(
  { ignores: ['out/**', 'dist/**', 'node_modules/**', 'resources/**'] },
  {
    files: ['src/**/*.{ts,tsx}', 'test/**/*.{ts,tsx}', '*.{ts,mts,mjs}'],
    extends: [tseslint.configs.recommended],
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      // Underscore-prefixed bindings are the repo's existing marker for
      // intentionally unused parameters and destructured placeholders.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_'
        }
      ]
    }
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}', 'test/renderer/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended]
  },
  prettier
)
