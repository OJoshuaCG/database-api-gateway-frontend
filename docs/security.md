# Seguridad del frontend

Modelo de seguridad del cliente. Principio rector: **el backend es la autoridad de
seguridad**; el frontend aplica defensa en profundidad pero **nunca** asume que su
validación reemplaza a la del backend. Rutas de código relativas a `frontend/`.

Relacionado: [ADR-0002 (auth por cookie)](adr/0002-auth-cookie-sesion.md),
[`getting-started.md`](getting-started.md) (CORS), [`deployment.md`](deployment.md)
(HTTPS/CSP).

## 1. Autenticación: cookie de sesión httpOnly (sin tokens en JS)

- El backend emite una **cookie de sesión httpOnly firmada** (`gw_session`,
  `same_site=lax`, `https_only` en producción). El frontend **no recibe, no lee y no
  almacena ningún token**: la cookie es invisible a JavaScript.
- Todas las peticiones usan `credentials: 'include'` (único punto: `src/lib/api/client.ts`),
  por lo que el navegador adjunta la cookie automáticamente.
- La sesión se modela como una query (`GET /auth/me`) en `useSession`; no hay estado de
  sesión duplicado en el cliente.

**Por qué httpOnly:** una cookie httpOnly no es accesible desde `document.cookie`, así que
un XSS no puede exfiltrarla — a diferencia de un token en `localStorage`. Es el motivo de
elegir este esquema en lugar de guardar JWT en el cliente.

### Manejo de 401

- Un `401` en **cualquier** endpoint dispara el handler global (`setUnauthorizedHandler`
  en `client.ts`, registrado por `SessionProvider`): invalida `auth/me` y `ProtectedRoute`
  redirige a `/login`.
- El **login** usa `suppressAuthHandler: true`: su `401` significa "credenciales
  inválidas", no "sesión expirada", y se muestra en el formulario sin desencadenar el
  flujo global.
- **Rutas protegidas:** todo lo que cuelga de `ProtectedRoute` exige sesión válida;
  sin ella, redirección a login preservando la ruta de retorno.

### La sesión ahora vence de verdad (v23 §7.3)

Antes la sesión no expiraba nunca mientras hubiera actividad. Ahora hay **dos relojes**, y el 401
dice cuál se cumplió en `public_context.code`:

| Código | Qué pasó |
|---|---|
| `auth.session_absolute` | **12 h desde el login, haya habido actividad o no** |
| `auth.session_idle` | 60 min sin requests |
| `auth.session_logout` | se cerró en otra pestaña |
| `auth.session_password_change` · `auth.session_role_change` · `auth.session_admin_revoked` | revocada |
| `auth.session_unknown` · `auth.session_missing` | no hay sesión: login normal |

**El absoluto es el que sorprende**, porque echa al usuario *mientras está trabajando*. Sin
explicación, eso se lee como un bug de la aplicación. Por eso el motivo **viaja hasta el login**:
el handler global lo guarda en `queryKeys.auth.sessionEndReason()` y `LoginPage` lo pinta como
`Callout`. El copy vive en `features/auth/messages.ts`; `unknown` y `missing` se mapean a `null` a
propósito, para no mostrarle «tu sesión terminó» a alguien que nunca entró.

`SessionsPanel` (pestaña «Mis sesiones» de Administración) lista las sesiones vivas y permite
cerrar las demás. `sid_prefix` es un **prefijo** y nunca el identificador completo: ese
identificador *es* la credencial de sesión.

## 1.b CSRF: header obligatorio en todo método no seguro **con sesión** (v23 §7.1)

El backend deja el token en una cookie **legible por JS a propósito** (`__Host-gw_csrf`, o
`gw_csrf` sin TLS) y exige que vuelva en el header `X-CSRF-Token`. Punto único:
`src/lib/api/csrf.ts` + `runRequest` en `client.ts`.

**No es double-submit.** El servidor lo **recomputa** a partir del identificador de sesión, así que
plantar la cookie desde JavaScript no sirve: ante `auth.csrf_invalid`, el arreglo **nunca** es
escribir la cookie.

Tres cosas que no son obvias y que la implementación respeta:

- **El alcance es «con sesión», no «todo método no seguro».** El chequeo vive dentro del guard de
  capacidades y solo corre para un actor de sesión, así que los dos `POST` públicos —`/auth/login`
  y `/gateway-users/invite/accept`— **no lo llevan** (pasan `csrf: false`). Ahí no hay sesión de la
  que derivar el token: no es que no haga falta, es que no puede existir.
