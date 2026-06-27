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

## 8. Responsabilidad de la capa de servido (pendiente)

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
