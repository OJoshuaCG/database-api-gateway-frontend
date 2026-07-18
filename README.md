# Database API Gateway — Frontend

SPA en **React + TypeScript** que consume la API del **Database API Gateway**
(`backend/`). Permite gestionar servidores de BD remotos, usuarios del motor, bases de
datos gestionadas, blueprints y el catálogo de privilegios desde una única interfaz.

> El contrato de la API está documentado en `../backend/docs/api-reference.md`. Este
> frontend nunca lee ni modifica el código del backend.

> 📚 **Documentación detallada en [`docs/`](docs/)**: arquitectura, flujos de datos,
> catálogo de componentes UI, theming, testing, mantenimiento, despliegue y ADRs. Esta
> guía es solo el inicio rápido.

---

## Requisitos

- **Node.js ≥ 20.19** (probado con 24.x)
- **pnpm** (gestor de paquetes del proyecto; `corepack enable` lo activa)
- Navegadores modernos: **Chrome ≥ 111, Safari ≥ 16.4, Firefox ≥ 128** (requisito de
  Tailwind CSS v4).

## Puesta en marcha

```bash
pnpm install
cp .env.example .env        # ajusta las URLs si tu backend no está en localhost:8000
pnpm dev                    # http://localhost:5173
```

> **CORS:** el backend usa cookies de sesión (`allow_credentials=True`), por lo que su
> `CORS_ORIGINS` **no puede ser `*`**. Añade el origen del frontend
> (`http://localhost:5173` en dev) a `CORS_ORIGINS` del backend, o las peticiones serán
> bloqueadas por el navegador.

## Variables de entorno

| Variable | Requerida | Descripción |
|---|---|---|
| `VITE_API_BASE_URL` | Sí | Base de la API versionada, incluye `/api/v1`. Ej. `http://localhost:8000/api/v1`. |
| `VITE_HEALTH_URL` | No | URL del health check (`/health`, fuera de `/api/v1`). Alimenta el indicador de estado; si no se define o CORS lo bloquea, el badge se oculta. |
| `VITE_MAX_PAGE_SIZE` | No | Tamaño máximo de página (`size`) que el frontend solicita a la API. **Debe coincidir con el límite del backend**: si se pide más, la API responde `422`. Se usa al poblar selects con la lista completa y acota las opciones del selector "por página". Fallback: `50`. |

Sin URLs hardcodeadas: el cliente falla rápido en arranque si falta `VITE_API_BASE_URL`.

## Scripts

| Script | Acción |
|---|---|
| `pnpm dev` | Servidor de desarrollo (Vite). |
| `pnpm build` | Type-check + build de producción. |
| `pnpm preview` | Sirve el build de producción. |
| `pnpm lint` / `pnpm lint:fix` | ESLint (flat config) con type-checking. |
| `pnpm format` / `pnpm format:check` | Prettier. |
| `pnpm typecheck` | `tsc` sin emitir. |
| `pnpm test` / `pnpm test:watch` / `pnpm test:coverage` | Vitest + Testing Library. |

---

## Stack

Vite · React 19 · TypeScript (strict) · TanStack Query · TanStack Table · React Router ·
React Hook Form + Zod · Downshift · Tailwind CSS v4 · Vitest + React Testing Library +
MSW · ESLint + Prettier.

## Arquitectura

Organización **por features** (`src/features/<feature>/`), con capas transversales en
`src/lib` y `src/components`.

```
src/
  app/            Bootstrap: providers, router raíz
  lib/
    api/          Cliente fetch tipado, normalización de errores, React Query, query keys
    contracts/    Schemas Zod + tipos (z.infer) — fuente de verdad del contrato
    theme/        Provider de tema claro/oscuro
    toast/        Sistema de notificaciones
    utils/        Helpers (cn, formato de fechas)
  components/
    ui/           Primitivos reutilizables (Button, Input, Combobox, DataTable, Modal…)
    layout/       AppShell, Sidebar, Topbar, error boundaries por sección
  features/
    auth/         Login, sesión, ProtectedRoute
    servers/      CRUD + test-connection + introspección (drill-down)
    server-users/ CRUD + provision/drop_remote
    database-models/  CRUD de blueprints
    managed-databases/ CRUD + provision/drop_remote + reasignar owner
    schema-comparisons/ Asistente: diff de esquema entre dos BDs
    database-clones/    Asistente: clonar una BD a otro servidor (asíncrono, con polling)
    privileges/   Catálogo + toggle
    permission-profiles/ CRUD de perfiles de permisos por motor
    admin/        Rotación de cifrado (DEK)
    health/       Indicador de estado del backend
  styles/         theme.css (tokens) + index.css
  test/           setup, util de render, servidor MSW
```

