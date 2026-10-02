# Autorización en el frontend

Punto de entrada al modelo de autorización tal como lo ve la SPA: qué decide el servidor, qué
refleja la interfaz y en qué archivo vive cada pieza. Los flujos detallados están en sus propios
documentos; este los enlaza en lugar de repetirlos.

**Principio:** el servidor decide siempre. Todo lo que hace el frontend con capacidades es una
**pista de UI** ([ADR-0007](adr/0007-capacidades-como-pista-de-ui.md)): deshabilitar con motivo,
avisar antes de guardar, pedir la contraseña antes de tiempo. Toda pantalla sigue manejando el 403.

Fuentes del backend (no copiadas aquí): `backend/docs/features/authentication.md` (siembra,
ventana de arranque, step-up, sesiones), `backend/docs/api-reference-v29.md` (§8 separación de
deberes, §9 segundo aprobador, §10 siembra y ventana, §11 auditoría y sesiones de otros) y
`app/services/capability_catalog.py` (el catálogo y sus invariantes).

## 1. El modelo

| Pieza                   | Valores                            | De dónde sale en la SPA                                                                     |
| ----------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------- |
| Rol (cadena monotónica) | `viewer` ⊂ `operator` ⊂ `owner`    | `/auth/me` → `role` (unión), `base_role`, `scope_roles`                                     |
| Capacidades globales    | `access_admin`, `security_officer` | `/auth/me` → `global_capabilities`                                                          |
| Capacidades             | **32**, vocabulario cerrado        | `GET /authz/catalog` (`useCapabilityCatalog`); las efectivas en `/auth/me` → `capabilities` |

- **Las dos globales son disjuntas** (invariante 9 del catálogo): `access_admin` es exactamente
  `access.admin` (usuarios, accesos, capacidades puntuales, tokens, sesiones de otros);
  `security_officer` es `policy.admin`, `servers.admin`, `catalogs.write` y `environments.write`.
  Ningún rol tiene una capacidad global, ni siquiera `owner`.
- **`gateway.admin` está retirada** (v29 §1–§5) y el catálogo impide reintroducirla. La SPA pregunta
  por `access.admin` o `policy.admin`, nunca por el nombre de la global.
- **Qué otorga cada rol sale del catálogo**, columnas `roles` y `global_capabilities`: hoy `viewer`
  12, `operator` 16 y `owner` 27; las 5 restantes son de las globales. La intención de cada rol en
  una línea vive en `ROLE_PURPOSES` (`features/auth/authz-model.ts`). La lista `CAPABILITIES` de
  `lib/contracts/auth.ts` es solo tipado, no una segunda fuente de verdad.

Columnas de cada fila del catálogo (`capabilityDescriptorSchema`):

| Columna                 | Significado                                                                                  | Uso en la UI                                                                             |
| ----------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `mutates` / `discloses` | Ejes **independientes**: seis divulgan, y cuatro de ellas no destruyen nada                  | `CapabilityFlags` («Modifica», «Divulga datos»)                                          |
| `destructive`           | Subconjunto de `mutates`: solo `owner` y siempre con step-up                                 | `isDestructive`; cae a `DESTRUCTIVE_CAPABILITIES` solo si el backend no manda la columna |
| `requires_step_up`      | Pide contraseña reciente; el catálogo lo garantiza para toda la que divulga o es destructiva | `step_up_capabilities` en `/auth/me`, preflight (§5)                                     |
| `grantable`             | Otorgable suelta sobre un entorno o servidor (todo lo que no es de eje `global`)             | Selector de capacidades puntuales, `grantableNote` en el motivo                          |
| `sensitive`             | Pide segundo aprobador al otorgarla suelta: las **11** exclusivas de `owner`                 | «Requiere segundo aprobador»                                                             |
| `agent_allowed`         | Techo de un token de agente: nunca muta, divulga ni pide step-up                             | Tokens de agente                                                                         |
| `scope_axis`, `implies` | Eje del alcance; lecturas que trae una puntual                                               | Capa 2 (§2), aviso de lecturas implícitas                                                |