- **`GET /database-exports/{id}/content` SÍ lo lleva**, aunque sea un GET (pasa `csrf: true`). Ese
  endpoint consume el artefacto y una navegación GET arrastra la cookie sola: sin el header,
  bastaba un `<img src=…>` en cualquier página ajena para destruirle la exportación a quien la
  abriera.
- **El token rota con la sesión**, porque se deriva de su identificador. Por eso se lee de la
  cookie en **cada** request y nunca se cachea en memoria: un token guardado al arrancar la app
  daría `auth.csrf_invalid` después de cerrar y volver a iniciar sesión.

**Si la cookie no está, el request se manda igual y decide el servidor.** Bloquearlo en el cliente
sería peor que inútil: en la pantalla de login la cookie todavía no existe, así que un interceptor
que exija el token antes de salir dejaría a nadie poder iniciar sesión.

## 1.c Capacidades: son una PISTA de UI, no autorización

Cada endpoint declara una capacidad de un vocabulario cerrado de 29 y **el servidor la exige**.
`GET /auth/me` publica las efectivas del usuario para que la interfaz decida qué mostrar.

**Ocultar un botón no es autorización.** Toda pantalla sigue manejando el 403 aunque el control
esté deshabilitado. El detalle completo —incluida la decisión de que la ausencia de datos falle
**abierto**, y por qué— está en [ADR-0007](adr/0007-capacidades-como-pista-de-ui.md).

El 403 de autorización es **cerrado y no nombra la capacidad que falta** (`access.forbidden`), a
propósito: un mensaje como «falta `servers.admin`» le daría a un atacante un mapa de la superficie
por fuerza bruta de 403. **No intentes parsear qué faltó.**

⚠️ **`mutates` y `discloses` son ejes independientes.** Agrupar capacidades por «peligrosidad»
mirando solo `mutates` pinta como inofensivas a `exports.download`, `engine_users.secrets`,
`blueprints.captures`, `clones.execute` y `sql_console.execute`: ninguna destruye nada y **todas
divulgan**.

## 2. Almacenamiento en el cliente

- **No se guardan credenciales ni tokens** en `localStorage` ni `sessionStorage` (serían
  vulnerables a XSS).
- Lo **único** que se persiste es la **preferencia de tema** (`localStorage['gw-theme']`,
  valores `light`/`dark`) — dato no sensible. Ver [`theming.md`](theming.md).

## 3. Validación y saneo de entrada

- Todos los formularios validan en el cliente con **Zod + React Hook Form**
  (`zodResolver`). Es validación **defensiva y de UX** (feedback inmediato), no sustituye
  la del backend (que revalida con Pydantic y responde `422`).
- Los identificadores siguen los mismos patrones que el backend, en
  `src/lib/contracts/common.ts`: `IDENTIFIER_PATTERN`, `HOST_PATTERN`, `SLUG_PATTERN`,
  `CHARSET_PATTERN`. Esto alinea el cliente con la whitelist anti-inyección del backend,
  pero la defensa real contra inyección SQL vive en el backend.
- **Operaciones destructivas** que tocan el motor exigen **doble confirmación**
  (reescribir el valor exacto del recurso). Hay cuatro tokens según la operación:
  - `confirm_name` — borrar una BD del motor (`DROP DATABASE`, §9).
  - `confirm_username` — borrar un usuario del motor (`DROP USER`, §7).
  - `confirm_version` — *rollback* de una migración (debe igualar la versión actual, §9).
  - `confirm_grantee` — `REVOKE … CASCADE` en PostgreSQL (repetir el username del grantee, §7).

  En la UI lo fuerzan `ConfirmDialog` (con `confirmWord`) y, en los formularios de grants y
  migraciones, un botón deshabilitado hasta que el valor coincide. El backend lo vuelve a
  exigir (`422` si no coincide).

## 4. Salida y renderizado (XSS)

- React **escapa por defecto** todo el contenido interpolado en JSX.
- **No se usa `dangerouslySetInnerHTML`** en ningún componente.
- Las respuestas de la API se **validan en runtime con Zod** antes de usarse
  (`client.ts`); un shape inesperado se rechaza en lugar de renderizarse a ciegas.

## 5. Datos sensibles: nunca en el cliente

- Las credenciales (passwords, pseudo-root) se envían al backend, que las **cifra**; las
  respuestas **nunca** devuelven la credencial: solo booleanos `has_password` /
  `has_root_password`, que es lo que muestra la UI.
