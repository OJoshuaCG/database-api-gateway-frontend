# Arquitectura del frontend

> Rutas relativas a `frontend/`. Para el *porqué* de cada decisión, ver [`adr/`](adr/).

## Visión general

El frontend es una **SPA** que consume la API del gateway. No tiene backend propio ni
estado de servidor persistente: todo el estado "de servidor" lo gestiona **TanStack
Query** (caché, refetch, invalidación) y todo el estado "de UI" es local a cada
componente o vive en contextos transversales (tema, toasts, sesión).

```
┌──────────────────────────────────────────────────────────────────┐
│ Navegador                                                          │
│                                                                    │
│  React (UI)  ──►  Custom hooks (TanStack Query)  ──►  Capa API     │
│      ▲                      │                            │         │
│      │  estados             │  caché / invalidación      │ fetch   │
│      │  loading/error/data  ▼                            ▼ (cookie)│
│  Componentes  ◄──  Normalización de errores (ApiError)  ◄──────────┼──► API /api/v1
│                                          ▲                          │   (FastAPI)
│                            validación runtime (Zod)                 │
└──────────────────────────────────────────────────────────────────┘
```

Regla de oro: **un componente nunca llama `fetch` directamente**. Siempre pasa por un
hook → servicio (`*.api.ts`) → cliente (`lib/api/client.ts`).

## Capas (de dentro hacia afuera)

| Capa | Carpeta | Responsabilidad | Depende de |
|---|---|---|---|
| **Contratos** | `src/lib/contracts/` | Schemas Zod + tipos `z.infer`. Fuente de verdad del shape de la API. | (nada) |
| **Cliente API** | `src/lib/api/` | `fetch` con cookie, validación del envelope, normalización de errores, config de React Query, query keys. | contracts |
| **Servicios** | `src/features/<f>/api/*.api.ts` | Una función por endpoint. Traduce parámetros → llamada del cliente. | client, contracts |
| **Hooks de datos** | `src/features/<f>/hooks/*` | Envuelven servicios en `useQuery`/`useMutation`. Caché, invalidación, toasts. | servicios, query-keys, toast |
| **Componentes de feature** | `src/features/<f>/components/*` | UI presentacional + formularios de la feature. | hooks, ui |
| **Páginas** | `src/features/<f>/pages/*` | Componen hooks + componentes en una vista/ruta. | hooks, componentes, ui |
| **UI reutilizable** | `src/components/ui/` | Primitivos sin lógica de negocio (Button, Input, DataTable, Modal…). | utils, theme |
| **Layout** | `src/components/layout/` | AppShell, Sidebar, Topbar, error boundaries. | ui, auth, health |
| **App** | `src/app/` | Providers y router raíz. | todo lo anterior |

La dirección de dependencias es **siempre hacia adentro** (páginas → hooks → servicios →
cliente → contratos). Los contratos no importan nada del resto.

## Mapa de carpetas

```
src/
├── app/
│   ├── providers.tsx        Composición de providers (ver "Árbol de providers")
│   ├── router.tsx           Definición de rutas (createBrowserRouter)
│   └── App.tsx              RouterProvider + ErrorBoundary raíz
├── main.tsx                 Punto de entrada (createRoot)
│
├── lib/
│   ├── api/
│   │   ├── client.ts        apiRequest + helpers (fetchData/fetchPage/fetchList/mutate*)
│   │   ├── errors.ts        ApiError + normalizeApiError (maneja ambas formas de `detail`)
│   │   ├── query-client.ts  createQueryClient (política de reintentos)
│   │   └── query-keys.ts    queryKeys (fábrica jerárquica de claves de caché)
│   ├── contracts/           Un archivo por entidad + common.ts (envelope, enums, paginación)
│   ├── theme/               ThemeProvider + useTheme (claro/oscuro)
│   ├── toast/               ToastProvider + useToast
│   └── utils/               cn (clases), formato de fechas
│
├── components/
│   ├── ui/                  Button, Input, Textarea, Checkbox, Switch, Badge, Card,
│   │                        Combobox, MultiCombobox, DataTable, Pagination, Modal,
│   │                        ConfirmDialog, EmptyState, ErrorState, PageHeader, Spinner
│   ├── layout/              AppShell, Sidebar, Topbar, ThemeToggle, SectionErrorFallback
│   └── NotFoundPage.tsx
│
├── features/
│   ├── auth/                login, sesión, ProtectedRoute, SessionProvider
│   ├── servers/             CRUD + test-connection + introspección
│   ├── server-users/        CRUD + provision/drop_remote
│   ├── database-models/     CRUD de blueprints
│   ├── managed-databases/   CRUD + provision/drop_remote + reasignar owner
│   ├── privileges/          catálogo + toggle
│   └── health/              indicador de estado del backend
│
├── styles/
│   ├── theme.css            ÚNICA fuente de tokens de color (claro/oscuro)
│   └── index.css            @import tailwind + theme + capa base
└── test/                    setup (MSW + polyfill <dialog>), util de render, server MSW
```

Cada feature repite la misma estructura interna: `api/`, `hooks/`, `components/`,
`pages/`, `index.ts` (barrel que expone solo las páginas/piezas públicas).

## Árbol de providers

Definido en `src/app/providers.tsx`. El orden importa:

```
<ThemeProvider>                 aplica data-theme en <html>; no depende de nada
  <QueryClientProvider>         caché de React Query
    <ToastProvider>             notificaciones (necesita estar sobre las features)
      <SessionProvider>         registra el handler global de 401 (necesita QueryClient)
        <RouterProvider>        (en App.tsx, envuelto en ErrorBoundary raíz)
```

`SessionProvider` **debe** ir bajo `QueryClientProvider` porque usa `useQueryClient` para
invalidar la sesión ante un 401. Ver [`data-flow.md`](data-flow.md) escenario G.

## Relación con el backend

- **Base URL:** `VITE_API_BASE_URL` (incluye `/api/v1`). El `/health` vive aparte en
  `VITE_HEALTH_URL`.
- **Contrato:** el frontend modela a mano en `lib/contracts` lo documentado en
  `backend/docs/api-reference.md`. No hay generación automática (ver
  [ADR-0001](adr/0001-contrato-zod-manual.md)).
- **Auth:** cookie de sesión httpOnly emitida por el backend; el frontend solo envía
  `credentials: 'include'` (ver [ADR-0002](adr/0002-auth-cookie-sesion.md)).
- **Errores:** el backend responde `{ detail }` (string u objeto); el cliente lo
  normaliza a `ApiError` (ver `lib/api/errors.ts`).

## Convenciones transversales

- **Tipado estricto**, sin `any` salvo justificación por comentario.
- **Composición, no herencia:** sin class components; los error boundaries usan
  `react-error-boundary` (ver [ADR-0005](adr/0005-sin-class-components.md)).
- **Colores solo por tokens** (`bg-primary`, …); prohibido hex/rgb en JSX
  (ver [ADR-0004](adr/0004-theming-tailwind-v4.md)).
- **Errores y éxitos** se comunican con toasts; los fallos de carga con `ErrorState`;
  los vacíos con `EmptyState`.
