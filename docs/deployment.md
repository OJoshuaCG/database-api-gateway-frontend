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

### Docker (multi-stage, ejemplo)

```dockerfile
# build
FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable
COPY pnpm-lock.yaml package.json ./
RUN pnpm install --frozen-lockfile
COPY . .
ARG VITE_API_BASE_URL
ARG VITE_HEALTH_URL
RUN pnpm build

# runtime
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

> Estos snippets son una **referencia lista para copiar**; los archivos
> (`Dockerfile`, `nginx.conf`) no están versionados todavía — créalos cuando se decida
> la plataforma de despliegue.

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
- [ ] **Validado contra el backend real** (hoy solo con mocks MSW). Confirmar shapes
      ambiguos: paginación de `/{id}/databases` y forma exacta de `detail` de error.
- [ ] **Fallback SPA** configurado en el servidor (nginx/Caddy) — ver arriba.
- [ ] **HTTPS** en el frontend (requisito de la cookie `Secure`).
- [ ] **CI** que corra typecheck/lint/test/build.
- [ ] **Observabilidad**: integrar un reporter de errores (p. ej. Sentry) en vez de solo
      `console.error`.
- [ ] **Cabeceras de seguridad / CSP** en la capa de servido.
- [ ] **Auditoría de accesibilidad** con axe/Lighthouse (los contrastes se eligieron por
      cálculo; falta certificarlos en ejecución).
- [ ] Ampliar **cobertura de tests** (formularios con provisión, Combobox, introspección,
      mutaciones).
