# ADR-0002 — Autenticación por cookie de sesión httpOnly

**Estado:** Aceptada

## Contexto

El backend implementa **administrador único** con una **cookie de sesión httpOnly
firmada** (`gw_session`, `same_site=lax`, `https_only` en producción, expiración por
`SESSION_MAX_AGE`). No emite JWT ni refresh tokens. El requisito de seguridad es no
almacenar credenciales sensibles en `localStorage`/`sessionStorage` (vulnerables a XSS).

## Decisión

El frontend **no gestiona ningún token**. Cada petición usa `credentials: 'include'`
(en `lib/api/client.ts`); el navegador adjunta y guarda la cookie automáticamente. La
sesión se modela como una query (`GET /auth/me`) en `useSession`. Un **401 global**
(handler registrado por `SessionProvider`) invalida `auth/me` y `ProtectedRoute` redirige
a `/login`. El login usa `suppressAuthHandler` para que su 401 (credenciales inválidas)
no se confunda con expiración de sesión.

## Consecuencias

- ✅ La cookie httpOnly es invisible a JS → cumple "no tokens en almacenamiento".
- ✅ Una sola fuente de verdad de sesión (`auth/me` en caché).
- ⚠️ Requiere **CORS con origen específico** (no `*`) y **HTTPS** en producción
  (cookie `Secure`). Frontend y backend conviene servirlos bajo el mismo dominio para
  evitar problemas de cookies de terceros (`same_site=lax`). Ver [deployment](../deployment.md).
- ↩️ El backend documenta migración futura a SSO/OIDC; al concentrar la sesión en
  `useSession` + `ProtectedRoute`, el frontend cambiaría en pocos puntos.
