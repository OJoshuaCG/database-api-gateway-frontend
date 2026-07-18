# Despliegue del frontend

El frontend compila a **archivos estáticos** (`dist/`) que se sirven desde cualquier CDN
o servidor web. No tiene runtime de servidor propio. Rutas relativas a `frontend/`.

## Build

```bash
cd frontend
pnpm install --frozen-lockfile
pnpm build            # tsc -b && vite build  →  genera dist/
```

Las variables `VITE_*` se **incrustan en el bundle en tiempo de build** (no se leen en
runtime). Define `VITE_API_BASE_URL` (y opcionalmente `VITE_HEALTH_URL`) antes de
`pnpm build`, por ejemplo:

```bash
VITE_API_BASE_URL=https://gateway.example.com/api/v1 \
VITE_HEALTH_URL=https://gateway.example.com/health \
pnpm build
```

> Consecuencia: un mismo `dist/` está atado a una API concreta. Para promover el mismo
> artefacto entre entornos, hay que rebuild por entorno **o** servir `VITE_API_BASE_URL`
> como ruta relativa (`/api/v1`) y poner frontend y backend tras el mismo dominio/proxy.

## Servir el SPA — fallback de rutas (IMPRESCINDIBLE)

La app usa `BrowserRouter` (rutas como `/servers/42`). El servidor estático **debe
reescribir cualquier ruta desconocida a `index.html`**; si no, recargar una ruta profunda
da **404**.

### nginx (ejemplo)

```nginx
server {
  listen 80;
  root /usr/share/nginx/html;
  index index.html;

  location / {
    try_files $uri $uri/ /index.html;   # <-- fallback SPA
  }

  # Activos con hash → caché larga; index.html sin caché.
  location /assets/ {
    expires 1y;
    add_header Cache-Control "public, immutable";
  }
}
```

### Docker

`Dockerfile` y `nginx.conf` ya están versionados en la raíz del repo (multi-stage:
build con `node:24-alpine` + runtime `nginx:alpine`, con fallback SPA y cabeceras de
seguridad incluidos). Para la configuración específica de la plataforma de despliegue
(Dokploy: build args, dominio, HTTPS), ver [`dokploy.md`](dokploy.md).

## CORS y cookies (lo más fácil de olvidar)

El backend autentica con **cookie de sesión httpOnly** y envía `allow_credentials=True`.
Implicaciones:

- `CORS_ORIGINS` del backend **debe listar el origen exacto del frontend** (no `*`).
- En producción la cookie es `Secure` (`https_only` cuando `APP_ENV=production`): el
  frontend debe servirse por **HTTPS**.
- `same_site=lax`: si frontend y backend están en **dominios distintos**, valida que el
  flujo de cookies funcione; lo más simple es ponerlos **bajo el mismo dominio** (p. ej.
  `app.example.com` y `app.example.com/api`) vía proxy inverso, evitando problemas de
  third-party cookies.

## CI (referencia)

Workflow mínimo sugerido (`.github/workflows/frontend.yml`, no creado aún):

```yaml
name: frontend
on:
  push: { paths: ['frontend/**'] }
  pull_request: { paths: ['frontend/**'] }
jobs:
  check:
    runs-on: ubuntu-latest
    defaults: { run: { working-directory: frontend } }
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: pnpm, cache-dependency-path: frontend/pnpm-lock.yaml }
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm lint
      - run: pnpm test
      - run: pnpm build
```

## Checklist de endurecimiento para producción

Estado actual y lo que falta para "producción verificada" (no solo "código de
producción"):

- [x] Build, typecheck, lint y tests en verde.
- [x] Variables de entorno (sin URLs hardcodeadas).
- [x] Manejo de errores transversal + estados loading/empty/error.
- [x] **Fallback SPA** configurado en el servidor — ver `nginx.conf` (raíz del repo).
- [x] **Cabeceras de seguridad / CSP** en la capa de servido — ver `nginx.conf`.
- [ ] **Decisión de dominio** (mismo dominio vs. subdominios para frontend/backend) —
      ver [`dokploy.md`](dokploy.md#3-dominio--decisión-pendiente-dos-escenarios).
- [ ] **Validado contra el backend real** (hoy solo con mocks MSW). Confirmar shapes
      ambiguos: paginación de `/{id}/databases` y forma exacta de `detail` de error.
- [ ] **HTTPS** en el frontend (requisito de la cookie `Secure`) — activar el
      certificado gestionado de la plataforma una vez decidido el dominio.
- [ ] **CI** que corra typecheck/lint/test/build.
- [ ] **Observabilidad**: integrar un reporter de errores (p. ej. Sentry) en vez de solo
      `console.error`.
- [ ] **Auditoría de accesibilidad** con axe/Lighthouse (los contrastes se eligieron por
      cálculo; falta certificarlos en ejecución).
- [ ] Ampliar **cobertura de tests** (formularios con provisión, Combobox, introspección,
      mutaciones).
