import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'coverage', 'node_modules']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommendedTypeChecked,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
      prettier,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Permite handlers async en eventos del DOM y props (patrón estándar con React
      // Hook Form / mutaciones). Se mantiene el chequeo en condicionales.
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: false }],
      // Co-locar un componente de formulario con sus helpers puros de transformación es
      // intencional; solo afecta a HMR, no a correcness ni a producción.
      'react-refresh/only-export-components': 'warn',
      // Este gateway también se despliega sobre HTTP plano en red interna, donde
      // `window.isSecureContext` es `false` y las APIs restringidas a contexto seguro
      // simplemente no existen. TypeScript las tipa como presentes, así que el error solo
      // aparece en producción: un `TypeError` que mata el manejador entero y deja el botón
      // «sin hacer nada», sin toast ni rastro. El linter es el único sitio donde se puede
      // atajar antes de que pase.
      'no-restricted-properties': [
        'error',
        {
          object: 'crypto',
          property: 'randomUUID',
          message:
            'crypto.randomUUID solo existe en contextos seguros (HTTPS o localhost) y este gateway también se sirve sobre HTTP plano. Usá randomUuid() de @/lib/utils.',
        },
        {
          object: 'crypto',
          property: 'subtle',
          message:
            'crypto.subtle solo existe en contextos seguros (HTTPS o localhost) y este gateway también se sirve sobre HTTP plano. El cifrado es responsabilidad del backend.',
        },
      ],
    },
  },
  // `randomUuid()` es justamente quien encapsula el respaldo: es el único sitio donde
  // `crypto.randomUUID` puede nombrarse, y lo hace detrás de un `typeof`.
  {
    files: ['src/lib/utils/uuid.ts'],
    rules: {
      'no-restricted-properties': 'off',
    },
  },
  // Test files: relax fast-refresh constraint and add test globals.
  {
    files: ['src/**/*.{test,spec}.{ts,tsx}', 'src/test/**/*.{ts,tsx}'],
    rules: {
      'react-refresh/only-export-components': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  // Vite / tooling config runs in Node and is not type-checked by the app project.
  {
    files: ['*.{ts,js}', 'vite.config.ts'],
    languageOptions: {
      globals: globals.node,
    },
    extends: [tseslint.configs.disableTypeChecked],
  },
])