## 2. Capa 1 y capa 2

El servidor chequea dos veces (`backend/app/core/scope.py`, espejado regla por regla en
`authz-model.ts`):

- **Capa 1 — rol unión.** ¿Tiene la capacidad en _algún_ alcance (rol base, roles por alcance,
  globales, puntuales activas)? Es lo que publica `/auth/me` → `capabilities` y lo que mira
  `can()`.
- **Capa 2 — rol en el destino.** En **toda ruta con destino** (todas declaran `require_at`) vuelve a
  mirar el rol EN esa base o servidor: rige el más restrictivo entre el permiso del entorno y el del
  servidor; sin ninguno, el rol base (nunca la unión). Una base sin entorno cuenta como el entorno
  más protegido. Las globales y las lecturas no se recortan.

En la SPA, la capa 2 se deriva del catálogo y no de una lista:
`layer2CapabilityIds(catalog)` = eje distinto de `global` **y** fuera del rol `viewer` (el piso que
rige sin permisos por alcance).

Cómo se aplica en una pantalla (receta completa en [`maintenance.md`](maintenance.md), paso 6):

```ts
const guard = useCapabilityGuard(CAPABILITIES.blueprintsApply, 'aplicar versiones', {
  scope: { serverId: db.server_id, environmentId: db.environment_id ?? null },
})
```

- Sin `scope`, la guarda resuelve solo la capa 1. Con `scope` resuelve también la capa 2 y **falla
  cerrado** mientras falte el catálogo o los entornos (`guard.unresolved: 'pending' | 'failed'`,
  motivo «Comprobando si tu acceso permite…»). Solo un backend sin `catalog_version` falla abierto.
- Se pasa `scope` siempre que la pantalla **conoce** el destino y la capacidad es de capa 2. Un alta
  cuyo entorno se elige después no lo pasa: decide el servidor.
- El motivo nombra la capacidad que falta (`capabilityHint`) y, si toda es otorgable, agrega «Se
  puede otorgar sola, como capacidad puntual, sin cambiar tu rol.»
- Los lotes devuelven los ítems omitidos por capa 2 como `error_code: access.forbidden` con solo el
  id: `isSkippedByScope`, `SkippedByScopeCallout`.
- Las vistas de acceso por alcance llevan `SCOPE_ENFORCEMENT_NOTE`.

## 3. Capacidades puntuales, elevaciones y bandeja única

Detalle en [`capability-grants.md`](capability-grants.md).

- **Capacidad puntual:** suma UNA capacidad otorgable sobre UN entorno o servidor sin cambiar el
  rol. Solo `access_admin` otorga, y nadie se otorga a sí mismo.
- **Segundo aprobador:** las 11 exclusivas de `owner` (`databases.drop`, `engine_users.drop`,
  `engine_users.secrets`, `engine_users.credentials`, `blueprints.captures`, `blueprints.apply`,
  `schema_diff.execute`, `clones.execute`, `collation.execute`, `exports.download`,
  `sql_console.execute`) nacen `pending` y no conceden nada hasta que **otro** `access_admin` las
  aprueba. Vencen a los 7 días sin decisión.
- **Elevaciones de acceso (C3):** dar `owner`, agregar una global o un `sod_override` desde el alta,
  la edición o «Guardar accesos» responde **`202 access.elevation_pending`**: lo que no eleva se
  aplica ya y la elevación queda en una solicitud. Las bajas nunca esperan. El espejo
  `needsSecondApprover` / `accessElevations` (`features/gateway-users/assignment-policy.ts`) marca
  antes de guardar lo que va a quedar pendiente.
- **No hay techo por tenencia.** `access_admin` asigna cualquier rol, global o capacidad otorgable
  sin tenerla; el control que reemplaza al techo es el segundo aprobador.
