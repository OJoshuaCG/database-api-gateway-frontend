# Testing

Stack: **Vitest** + **React Testing Library** + **MSW** (mock del backend a nivel de red).
Los tests viven junto al código (`*.test.ts` / `*.test.tsx`).

```bash
pnpm test            # corre toda la suite una vez
pnpm test:watch      # modo watch
pnpm test:coverage   # con cobertura (v8)
```

## Configuración

- **Vitest** se configura en `vite.config.ts` (bloque `test`): entorno `jsdom`,
  `globals: true`, `setupFiles: ['./src/test/setup.ts']`.
- **`src/test/setup.ts`**:
  - importa `@testing-library/jest-dom/vitest` (matchers como `toBeInTheDocument`),
  - arranca/limpia el servidor MSW (`beforeAll`/`afterEach`/`afterAll`),
  - **polyfill de `<dialog>`**: jsdom no implementa `showModal`/`close`, así que se simulan
    para poder testear `Modal`/`ConfirmDialog`.
- **`src/test/server.ts`**: `setupServer()` de MSW (sin handlers por defecto; cada test
  añade los suyos con `server.use(...)`).
- **`src/test/utils.tsx`**: `renderWithProviders` y `createTestQueryClient` (con `retry:
  false` para que los errores se propaguen al instante) — montan Theme + Query + Toast +
  Router.
- **`.env.test`**: define `VITE_API_BASE_URL=http://localhost/api/v1` (el cliente lo exige
  en arranque).

## Qué se prueba (y dónde)

| Test | Cubre |
|---|---|
| `src/lib/api/errors.test.ts` | Normalización de errores: `detail` como string y como objeto, `fieldErrors` de 422, fallbacks, 502/504. |
| `src/components/ui/ConfirmDialog.test.tsx` | Doble confirmación: el botón se habilita solo al teclear la palabra exacta. |
| `src/features/servers/hooks/use-servers.test.tsx` | Mapeo del envelope paginado y propagación de `ApiError` (con MSW). |
| `src/features/auth/components/ProtectedRoute.test.tsx` | Render autenticado vs. redirección a `/login` ante 401. |

Foco: **hooks de datos** y **componentes críticos** (auth, confirmaciones destructivas,
normalización de errores).

## Escribir un test

### Hook de datos (con MSW)

```tsx
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { createTestQueryClient } from '@/test/utils'

function wrapper({ children }) {
  return <QueryClientProvider client={createTestQueryClient()}>{children}</QueryClientProvider>
}

it('mapea el envelope', async () => {
  server.use(http.get('http://localhost/api/v1/servers', () =>
    HttpResponse.json({ data: [/* … */], pagination: { /* … */ } })))
  const { result } = renderHook(() => useServers({ page: 1, size: 20 }), { wrapper })
  await waitFor(() => expect(result.current.isSuccess).toBe(true))
})
```

### Componente que necesita providers/router

```tsx
import { renderWithProviders } from '@/test/utils'
renderWithProviders(<MiPagina />, { route: '/servers' })
```

## Buenas prácticas

- **Mockea a nivel de red con MSW**, no el cliente: así se ejercita toda la tubería
  (cliente → validación Zod → hook).
- Usa `createTestQueryClient()` (sin reintentos) para que los errores aparezcan ya.
- Las rutas en los handlers son **absolutas** (`http://localhost/api/v1/...`), igual que
  `VITE_API_BASE_URL` en `.env.test`.
- Prueba comportamiento observable (qué ve el usuario / qué expone el hook), no detalles
  de implementación.
- Si añades un endpoint, añade al menos un test del hook (mira `use-servers.test.tsx`).

## Pendiente de ampliar

Cobertura actual: representativa, no exhaustiva. Faltan tests de los formularios con
provisión, `Combobox`/`MultiCombobox`, el flujo de introspección y más mutaciones
(ver checklist en [`deployment.md`](deployment.md)).
