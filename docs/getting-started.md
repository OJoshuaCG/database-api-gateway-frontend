# Puesta en marcha

Cómo levantar el frontend en desarrollo. Para el panorama, ver
[`architecture.md`](architecture.md).

## Requisitos

- **Node.js ≥ 20.19** (probado con 24.x).
- **pnpm** (gestor de paquetes del proyecto). Actívalo con `corepack enable` o instálalo
  globalmente.
- Un **backend en ejecución** (ver [`../../backend/docs/getting-started.md`](../../backend/docs/getting-started.md)).
- Navegadores modernos: **Chrome ≥ 111, Safari ≥ 16.4, Firefox ≥ 128** (requisito de
  Tailwind CSS v4 — ver [ADR-0004](adr/0004-theming-tailwind-v4.md)).

## Instalación

```bash
cd frontend
pnpm install
cp .env.example .env
pnpm dev            # http://localhost:5173
```

Inicia sesión con las credenciales de administrador sembradas por el backend
(`ADMIN_USERNAME` / `ADMIN_PASSWORD`).

## Variables de entorno

Se incrustan en el bundle **en tiempo de build** (no se leen en runtime).

| Variable | Requerida | Descripción |
|---|---|---|
| `VITE_API_BASE_URL` | Sí | Base de la API versionada, **incluye `/api/v1`**. Ej. `http://localhost:8000/api/v1`. El cliente falla en arranque si falta. |
| `VITE_HEALTH_URL` | No | URL del health check (`/health`, fuera de `/api/v1`). Alimenta el `HealthBadge`; si no se define o CORS lo bloquea, el badge se oculta. |

Archivos de entorno (convención de Vite): `.env` (local, no versionar),
`.env.example` (plantilla), `.env.development` (dev), `.env.test` (tests). Solo las
variables con prefijo `VITE_` se exponen al cliente.

## Scripts

| Script | Acción |
|---|---|
| `pnpm dev` | Servidor de desarrollo con HMR. |
| `pnpm build` | `tsc -b` + `vite build` → `dist/`. |
| `pnpm preview` | Sirve el build de producción localmente. |
| `pnpm typecheck` | `tsc` sin emitir. |
| `pnpm lint` / `pnpm lint:fix` | ESLint (flat config) con type-checking. |
| `pnpm format` / `pnpm format:check` | Prettier. |
| `pnpm test` / `pnpm test:watch` / `pnpm test:coverage` | Vitest. |

Antes de un PR: `pnpm typecheck && pnpm lint && pnpm test && pnpm build` en verde.

## Solución de problemas

### "No carga nada" / errores de CORS en la consola

Causa #1 en local. El backend usa **cookie de sesión** y envía
`allow_credentials=True`; el navegador **rechaza** `Access-Control-Allow-Origin: *` junto
a credenciales. Solución: añade el origen exacto del frontend al `CORS_ORIGINS` del
backend:

```env
# backend/.env
CORS_ORIGINS=http://localhost:5173
```

### El login responde 401

Credenciales incorrectas, o el backend no sembró el admin (revisa `ADMIN_USERNAME` /
`ADMIN_PASSWORD` en el backend). El 401 del login se muestra en el formulario y **no**
dispara el flujo global de "sesión expirada".

### Recargar una ruta profunda (`/servers/42`) da 404

Solo en producción/preview con un servidor estático mal configurado: falta el **fallback
SPA**. En `pnpm dev` no ocurre (Vite ya lo hace). Ver [`deployment.md`](deployment.md).

### En consola: `[api] Respuesta no conforme al contrato`

El backend devolvió un shape que no cumple el schema Zod → hay que actualizar
`src/lib/contracts/`. Ver [`maintenance.md`](maintenance.md).

### `node` / `pnpm` no encontrados

Actívalos con tu gestor de versiones (p. ej. `nvm use`) o `corepack enable`.