- **Bandeja única:** `/gateway-users?tab=pending` («Solicitudes pendientes»,
  `PendingRequestsInbox`) junta «Elevaciones de acceso» (`PendingAccessRequestsCard`) y
  «Capacidades puntuales» (`PendingCapabilityGrantsCard`). `can_decide` y `blocked_reason` los
  calcula el servidor. `?solicitud=<id>` destaca una solicitud con su estado actual.

## 4. Separación de deberes

Detalle en [`separation-of-duties.md`](separation-of-duties.md).

- **Reglas:** `security_officer` no se combina con `owner` (base, por alcance o puntual exclusiva de
  owner, viva o pendiente) ni con `access_admin`.
- **Servidor:** `409 access.sod_conflict` al escribir; al leer, una cuenta en violación sin
  excepción pierde las capacidades de `security_officer`. Las combinaciones previas quedan
  `grandfathered`.
- **Override de emergencia:** «Excepción de emergencia» en `SodConflictPanel` reenvía el mismo
  cambio con `sod_override` (motivo y horas). Desde C3 es una elevación: viaja pendiente.
- **Avisos:** aviso previo en el editor (`sodConflicts`), `SodWarningsBanner` en toda la app para la
  persona afectada, y el reporte `/gateway-users?tab=sod` (`SodReportCard`, solo `access.admin`).

## 5. Step-up

Detalle en [`security.md`](security.md) §1.d.

- **El servidor lo exige** (`STEP_UP_ENFORCED`, publicado en `/auth/me` → `step_up_enforced`): con
  la ventana de 5 minutos cerrada responde `403 access.step_up_required` antes de cualquier efecto.
- **Interceptor, reintento una vez:** `runRequest` (`lib/api/client.ts`) atiende ese 403 con el
  handler que registra `StepUpProvider`, abre `StepUpDialog` y, si se confirma, reenvía **una sola
  vez**. Varios 403 a la vez comparten un diálogo. Si la persona cancela, sale el 403 original y
  `notifyMutationError` muestra «Falta confirmar tu contraseña».
- **Preflight:** `useStepUp().withFresh(cap, acción)` / `ensureFresh(cap)` preguntan **antes** de
  abrir un flujo con `confirm_token` (vive 120 s) cuando a la ventana le quedan menos de 60 s
  (`needsStepUpPreflight`). Así el pedido de contraseña no consume el tiempo del token. Lugares
  concretos en `security.md` §1.d y [`sql-console.md`](sql-console.md).
- **Exenciones:** cinco rutas `POST .../cancel` no piden step-up (`STEP_UP_EXEMPT` en
  `backend/scripts/check_route_capabilities.py`): clon, lote de clones, conversión de collation, lote
  de conversión y retirar la propia solicitud de elevación. Frenar algo nunca cuesta más que
  lanzarlo. Las capas 1 y 2 siguen valiendo.
- **Fallos:** `400 auth.step_up_failed` con `attempts_remaining`; al quinto seguido,
  `401 auth.session_step_up_failed` cierra la sesión.

## 6. Ventana de arranque

Una instalación nueva siembra `ADMIN_USERNAME` como **`viewer` + `access_admin`**: no opera ni fija
política. Como toda elevación espera a un segundo `access_admin` y al principio hay uno solo, el
primer arranque abre una **ventana de arranque** de 72 h (`ACCESS_BOOTSTRAP_WINDOW_HOURS`) en la que
sus elevaciones se aplican en el acto.

- `/auth/me` → `bootstrap_window` (`{open, closes_at}`, solo para `access.admin`) alimenta
  `BootstrapWindowBanner`, montado en `AppShell`. El texto indica qué crear: un oficial de seguridad,
  un owner y un segundo administrador de accesos.
- «Requiere segundo aprobador» suma «(se aplica directo durante la ventana de arranque)».
- El cierre lo decide el servidor (segundo `access_admin` que acepta su invitación, o vencimiento);
  la SPA no compara `closes_at` con el reloj. Pasos de puesta en marcha en
  [`getting-started.md`](getting-started.md).