- Los campos de contraseña usan `type="password"` y `autoComplete` adecuado
  (`new-password`), y nunca se persisten ni se prerrellenan al editar.
- **Logging del cliente mínimo y sin datos sensibles:** el cliente solo registra
  `console.error('[api] Respuesta no conforme al contrato', path, issues)` ante drift de
  contrato; **no** loguea cuerpos de request/response ni credenciales.

## 6. Variables de entorno (¡no son secretas!)

- Las variables `VITE_*` se **incrustan en el bundle** en build y son **públicas**.
  **Nunca** pongas secretos en variables `VITE_*` (acabarían en el JS servido al
  navegador). Solo contienen URLs (`VITE_API_BASE_URL`, `VITE_HEALTH_URL`).

## 7. Transporte y CORS

- El backend envía `allow_credentials=True`; por ello `CORS_ORIGINS` **debe** listar el
  origen exacto del frontend (no `*`). Ver [`getting-started.md`](getting-started.md).
- En **producción la cookie es `Secure`** (`https_only`): el frontend debe servirse por
  **HTTPS**. Idealmente frontend y backend bajo el mismo dominio (proxy inverso) para
  evitar problemas de cookies de terceros con `same_site=lax`.

## 8. Límites de tasa: qué hay y por qué el frontend no puede reintentar

Los límites son **por sesión**, salvo el login, que va por IP porque todavía no hay sesión.
Estos son los que están en las rutas:

| Endpoint | Límite |
|---|---|
| `POST /auth/login` | 5/min (por IP) |
| `POST /gateway-users/invite/accept` | 10/min |
| `POST /servers/{id}/users/reveal-password` | **3/min** |
| `POST /database-exports/{id}/download-ticket` | 10/min |
| `GET /database-exports/{id}/download` | **3/min** |
| `POST /api-tokens` | 10/min |
| `POST /schema-comparisons/{id}/adopt` | **3/min** |
| `GET /managed-databases/{id}/migrations/{v}/select-results` | 20/min |
| `POST /mcp` | 120/min **por token** |

**El escalón de 3/min es el de DIVULGACIÓN**: cada llamada entrega una credencial en claro o un
artefacto con datos del cliente. Bajó desde el default de 100/min, que alcanzaba para vaciar el
llavero entero mientras la auditoría registraba el saqueo sin poder frenarlo.

⚠️ **El 429 no trae código ni cabecera `Retry-After`.** No hay con qué calcular un backoff, así
que el cliente solo puede aplicar una espera fija que conozca de antemano, y **nunca** reintentar
solo. Vale para todos los endpoints con límite propio, no solo los sensibles.

**Impacto de diseño, concreto: una pantalla que revele credenciales desde una lista muere al
cuarto clic.** Si el flujo fuera «ver la contraseña de cada usuario del motor de este servidor»,
los primeros tres funcionarían y el cuarto devolvería 429 sin `Retry-After`. Por eso revelar es
una **acción deliberada por fila**, con confirmación, y **no existe ningún botón de «revelar
todas»** — ni debe agregarse. El error se deja visible en vez de reintentar en silencio.

## 9. Responsabilidad de la capa de servido (pendiente)

Estas protecciones se configuran al **servir** el SPA, no en el código del frontend, y
están en el checklist de [`deployment.md`](deployment.md):

- **HTTPS** obligatorio (requisito de la cookie `Secure`).
- **Cabeceras de seguridad / CSP** (`Content-Security-Policy`, `X-Content-Type-Options`,
  `Referrer-Policy`, `X-Frame-Options`/`frame-ancestors`).
- Caché correcta: `index.html` sin caché; activos con hash con caché larga.

## Resumen

| Riesgo | Mitigación en el frontend |
|---|---|
| Robo de sesión por XSS | Cookie **httpOnly** (no accesible a JS); sin tokens en storage. |
| Inyección (SQL/identificadores) | Validación por patrón (defensiva) + autoridad en el backend. |
| XSS por renderizado | Escapado de React; sin `dangerouslySetInnerHTML`; respuestas validadas con Zod. |
| Fuga de credenciales | El cliente nunca recibe ni loguea credenciales; solo `has_*` booleanos. |
| Borrados/operaciones destructivas en el motor | Doble confirmación (`confirm_name`/`confirm_username`/`confirm_version`/`confirm_grantee`). |
| Secretos expuestos | `VITE_*` solo contiene URLs públicas; prohibido poner secretos ahí. |
| CSRF | Cookie `same_site=lax` (backend); endpoints mutadores no son navegaciones GET. |