**Composición, no herencia:** no hay class components. La lógica de negocio vive en custom
hooks y en la capa de servicios (`api/`), fuera de los componentes de UI. Los error
boundaries usan `react-error-boundary` (API funcional).

### Decisiones de arquitectura

- **Tipado del contrato — Zod manual.** El backend solo expone OpenAPI si
  `DOCS_ENABLED=true` y no es accesible de forma fiable, así que se modelan los schemas a
  mano en `lib/contracts` desde `api-reference.md`. Zod es la **única fuente de verdad**:
  los tipos se infieren con `z.infer` y los mismos schemas **validan en runtime** la
  respuesta (envelope `ApiResponse[T]`), detectando desincronizaciones con el backend.
- **Autenticación por cookie de sesión httpOnly.** El backend emite una cookie firmada;
  el frontend **no almacena ningún token** (la cookie es invisible a JS, lo que mitiga
  XSS). Todas las peticiones usan `credentials: 'include'`. Un `401` en cualquier endpoint
  dispara un handler global que invalida la sesión y `ProtectedRoute` redirige a `/login`.
  El login usa `suppressAuthHandler` para que un `401` (credenciales inválidas) no se trate
  como expiración de sesión.
- **Sin streaming.** La API no expone SSE/WebSocket. Las operaciones que tocan el motor
  destino (marcadas 🔌: `test-connection`, aprovisionamiento, introspección) son
  request/response normales que pueden tardar y devolver `502`/`504`; se manejan como
  queries/mutations con estados de carga y mensajes de error específicos.
- **Server state con TanStack Query.** Nada de `fetch` suelto en `useEffect`. Caché,
  estados loading/error, invalidación e introspección como queries dependientes.
- **Tablas.** Paginación y filtros **server-side** (los query params que soporta la API:
  `page`/`size`, `server_id`, `owner_id`, `model_id`, `status`, `engine`, `active`). El
  **ordenamiento y la búsqueda global son client-side** sobre la página cargada, porque la
  API no los expone server-side. El catálogo de privilegios (no paginado) usa paginación
  client-side completa.
- **Manejo de errores transversal.** Todos los errores se normalizan a `ApiError`
  (`lib/api/errors.ts`), soportando las dos formas de `detail` del backend
  (`string` y `{ msg, type, context }`). Toasts para éxito/error y error boundaries por
  sección.

### Theming

Todos los colores son **variables CSS semánticas** definidas en un único archivo,
`src/styles/theme.css`, y expuestas a Tailwind v4 con `@theme inline`. Cambiar un color
del sitio = editar **una** variable. El tema oscuro redefine las mismas variables bajo
`[data-theme='dark']`; el toggle es persistente y respeta `prefers-color-scheme`.
**Prohibido** hardcodear colores en los componentes: siempre se usan utilidades de token
(`bg-primary`, `text-accent`, …).

### Accesibilidad

Controles interactivos con contraste **WCAG AA** y foco siempre visible. El tratamiento
claymorphism se reserva a superficies (cards), nunca a controles (no rompe la
legibilidad). Diálogos accesibles (`<dialog>` nativo), selects accesibles (Downshift) y
tablas con `aria-sort`.

## Tests

- `lib/api/errors` — normalización de errores (ambas formas de `detail`, 422, fallbacks).
- `components/ui/ConfirmDialog` — doble confirmación (escribir el nombre exacto).
- `features/servers/hooks/use-servers` — mapeo del envelope paginado y propagación de
  errores (con MSW).
- `features/auth/ProtectedRoute` — render autenticado vs. redirección a login en `401`.

```bash
pnpm test
```