## 7. Auditoría y sesiones de otros

- **Auditoría** (`/audit-log`): solo `policy.admin`, es decir `security_officer`. Lee el rastro quien
  no hace los cambios de acceso. Sin step-up en los `GET`. Detalle en [`audit.md`](audit.md).
- **Sesiones de otra persona:** sección «Sesiones activas» de `/gateway-users/:userId/accesos`
  (`GatewayUserSessionsSection`), con `access.admin`. «Cerrar todas las sesiones» pide confirmación y
  step-up; sobre la propia cuenta va deshabilitado y remite a «Mi cuenta». Quien la pierde ve «Un
  administrador de accesos cerró tu sesión» (`auth.session_access_admin_revoked`).

## 8. Códigos de error y dónde se traducen

| Código                                                                                                                            | Estado    | Dónde se mapea                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `access.forbidden`                                                                                                                | 403       | `isAccessForbidden` → `ForbiddenState` (página) o `forbiddenCopy()` (`features/auth/messages.ts`); en mutaciones, `notifyMutationError`. Nunca con «Reintentar» |
| `access.step_up_required`                                                                                                         | 403       | `runRequest` (reintento); si llega a la pantalla, `STEP_UP_REQUIRED_COPY` vía `notifyMutationError`                                                             |
| `auth.step_up_failed`                                                                                                             | 400       | `stepUpErrorMessage` (diálogo)                                                                                                                                  |
| `auth.csrf_missing` · `auth.csrf_invalid` · `auth.origin_rejected`                                                                | 403       | `csrfErrorCopy` / `notifyMutationError`                                                                                                                         |
| `auth.session_*`                                                                                                                  | 401       | Handler global de 401 → `sessionEndReason` → `Callout` en `LoginPage`                                                                                           |
| `access.elevation_pending`                                                                                                        | 202       | Hooks de `gateway-users` + `ELEVATION_PENDING_MESSAGE`                                                                                                          |
| `access.sod_conflict` · `access.sod_override_invalid`                                                                             | 409 · 422 | `SodConflictPanel`, `features/gateway-users/messages.ts`                                                                                                        |
| `access.not_assignable` · `access.self_modification_forbidden` · `access.self_approval_forbidden` · `access.last_admin_protected` | 409       | `gatewayUserErrorMessage`, `capabilityGrantErrorMessage`, `accessRequestErrorMessage`                                                                           |
| `access.grant_*`, `access.request_*`                                                                                              | 404 · 409 | `capabilityGrantErrorMessage`, `accessRequestErrorMessage` y sus `*BlockedMessage`                                                                              |
| `access.scope_has_grants`                                                                                                         | 409       | `scopeHasGrantsMessage` (`features/auth/messages.ts`)                                                                                                           |

Los códigos de los contratos viven en `lib/contracts/auth.ts` (`AUTH_*_ERROR_CODES`,
`ACCESS_FORBIDDEN_CODE`) y el contexto de cada error en `lib/api/errors.ts`.

## 9. Decisiones y por qué

- **`operator` no hace operaciones de flota ni nada destructivo.** Renombrar el slug o la tabla de
  versión, borrar un blueprint y crear la versión de un lote de collation exigen `blueprints.apply`,
  que es exclusiva de `owner`. Un operator que lo necesite recibe una **capacidad puntual** en el
  alcance concreto, con segundo aprobador, en lugar de subir de rol en todo el entorno.
- **`collation.execute` es solo de `owner`** y está marcada destructiva: una conversión reescribe
  tablas enteras en el motor.
- **`clones.execute` es de `owner`, no de `operator`**, pese al nombre: un clon copia datos, y llevar
  producción a desarrollo es divulgación.
- **`engine_users.credentials` es aparte de `write`:** quien elige la contraseña de una cuenta del
  motor la conoce, así que divulga igual que revelarla.
