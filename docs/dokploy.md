# Despliegue en Dokploy

Guía específica para desplegar este frontend en [Dokploy](https://dokploy.com/).
Complementa [`deployment.md`](deployment.md) (conceptos generales de build/servido) y
[`security.md`](security.md) (por qué importa el dominio/HTTPS). Este documento asume
que el backend (Database API Gateway) vive en la **misma instancia de Dokploy pero
como una aplicación independiente** (despliegue propio, no un mismo compose).

## 1. Tipo de aplicación

Crear la app en Dokploy como **"Application" con build type `Dockerfile`**, apuntando
a este repo — usa el `Dockerfile`, `nginx.conf.template` y `upstream-headers.inc` ya
versionados en la raíz.

No usar el build type `Nixpacks`/"static site" de Dokploy: perderías el control fino
sobre el fallback de rutas del SPA y las cabeceras de seguridad que sí provee
`nginx.conf.template` (ver [`deployment.md`](deployment.md#servir-el-spa--fallback-de-rutas-imprescindible)).

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

## 3. Dominio — DECIDIDO: mismo origen vía el proxy de este contenedor

> **Decidido el 2026-09-11**, después de que un despliegue con subdominios separados
> rompiera el 100% de las escrituras con `403 auth.csrf_missing`. Lo que sigue ya no es
> un escenario a elegir: es cómo se despliega esto.

### Por qué no es una preferencia

El backend emite la cookie de CSRF **sin atributo `Domain`**
(`app/middleware/CsrfCookieMiddleware.py`), o sea *host-only*. No es un descuido: el
prefijo `__Host-` lo **prohíbe**, y ese prefijo es la mitad de la defensa contra *cookie
tossing* que documenta `app/core/csrf.py` (la otra mitad es que el token se recomputa como
`HMAC(SESSION_SECRET, sid)` en cada request).

Consecuencia directa: **una SPA servida en otro host no puede leer esa cookie**. El
`document.cookie` de `src/lib/api/csrf.ts` no la ve, `src/lib/api/client.ts` manda el
request sin el header `X-CSRF-Token`, y `app/core/csrf.py` responde `403` con
`public_context.code = "auth.csrf_missing"`. Falla **toda** escritura de una sesión
autenticada, con cualquier endpoint. No hay arreglo posible del lado del cliente: es una
regla del navegador, no una opción de configuración.

### Cómo queda

- **Un solo dominio**, el del frontend (p. ej. `app.dominio.com`). El backend **no**
  necesita dominio público propio.
- El contenedor del frontend proxea al backend por la red interna de Dokploy:
  `/api/`, `/mcp` y `/health` (ver `nginx.conf.template`).
- `VITE_API_BASE_URL=/api/v1` y `VITE_HEALTH_URL=/health` — **rutas relativas**. El mismo
  build sirve para cualquier entorno.
- El backend **igual** tiene que listar el origen público del frontend en `CORS_ORIGINS`:
  el navegador manda `Origin` incluso same-origin en los `POST`, y el guard de CSRF lo
  valida antes que el token (`auth.origin_rejected` si no está en la lista).

### Variables de entorno de RUNTIME del contenedor del frontend

Estas **no** son build args — se leen al arrancar el contenedor, así que mover el backend
no obliga a reconstruir la imagen.

| Variable | Default | Notas |
|---|---|---|
| `API_UPSTREAM` | `http://gateway-api:8000` | Esquema + host + puerto del backend en la red interna, **sin barra final ni path**. El host es el nombre del servicio del backend en Dokploy. |
| `API_RESOLVER` | `127.0.0.11` | DNS embebido de Docker en redes definidas por el usuario. |

⚠️ **El upstream se resuelve por request, no al arrancar.** `nginx.conf.template` lo mete
en una variable (`set $upstream …; proxy_pass $upstream$request_uri;`) a propósito: con un
`proxy_pass` literal, nginx resuelve el DNS **una sola vez al arrancar** y aborta con
`host not found in upstream` si el backend todavía no levantó. Como el orden de arranque
entre apps de Dokploy no está garantizado, eso dejaría la SPA entera caída por un backend
que tardó un segundo de más. Con la variable, nginx arranca igual y lo único que falla
mientras tanto son las llamadas a la API.

### El MCP no se ve afectado por el CSRF, pero sí por el ruteo

El servidor MCP autentica con `Authorization: Bearer dbgw.<id>.<secreto>`, que produce un
actor `api_token`. El guard de CSRF corre **solo** para `actor.kind == "admin"`
(`app/core/authz.py`), así que el MCP nunca pasa por ahí y la cookie le es indiferente.

Lo que sí importa: el MCP **no cuelga de `/api/v1`**, se monta aparte en `/mcp` sobre la
app principal. Por eso `nginx.conf.template` lo proxea explícitamente. Si en el futuro se
enruta esto de otra forma, `/mcp` y `/health` hay que acordarse de incluirlos.

### Alternativa descartada: subdominios separados

`app.dominio.com` + `api.dominio.com` es lo que rompió. Para que funcionara habría que
añadir un `Domain=` a la cookie de CSRF en el backend, lo que obliga a **renunciar al
prefijo `__Host-`** y deja la defensa contra tossing en una sola capa. Se descartó: el
proxy no cuesta nada y no negocia seguridad.

## 4. HTTPS

La cookie de sesión del backend es `Secure` en producción (`https_only`): el frontend
**debe** servirse por HTTPS. En Dokploy, activa el certificado gestionado
(Let's Encrypt) en la configuración de dominio de la app — sin esto, el login no
persistirá sesión en producción aunque todo lo demás esté bien configurado.

## 5. Health check

El contenedor sirve un SPA estático: `/` siempre responde `200` (vía el fallback de
`nginx.conf.template`), así que sirve como path de health check de Dokploy sin configuración
adicional.

## 6. Pasos resumidos

1. Crear la app en Dokploy, build type `Dockerfile`, conectar el repo.
2. Definir `VITE_API_BASE_URL=/api/v1` (y opcionalmente `VITE_HEALTH_URL=/health`,
   `VITE_MAX_PAGE_SIZE`) como **Build Args** — relativos, ver §3.
3. Definir `API_UPSTREAM` como **variable de entorno de runtime**, apuntando al servicio
   del backend en la red interna (p. ej. `http://gateway-api:8000`).
4. Configurar el dominio de la app y activar HTTPS gestionado. El backend no necesita
   dominio público propio.
5. Confirmar en el backend que `CORS_ORIGINS` lista el origen **exacto** del frontend
   (con esquema, sin barra final). Sin eso, las escrituras fallan con
   `auth.origin_rejected` en vez de `auth.csrf_missing`.
6. Deploy y validar manualmente:
   - El login carga (pantalla en blanco + error en consola = bundle roto, no red).
   - El login persiste sesión.
   - **Una escritura cualquiera funciona** — es lo que prueba que el CSRF quedó bien.
   - Recargar una ruta profunda (p. ej. `/servers/42`) no da 404.
   - No hay errores de CORS/cookies en consola.

## Pendiente (fuera del alcance de este documento)

- Decisión final de dominio (§3) y su reflejo en `CORS_ORIGINS` del backend.
- Validación contra el backend real desplegado (hoy el frontend solo se probó contra
  mocks MSW) — ver checklist en [`deployment.md`](deployment.md).
- CI que corra typecheck/lint/test/build antes de cada deploy (no existe aún).
- Observabilidad (reporter de errores tipo Sentry) y auditoría de accesibilidad.
