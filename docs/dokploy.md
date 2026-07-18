# Despliegue en Dokploy

Guía específica para desplegar este frontend en [Dokploy](https://dokploy.com/).
Complementa [`deployment.md`](deployment.md) (conceptos generales de build/servido) y
[`security.md`](security.md) (por qué importa el dominio/HTTPS). Este documento asume
que el backend (Database API Gateway) vive en la **misma instancia de Dokploy pero
como una aplicación independiente** (despliegue propio, no un mismo compose).

## 1. Tipo de aplicación

Crear la app en Dokploy como **"Application" con build type `Dockerfile`**, apuntando
a este repo — usa el `Dockerfile` y `nginx.conf` ya versionados en la raíz.

No usar el build type `Nixpacks`/"static site" de Dokploy: perderías el control fino
sobre el fallback de rutas del SPA y las cabeceras de seguridad que sí provee
`nginx.conf` (ver [`deployment.md`](deployment.md#servir-el-spa--fallback-de-rutas-imprescindible)).

## 2. Variables de entorno = Build Args, no runtime

Vite incrusta las variables `VITE_*` **en el bundle en tiempo de build**; el contenedor
final (`nginx:alpine`) no ejecuta Node ni lee `process.env` en runtime. Por eso, en el
panel de Dokploy estas variables deben definirse como **argumentos de build** (sección
de "Build Args" de la app en Dokploy — verifica el nombre exacto según tu versión),
**no** como "Environment Variables" de runtime del contenedor:

| Variable | Requerida | Notas |
|---|---|---|
| `VITE_API_BASE_URL` | Sí | Debe incluir `/api/v1`. Si frontend y backend comparten dominio (§3), usar ruta relativa: `/api/v1`. |
| `VITE_HEALTH_URL` | No | Idem: relativa (`/health`) si comparten dominio. |
| `VITE_MAX_PAGE_SIZE` | No | Debe coincidir con el `size` máximo que admite el backend. |

Si se configuran como env vars de runtime en vez de build args, el bundle servido
seguirá apuntando a lo que sea que tenía en build time (o quedará vacío/roto) — es el
error más fácil de cometer en este paso.

## 3. Dominio — decisión pendiente, dos escenarios

`security.md` (§7) recomienda que frontend y backend estén bajo el **mismo dominio**
porque la cookie de sesión es `same_site=lax`. Como backend y frontend son
despliegues independientes en Dokploy, "mismo dominio" no es automático: hay que
enrutarlo explícitamente vía el proxy (Traefik) que Dokploy gestiona por app.

### Opción A — mismo dominio con ruteo por path (recomendada)

- Frontend: dominio `app.dominio.com`, path `/`.
- Backend: mismo dominio `app.dominio.com`, path `/api` (y `/health` si aplica),
  configurado como dominio adicional de la app del backend en Dokploy.
- `VITE_API_BASE_URL=/api/v1` y `VITE_HEALTH_URL=/health` (rutas relativas: el mismo
  build sirve para cualquier entorno que comparta esta convención).
- Backend: `CORS_ORIGINS` puede incluso no ser crítico para same-origin, pero
  igual debe listar `https://app.dominio.com` explícitamente (no `*`).

### Opción B — subdominios separados

- Frontend: `app.dominio.com`. Backend: `api.dominio.com`.
- `VITE_API_BASE_URL=https://api.dominio.com/api/v1` (URL absoluta, como build arg).
- Backend: `CORS_ORIGINS` debe listar exactamente `https://app.dominio.com`.
- Validar en un entorno real que la cookie `same_site=lax` se envía correctamente
  entre subdominios antes de dar esto por bueno — es un supuesto, no un hecho
  verificado (ver checklist en [`deployment.md`](deployment.md)).

**Decisión pendiente:** este documento no elige entre A y B — queda para cuando se
defina el dominio real. Si no hay decisión, usar A por defecto (menor superficie de
problemas de cookies).

## 4. HTTPS

La cookie de sesión del backend es `Secure` en producción (`https_only`): el frontend
**debe** servirse por HTTPS. En Dokploy, activa el certificado gestionado
(Let's Encrypt) en la configuración de dominio de la app — sin esto, el login no
persistirá sesión en producción aunque todo lo demás esté bien configurado.

## 5. Health check

El contenedor sirve un SPA estático: `/` siempre responde `200` (vía el fallback de
`nginx.conf`), así que sirve como path de health check de Dokploy sin configuración
adicional.

## 6. Pasos resumidos

1. Crear la app en Dokploy, build type `Dockerfile`, conectar el repo.
2. Definir `VITE_API_BASE_URL` (y opcionalmente `VITE_HEALTH_URL`,
   `VITE_MAX_PAGE_SIZE`) como **Build Args** — valores relativos u absolutos según la
   opción de dominio elegida (§3).
3. Configurar el dominio de la app y activar HTTPS gestionado.
4. Si se eligió la Opción A, configurar el dominio adicional/path del backend para
   que responda bajo el mismo dominio.
5. Confirmar en el backend que `CORS_ORIGINS` lista el origen exacto del frontend.
6. Deploy y validar manualmente: login persiste sesión, recargar una ruta profunda
   (p. ej. `/servers/42`) no da 404, no hay errores de CORS/cookies en consola.

## Pendiente (fuera del alcance de este documento)

- Decisión final de dominio (§3) y su reflejo en `CORS_ORIGINS` del backend.
- Validación contra el backend real desplegado (hoy el frontend solo se probó contra
  mocks MSW) — ver checklist en [`deployment.md`](deployment.md).
- CI que corra typecheck/lint/test/build antes de cada deploy (no existe aún).
- Observabilidad (reporter de errores tipo Sentry) y auditoría de accesibilidad.