- **`owner` no tiene `servers.admin` ni `catalogs.write`:** editar un servidor puede re-apuntar un
  `server_id` a otro host, y toda fila que un guard lee es una frontera de privilegio.
- **Se retiró el techo por tenencia:** obligaba a que quien administra accesos tuviera también cada
  deber que reparte, que es justo la combinación que la separación de deberes deshace. El segundo
  aprobador cubre el mismo riesgo (crear un «títere» `owner`).
- **La siembra ya no es `owner` + `access_admin` + `security_officer`:** una cuenta con todo era el
  caso que la separación de deberes prohíbe. La ventana de arranque resuelve el arranque sin ella.
- **La SPA deriva, no enumera:** capa 2, destructivas, sensibles y roles salen del catálogo, para
  que un cambio de política en el backend no exija desplegar el frontend.
- **Guardas con destino fallan cerrado; sin datos del backend, abierto:** con `scope`, prometer un
  permiso que el servidor quizá niegue sobre un motor real es peor que esperar; sin catálogo (backend
  viejo), cerrar todo apagaría la aplicación ([ADR-0007](adr/0007-capacidades-como-pista-de-ui.md)).

## 10. Cambios recientes

**2026-10-01**

- `cd8f078` vistas de roles, capacidades y acceso efectivo.
- `1503c32`, `2e7a004` guards de capacidad en las acciones que el backend restringe.
- `370d204` matriz de roles alineada y página propia de accesos.
- `e5f8827` alcance por destino (capa 2) reflejado en la interfaz.
- `6afe10b`, `714f7e7`, `9e69f70`, `ca1f894` capacidades puntuales: contratos, acceso efectivo con
  origen, sección en la página de accesos y bandeja de aprobación.

**2026-10-02**

- `d0e9ad9` documentación: la capa 2 aplica en toda ruta con destino.
- `b2f3171`, `a768f12` `destructive` leído del catálogo; aviso de capacidad otorgable suelta.
- `ec703f6` operaciones de flota pasan a `blueprints.apply` (owner).
- `5808aac`, `4e2e8c4` step-up: reintento tras el 403 y preflight antes de un `confirm_token`.
- `ee1581f` `engine_users.credentials` para elegir la contraseña de una cuenta del motor.
- `f1aca88` `access.admin` y `policy.admin` en lugar de `gateway.admin`.
- `97197bb` separación de deberes: aviso previo, override, banner y reporte.
- `51fe4c3` elevaciones con segundo aprobador (`202`) y bandeja única; se elimina el techo.
- `f483a1f` banner de la ventana de arranque.
- `8b1acc0` página de auditoría (`policy.admin`).
- `2571ee4` ver y cerrar las sesiones de otra persona.

## Dónde vive cada cosa

| Pieza                                     | Ubicación                                                                                                                               |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Contratos (`/auth/me`, catálogo, códigos) | `src/lib/contracts/auth.ts`                                                                                                             |
| Modelo puro (capas, roles, procedencia)   | `src/features/auth/authz-model.ts`                                                                                                      |
| Guardas                                   | `features/auth/hooks/use-capabilities.ts`, `use-capability-guard.ts`; `CapabilityHint`, `CapabilityCallout`                             |
| Step-up                                   | `lib/api/client.ts` (`runRequest`), `features/auth/{StepUpProvider.tsx,step-up.ts,hooks/use-step-up.ts}`, `components/StepUpDialog.tsx` |
| Banners                                   | `features/auth/components/{SodWarningsBanner,BootstrapWindowBanner}.tsx` (en `AppShell`)                                                |
| Copy de errores                           | `features/auth/messages.ts`, `features/auth/notify-mutation-error.ts`, `features/gateway-users/messages.ts`                             |
| Accesos, bandeja, SoD                     | `features/gateway-users/` (`assignment-policy.ts`, `PendingRequestsInbox.tsx`, `SodReportCard.tsx`…)                                    |
| Auditoría                                 | `features/audit-log/`                                                                                                                   |
