# Cobertura de la API en la interfaz

Mapa endpoint → dónde se usa en la UI. Sirve para responder de un vistazo *"¿esto ya
está integrado y desde qué botón se dispara?"* sin volver a auditar el código.

> **Numeración**: la del apéndice "tabla resumen de endpoints" del contrato del backend
> (`backend/docs/api-reference.md`). 🔌 = toca el motor destino.
>
> **Convención de estados**:
>
> | Estado | Significado |
> |---|---|
> | ✅ | Integrado con superficie de UI (hay un botón/pantalla que lo dispara). |
> | 🧩 | Existe en la capa `api/`+`hooks/` pero ningún componente lo consume todavía. |
> | ⛔ | No integrado, **por decisión** (ver la nota de cada fila). |
>
> Regla: si añades un endpoint al frontend, añade su fila acá en el mismo PR (ver la
> convención de [`README.md`](README.md)).

## Autenticación y salud

| # | Endpoint | Estado | Dónde |
|---|---|---|---|
| 3 | `POST /auth/login` | ✅ | `LoginPage` (`/login`) |
| 4 | `POST /auth/logout` | ✅ | `Topbar` → "Cerrar sesión" |
| 5 | `GET /auth/me` | ✅ | `ProtectedRoute` (guarda de sesión) + `Topbar` (el nombre enlaza a «Mi cuenta»). Desde v23 trae once campos: rol unión, `base_role` (el rol base sin los alcances), `capabilities`, `global_capabilities`, `scope_roles`, `step_up_capabilities`, `step_up_enforced`, `step_up_expires_at`, `previous_login_at`, `last_failed_at` y `catalog_version`. Lo consumen `useCapabilities` (gating de UI; expone también `baseRole`, `scopeRoles` y `globalCapabilities`), «Mi acceso» (`/mi-cuenta`, `EffectiveAccessPanel` en modo propio) y `SessionsPanel`. Desde v29 §8.5 trae `sod_warnings` (nullish, `[]` por defecto): `SodWarningsBanner`, montado en `AppShell`, pinta un aviso persistente por regla —heredada, override con su vencimiento, o neutralizada— en toda la app, «Mi cuenta» incluida. Desde v29 §10.4 trae `bootstrap_window` (`{open, closes_at}` o `null`, nullish; solo para `access.admin`): con `open`, `BootstrapWindowBanner` (también en `AppShell`) avisa que la ventana de arranque sigue abierta hasta `closes_at` (UTC sin zona, `parseUtcInstant`) y enlaza a «Usuarios del gateway», y `SecondApproverBadge` suma «(se aplica directo durante la ventana de arranque)»; ver [`separation-of-duties.md`](separation-of-duties.md) |
| v23 §2 | `GET /authz/catalog` | ✅ | `useCapabilityCatalog` (cacheado contra `catalog_version`, `staleTime`/`gcTime` infinitos). Lo consumen: la pestaña «Roles y capacidades» de `/gateway-users` (`RolesCapabilitiesPanel`), el resumen de rol bajo cada selector (`RoleCapabilitySummary`, en el alta/edición y en cada permiso por alcance), «Acceso efectivo al guardar» de la página de accesos y «Mi acceso» (`EffectiveAccessPanel`). Qué otorga cada rol o global se deriva de las columnas `roles` y `global_capabilities`, nunca de una lista del frontend; sin `catalog_version` (backend viejo) la UI dice que el catálogo no está disponible en vez de inventarlo |
| v23 §8 | `GET /authz/scope-readiness` | ✅ | `GatewayUserAccessEditor` (página `/gateway-users/:userId/accesos`), **antes** de otorgar un permiso por alcance: una base sin entorno resuelve al entorno MÁS protegido, no al default, así que acotar a alguien a un entorno también le acota esas bases |
| v29 §8.6 | `GET /authz/sod-report` | ✅ | `SodReportCard`, pestaña «Separación de funciones» de `/gateway-users` (`?tab=sod`, `useSodReport`). Solo `access.admin`: sin ella la pestaña no se ofrece y un enlace directo muestra `ForbiddenState`. Dos `DataTable`: cuentas sin excepción (ya neutralizadas) y excepciones vivas, con `still_violating` resaltado («Sigue combinando»). Lo usan también el editor de accesos y la edición de usuario, **solo** cuando el aviso previo encuentra una regla violada, para saber si una excepción viva de esa persona la cubre. Se invalida tras cada escritura de accesos. Ver [`separation-of-duties.md`](separation-of-duties.md) |
| v23 §7.4 | `GET /auth/sessions` | ✅ | `SessionsPanel` → «Mi cuenta» (`/mi-cuenta?tab=sesiones`), pestaña «Mis sesiones». El enlace viejo `/admin?tab=sessions` redirige ahí |
| v23 §7.4 | `POST /auth/sessions/revoke-others` | ✅ | `SessionsPanel` → «Cerrar las otras N sesión(es)», con `ConfirmDialog` |
| §5 | `POST /auth/step-up` | ✅ | `StepUpProvider` + `StepUpDialog` (montados en `providers.tsx`, bajo `SessionProvider`; `useConfirmStepUp`). Lo abren dos caminos: **reactivo**, `runRequest` ante un 403 `access.step_up_required` en cualquier ruta (pide la contraseña y reenvía el request **una** vez; varios 403 en paralelo comparten un diálogo; cancelar devuelve el 403 original) y **preflight**, `useStepUp().ensureFresh`/`withFresh` antes de pedir un `confirm_token` cuando a la ventana le queda menos de 60 s. `400 auth.step_up_failed` queda fijo en el diálogo con `attempts_remaining` (no cierra la sesión); 429 pide esperar; `401 auth.session_step_up_failed` es un 401 normal y lleva al login con su motivo. Al éxito escribe `step_up_expires_at` en la caché de `/auth/me`. El propio request va con `suppressStepUp` |
| §5 | `POST /auth/password` | ✅ | `ChangePasswordPanel` → «Mi cuenta» (`/mi-cuenta?tab=contrasena`), pestaña «Contraseña» (`useChangePassword`). Pide la actual, la nueva y su repetición (la coincidencia y el mínimo `GATEWAY_PASSWORD_MIN` se validan en cliente). Los errores quedan fijos en el formulario: `auth.invalid_current_password` en «Contraseña actual»; `gateway_user.weak_password` (con `min_length` del backend) y `auth.password_unchanged` en «Contraseña nueva»; 429 y los 403 de CSRF arriba del formulario. Al éxito dice cuántas sesiones **otras** cerró (`revoked_sessions`), limpia el formulario e invalida `/auth/me` y `/auth/sessions`. El `sid` rota y la cookie CSRF cambia en la misma respuesta; `readCsrfToken` la relee en cada request, así que no hay nada que refrescar a mano |
| 2 | `GET /health/ready` | ✅ | `HealthBadge` en el `Topbar` (poll 30 s, `VITE_HEALTH_URL`) |
| 1 | `GET /health` | ⛔ | Liveness pensado para *probes* de orquestador; la UI no aporta nada mostrándolo. El schema existe en `contracts/health.ts` por si se necesita. **Es el reemplazo de los `/api/v1/test/*`, que fueron desmontados y dan 404**: cualquier sonda de CI o de monitoreo que apuntara a `test/ping` debe mover acá. La SPA no los usaba. |

⚠️ **Dos respuestas 401 que NO traen `public_context.code`** y hay que distinguir por el endpoint,
no por el cuerpo: el login con credenciales inválidas (`Credenciales inválidas.`) y la sesión de un
usuario **desactivado** (`Sesión inválida o usuario inactivo.`). El segundo no es ninguno de los
`auth.session_*`: la cuenta fue desactivada, que no es lo mismo que «la sesión expiró». Las dos se
muestran tal cual las manda el backend (`ApiError.message`), así que no hay copy hardcodeado que
las contradiga.

## Usuarios del gateway (`/gateway-users`)

Las identidades que se autentican **contra el gateway**. ⚠️ No confundir con los **usuarios del
motor** (`/server-users`, `/servers/{id}/users`): son dos poblaciones distintas y el gateway usa
las mismas palabras para las dos. Por eso las entradas de menú se llaman «Usuarios del gateway» y
«Usuarios del motor», nunca «Usuarios» a secas.

**El alta no lleva contraseña, y no es un olvido**: si quien crea la cuenta conociera la credencial
inicial, toda fila de auditoría atribuida a esa persona sería repudiable. La persona la elige con
un token de invitación que **viaja una sola vez** y que el gateway **no envía por ningún canal**
(no hay SMTP, ni webhook, ni cola).

Lo que se entrega es el **enlace completo**, `<origen del frontend>/invitacion#token=<token>`,
armado con el origen de quien administra (`invite-link.ts`): con el token solo, quien lo recibe no
sabe dónde usarlo. El token va en el **fragmento**, que el navegador nunca manda al servidor: así
no queda en el access log de nginx ni en el `Referer` de los assets. Los enlaces viejos con
`?token=` siguen valiendo, y la página quita los dos de la dirección antes de pintar. La pantalla
de aceptación acepta en el campo tanto el token como el enlace entero pegado.

| # | Endpoint | Estado | Dónde |
|---|---|---|---|
| v23.1 §2 | `GET /gateway-users` | ✅ | `GatewayUsersPage` (`/gateway-users`, pestaña «Usuarios»). Único del módulo **paginado**; los demás usan el `success()` plano. La columna «Rol» muestra el rol base, las capacidades globales y cuántos permisos por alcance tiene cada persona |
| v23.1 §2 | `POST /gateway-users` | ✅ | `GatewayUserFormModal` (alta) → entrega el enlace de invitación en `OneTimeSecretPanel`, detrás de una casilla explícita. Sin campos de contraseña, por diseño. Se ofrecen los tres roles (C3, v29 §9: el techo por tenencia y `access.grant_ceiling_exceeded` se retiraron); `owner` lleva «Requiere segundo aprobador» (`needsSecondApprover`, espejo de `capability_catalog.py`). Con una elevación responde **`202 access.elevation_pending`**: la cuenta nace sin ella (viewer/operator, sin globales), la invitación se entrega igual y el diálogo de entrega dice, fijo, que el rol pedido espera a otra persona, con enlace a la solicitud. `409 access.not_assignable` se marca en el selector de rol. `sod_override` está en el contrato, pero el alta de la UI no manda globales y no puede violar la separación de deberes |
| v23.1 §2.4 | `POST /gateway-users/invite/accept` | ✅ | `AcceptInvitationPage` (`/invitacion#token=…`) — **ruta pública**, fuera de `ProtectedRoute`: quien la usa todavía no puede iniciar sesión |
| v23.1 §2 | `GET /gateway-users/{id}` | ✅ | `GatewayUserAccessPage` (`/gateway-users/:userId/accesos`, `useGatewayUser`): la página de accesos lee a la persona por id para servir también recargada o con la URL escrita a mano. Sin `access.admin` no se pide y se muestra `ForbiddenState`; un 404 usa el copy de `gateway_user.not_found` |
| v23.1 §2.5 | `PATCH /gateway-users/{id}` | ✅ | `GatewayUserFormModal` (edición). `username` va deshabilitado **con el motivo a la vista**: es la identidad que audita `audit_log`, guardada sin FK. Sobre la **propia cuenta** (se compara `id` con el de `/auth/me`) el rol y «Cuenta activa» van deshabilitados con el motivo a la vista: el backend responde 409 `access.self_modification_forbidden`. Subir a `owner` lleva «Requiere segundo aprobador» y responde **`202 access.elevation_pending`**: el resto del PATCH se aplica y el rol queda pendiente; el toast lo dice y enlaza a la solicitud. Al cambiar el rol base, aviso previo si el rol nuevo junta `owner` con `security_officer` sin excepción. Desde v29 §8, el 409 `access.sod_conflict` queda fijo en el formulario (`SodConflictPanel`) con la «Excepción de emergencia» que reenvía con `sod_override`; ver [`separation-of-duties.md`](separation-of-duties.md) |
| v23.1 §2.6 | `PUT /gateway-users/{id}/access` | ✅ | `GatewayUserAccessPage` (`/gateway-users/:userId/accesos`), a la que lleva el enlace «Accesos» de cada fila; el formulario es `GatewayUserAccessEditor`. ⚠️ **Reemplazo TOTAL**: el contrato exige los dos campos justamente para que un formulario no pueda mandar un delta y revocar la otra mitad con un 200. En la fila de la **propia cuenta** «Accesos» va deshabilitado con la nota «Tu propio acceso lo cambia otra persona…» (409 `access.self_modification_forbidden`); si se entra igual por la URL, la página queda en solo lectura, sin «Guardar accesos». Salir con cambios sin guardar pide confirmación (`useBlocker`; `beforeunload` al cerrar la pestaña). Desde C3 (v29 §9) **no hay techo**: se ofrecen todos los roles y las dos globales, y lo que eleva (`owner` nuevo en un alcance, una global que se agrega) lleva «Requiere segundo aprobador», con un resumen junto a «Guardar accesos» de lo que va a quedar pendiente (`accessElevations`, espejo de `split` de `assignment_policy.py`). Un **`202 access.elevation_pending`** aplica lo que no eleva y lleva a la solicitud en la bandeja (`?tab=pending&solicitud=<id>`). La sección «Acceso efectivo al guardar» (`EffectiveAccessPanel`) calcula lo que va a quedar con el mismo criterio que `app/core/scope.py` y dice dónde se aplica hoy. Aviso previo de separación de deberes (`sodConflicts`, espejo de `separation_of_duties.py`) sobre el estado que quedaría al guardar. Desde v29 §8, el 409 `access.sod_conflict` queda fijo en el formulario (`SodConflictPanel`) con la «Excepción de emergencia» que reenvía con `sod_override`; ver [`separation-of-duties.md`](separation-of-duties.md) |
| v23.1 §2.7 | `POST /gateway-users/{id}/invite` | ✅ | Botón «Reinvitar» de la fila, que **desaparece** cuando `credential_set` es `true` (ahí responde 409) |
| §19 | `GET /gateway-users/{id}/capability-grants[?status=]` | ✅ | `CapabilityGrantsSection` (sección «Capacidades puntuales» de `/gateway-users/:userId/accesos`, `useCapabilityGrants`). Solo `access_admin`: con otro rol la sección no se monta y la consulta no se dispara. Un solo GET sin filtro: vigentes (`active`+`pending`) por defecto y los otros cuatro estados tras «Ver también el historial». Lista no paginada |
| §19 | `POST /gateway-users/{id}/capability-grants` | ✅ | Formulario «Otorgar capacidad» de `CapabilityGrantsSection` (`useCreateCapabilityGrant`). 201: una no sensible nace `active`, una sensible `pending` y la UI dice que todavía no concede acceso. Solo ofrece filas del catálogo con `grantable`. Deshabilitado con motivo para la propia cuenta (409 `access.self_modification_forbidden`) y las desactivadas (409 `access.grant_user_inactive`). Errores `access.*` con copy propio (`messages.ts`) en el formulario, no solo en el toast. Desde v29 §8, el 409 `access.sod_conflict` queda fijo en el formulario (`SodConflictPanel`) con la «Excepción de emergencia» que reenvía con `sod_override`; ver [`separation-of-duties.md`](separation-of-duties.md) |
| §19 | `POST /gateway-users/{id}/capability-grants/bulk` | ✅ | Es lo que envía el formulario «Otorgar capacidad» de `CapabilityGrantsSection` (`useCreateCapabilityGrantsBulk`): una capacidad sobre 1–100 destinos del mismo tipo (`MultiCombobox` + «Seleccionar todos»), todo o nada. No ofrece los destinos que ya tienen la capacidad viva. 201 `{ count, pending, grants }`: todas nacen con el mismo estado y el mensaje dice cuántos destinos y si quedan pendientes. 409 `access.grant_bulk_failed` con `public_context.failures` (`{ scope_id, code, message }` por destino, `ApiError.gatewayUserContext.grantBulkFailures`): no se otorgó nada y la lista queda en el formulario; si algún destino es `access.sod_conflict` se ofrece la excepción de emergencia sobre todo el lote |
| §19 | `DELETE /gateway-users/{id}/capability-grants/{gid}` | ✅ | «Revocar» (activa) y «Cancelar solicitud» (pendiente) de `CapabilityGrantsSection`, con `ConfirmDialog` (`useRevokeCapabilityGrant`). Responde **200 con la capacidad** en el cuerpo (no 204): activa → `revoked`, pendiente → `cancelled` |
| §19 | `GET /gateway-users/{id}/effective-access` | ✅ | `GatewayUserAccessEditor` → `EffectiveAccessPanel` (`useEffectiveAccess`, «Acceso efectivo»); se refresca tras otorgar o revocar. Solo `access_admin`; el acceso propio se lee de `/auth/me` |
| §19 | `GET /capability-grants/pending` | ✅ | `PendingCapabilityGrantsCard` (sección «Capacidades puntuales» de `PendingRequestsInbox`), pestaña «Solicitudes pendientes» de `/gateway-users` (`?tab=pending`, `usePendingCapabilityGrants`); la pestaña muestra el recuento de las dos bandejas. Solo `access_admin`: con otro rol no hay pestaña y no se pide. Cada fila trae `can_decide` y `blocked_reason`: con `false` Aprobar/Rechazar van deshabilitados y el motivo queda visible (`aria-describedby`), sin recalcular en el cliente. Estados: carga, vacío, error con «Reintentar», 403 con `ForbiddenState`. Flujo completo en [`capability-grants.md`](capability-grants.md). `blocked_reason: access.sod_conflict` tiene copy propio: aprobar no acepta `sod_override` |
| §19 | `POST /capability-grants/{id}/approve` | ✅ | «Aprobar» de la bandeja, con `ConfirmDialog` (primario) y motivo opcional (`useApproveCapabilityGrant`). Cuerpo `{ reason? }`, `{}` si va vacío. Quien la pidió no puede aprobarla (`access.self_approval_forbidden`). 404/409 tras una carrera: el motivo queda en el diálogo, la confirmación se deshabilita y la bandeja se refresca. Un 409 `access.sod_conflict` dice que no se puede aprobar y la salida (separar o reotorgar con excepción), sin ofrecer el override |
| §19 | `POST /capability-grants/{id}/reject` | ✅ | «Rechazar» de la bandeja, con `ConfirmDialog` en rojo (confirmación final) y motivo opcional (`useRejectCapabilityGrant`). Cuerpo `{ reason? }`. El backend no lo bloquea por auto-solicitud, pero la UI lo deshabilita junto con «Aprobar» cuando `can_decide` es `false` |
| v29 §9.4 | `GET /access-requests/pending` | ✅ | `PendingAccessRequestsCard` (sección «Elevaciones de acceso» de `PendingRequestsInbox`, pestaña «Solicitudes pendientes», `usePendingAccessRequests`); suma al recuento de la pestaña. Solo `access_admin`. Cada fila muestra el cambio compacto **actual → pedido** (`accessRequestDiff`, contra `GET /gateway-users/{id}` de la persona; `desired` es el estado final, no un delta) con el distintivo en lo que eleva, y avisa si el acceso cambió desde el pedido (probable `request_stale`). `can_decide`/`blocked_reason` del servidor: Aprobar/Rechazar deshabilitados con el motivo enlazado por `aria-describedby`. Estados: carga, vacío, error con «Reintentar», 403 con `ForbiddenState` |
| v29 §9.4 | `GET /access-requests/{id}` | ✅ | `PendingRequestsInbox` con `?solicitud=<id>` (`useAccessRequest`, `accessRequestPath`): al llegar desde el aviso de un `202` destaca la solicitud con su estado ACTUAL, también si otra persona ya la decidió y no está en la bandeja |
| v29 §9.4 | `POST /access-requests/{id}/approve` | ✅ | «Aprobar» de la bandeja de elevaciones, con `ConfirmDialog` (primario), el cambio a la vista y motivo opcional (`useApproveAccessRequest`). Step-up. 404/409 (`request_not_pending`, `request_stale`, `sod_conflict`, `self_approval_forbidden`…) tras una carrera: el motivo queda en el diálogo, la confirmación se deshabilita y la bandeja se refresca. Al aplicar se refrescan listado, acceso efectivo y reporte de separación |
| v29 §9.4 | `POST /access-requests/{id}/reject` | ✅ | «Rechazar» de la bandeja de elevaciones, `ConfirmDialog` en rojo y motivo opcional (`useRejectAccessRequest`). Deshabilitado junto con «Aprobar» cuando `can_decide` es `false` |
| v29 §9.4 | `POST /access-requests/{id}/cancel` | ✅ | «Cancelar» de la bandeja, **solo en las filas que pidió quien mira** (`requested_by.id` = sesión; el servidor lo confirma con 409 `access.request_not_requester`). Sin step-up. Motivo opcional (`useCancelAccessRequest`) |
| v29 §11.5 | `GET /gateway-users/{id}/sessions` | ✅ | `GatewayUserSessionsSection` (sección «Sesiones activas» de `/gateway-users/:userId/accesos`, `useGatewayUserSessions`). Solo `access_admin`: con otro rol la sección no se monta y no se pide. `DataTable` (tarjetas bajo `md`) con iniciada, última actividad, vencimiento absoluto e IP, en hora local (`formatUtcDateTime`: llegan en UTC sin zona). Sin `sid` ni prefijo: la revocación las cierra todas. 403 → `ForbiddenState` |
| v29 §11.6 | `POST /gateway-users/{id}/sessions/revoke` | ✅ | «Cerrar todas las sesiones» de `GatewayUserSessionsSection` (`useRevokeGatewayUserSessions`), con `ConfirmDialog` en rojo. Step-up (lo resuelve el cliente). El toast dice cuántas cerró (`revoked`, también 0) y la lista se refresca. En la **propia cuenta** va deshabilitado con el motivo visible y enlace a «Mi cuenta» → «Sesiones» (409 `access.self_modification_forbidden`; lo propio es `revoke-others`). La persona afectada vuelve al login con `401 auth.session_access_admin_revoked`, que tiene su propio texto (`sessionEndReason`) |

**Defectos de contrato conocidos, tratados en la UI** (§2.8): `notes` se acepta y **nunca se
devuelve**, así que el formulario lo trata como *solo escritura* —empieza vacío y solo se envía si
se escribe algo, para no borrar en silencio lo que hubiera—; y `email` omitido lo rellena el
servidor con `{username}@gateway.local`, que el listado marca como «Sin correo declarado» en vez de
presentarlo como dato de contacto.

## Tokens de agente (`/api-tokens`)

Credenciales portadoras para procesos automáticos. Todo detrás de `access.admin` (v29: solo `access_admin`).

| # | Endpoint | Estado | Dónde |
|---|---|---|---|
| v23.1 §3 | `GET /api-tokens` | ✅ | `ApiTokensPage` (`/api-tokens`), paginado |
| v23.1 §3 | `POST /api-tokens` | ✅ | `ApiTokenFormModal` → entrega el bearer en `OneTimeSecretPanel`. Límite 10/min. La columna «Permisos» muestra los scopes **efectivos** que devolvió el servidor, nunca los pedidos: intersecta con el techo de agente. El formulario ofrece como chips los scopes `agent_allowed` del catálogo (los 7 de v30); si llega un 422 `scope_not_allowed`, manda el techo que informó el servidor |
| v23.1 §3 | `DELETE /api-tokens/{token_pk}` | ✅ | «Revocar» con `ConfirmDialog` + re-tipeo del nombre. ⚠️ Va el **`id`** (PK numérica), no el `token_id` del bearer |
| — | `PATCH /api-tokens/{token_pk}` | ✅ | `EditApiTokenScopesModal` (icono de lápiz en filas activas). Reemplaza la lista **completa** de scopes (mínimo uno: vacía es 422; se revoca en su lugar); el bearer no cambia y rige desde la llamada siguiente. Mismo selector de chips y techo de agente que el alta (`ScopesPicker`). 409 `already_revoked`, 404 `not_found`, 422 `scope_not_allowed` (con `allowed[]`). Exige step-up (transparente). ⚠️ Va el **`id`**, no el `token_id` |

## Auditoría (`/audit-log`)

Lectura del rastro de `audit_log` (v29 §11). Solo `policy.admin`, que tiene solo `security_officer`:
lee el rastro quien **no** hace los cambios de acceso. Sin step-up (son `GET`). Flujo y criterios
en [`audit.md`](audit.md).

| # | Endpoint | Estado | Dónde |
|---|---|---|---|
| v29 §11.3 | `GET /audit-log` | ✅ | `AuditLogPage` (`/audit-log`, entrada «Auditoría» del `Sidebar` con `anyOf: [policy.admin]`; `useAuditLog`). Paginado, las más nuevas primero. Filtros en la URL con los nombres del backend (`action` exacta o prefijo con `*` y presets, `actor_type`, `admin_username`, `status`, `request_id`, `from`/`to`; `admin_id`, `api_token_id`, `target_type`, `target_id` y `server_id` solo por URL). Las fechas se eligen en hora local y viajan en UTC con `Z`. `from >= to` se avisa sin pedir; el `422 audit.invalid_range` tiene copy propio. Sin la capacidad o ante un 403: `ForbiddenState` sin «Reintentar» |
| v29 §11.4 | `GET /audit-log/{id}` | ✅ | `AuditEntryDetailModal` (`useAuditLogEntry`), abierto por `?entrada=<id>` (enlace directo; con la fila de la página como `placeholderData`). `detail_json` (`unknown().nullable()`) se muestra con sangría en un `<details>` plegable; si es `null`, `detail` tal cual. «Ver todo el request» filtra por su `request_id`. `404 audit.not_found` con copy propio y sin «Reintentar» |

## Servidores

| # | Endpoint | Estado | Dónde |
|---|---|---|---|
| 6–10 | CRUD de `/servers` | ✅ | `ServersPage` (`/servers`) + `ServerDetailPage` (`/servers/:serverId`); borrado con `ConfirmDialog`. En el `PATCH`, re-apuntar el servidor —otro host, puerto o motor, o un `ssl_mode` más débil que uno desde `require`— exige reenviar `root_password` (422 `server.credential_required_for_rebind`, con `public_context.fields`). `ServerForm` lo anticipa con la misma regla (`server-rebind.ts`): la contraseña pasa a obligatoria en vivo con el porqué y los campos cambiados, y si el 422 llega igual la marca y la enfoca. Decide el backend |
| 11 | `POST /{id}/test-connection` 🔌 | ✅ | `ServerDetailPage` → "Probar conexión" (muestra `dialect` + `server_version`) |
| v30 | `POST /{id}/test-connection?credential=readonly` 🔌 | ✅ | `ReadonlyCredentialPanel` (pestaña «Información», bloque «Acceso de agentes (MCP)») → «Verificar». Corre la sonda negativa; `servers.admin` + step-up. El 422 `server.readonly_probe_failed` lista `public_context.violations` legibles para el DBA (`readonly-credential.ts`); el 409 `server.readonly_credential_missing` tiene copy propio |
| v32 | `POST /{id}/readonly-credential/provision` 🔌 | ✅ | `ReadonlyCredentialPanel` → «Generar credencial automáticamente 🔌» (o «Regenerar credencial 🔌» si ya hay una), siempre tras un `ConfirmDialog` que dice que se usa la cuenta de administrador del servidor, que la contraseña no se muestra, que los grants son fijos de solo lectura y que la credencial es POR SERVIDOR (todas las bases no internas; las creadas después no entran hasta regenerar). Sin cuerpo; `servers.admin` + step-up, 3/min (el 429 tiene copy propio) y sin reintentos automáticos. 422 `server.readonly_probe_failed` reutiliza el Callout de `violations`; 409 `engine_user.protected_account` tiene copy propio (`readonly-credential.ts`). El alta manual («Cargar credencial») sigue como alternativa |
| v30 | `PUT /{id}/readonly-credential` | ✅ | `ReadonlyCredentialModal` (alta o reemplazo, `servers.admin` + step-up). La contraseña no queda en caché: la mutación usa `gcTime: 0` y el modal la resetea. Reemplazar borra la verificación |
| v30 | `DELETE /{id}/readonly-credential` | ✅ | `ReadonlyCredentialPanel` → «Quitar» con `ConfirmDialog`. Estado del panel (`readonlyCredentialState`): sin credencial / sin verificar / verificada / vencida a los 30 días, desde `has_readonly_credential` y `readonly_verified_at` de `ServerOut` |
| 12 | `GET /{id}/databases` 🔌 | ✅ | Tab "Bases de datos" → `ServerDatabasesPanel` (cruzado con el inventario; una base gestionada tiene las mismas acciones que en `ManagedDatabasesPage`, vía `DatabaseRowActions`, y «Adoptar» abre `AdoptDatabaseModal` en el sitio) + tab "Introspección" + selectores de los asistentes + **el selector de bases de las pantallas de permisos**: `DatabaseMultiSelect` (elegir N bases al otorgar) y `ServerDatabaseCombobox` (la BD de "Permisos efectivos" en PostgreSQL). Sustituyó a teclear el nombre a mano —lista las bases del motor en vivo, adoptadas o no— y los dos controles caen a captura manual si la introspección falla |
| 14 | `GET .../tables` 🔌 | ✅ | `IntrospectionExplorer` |
| 15 | `GET .../tables/{t}/schema` 🔌 | ✅ | `IntrospectionExplorer` (columnas, PK, índices, FKs) |
| 16 | `POST /{id}/grantable` 🔌 | ✅ | `GrantPanel` (pre-chequeo "Comprobar delegación" antes de otorgar) |
| 59 | `GET /{id}/reconcile` 🔌 | ✅ | Tab "Reconciliación" → `ServerReconcilePanel` (`managed`/`unmanaged`/`orphan`) |
| 60 | `GET .../snapshot` 🔌 | ✅ | `SnapshotModal` ("Ver snapshot") + asistente de blueprint desde snapshot. El 409 `engine_database.scope_not_allowed` (base de sistema o de metadatos del gateway) se muestra con `engineDatabaseScopeMessage` y sin «Reintentar» |
| 13 | `GET /{id}/users` (plano) 🔌 | ⛔ | Legacy: el propio contrato recomienda la vista agrupada (#64), que sí está integrada. Repetiría un `user@host` por cuenta. |

### Ciclo de vida de BDs a nivel servidor (`/servers/{id}/databases`, por identidad física)

Opera sobre el par `(server_id, database)`, sin exigir que la BD esté adoptada en el inventario.
Complementa —no reemplaza— al CRUD de `/managed-databases`.

| # | Endpoint | Estado | Dónde |
|---|---|---|---|
| — | `POST /{id}/databases` 🔌 | ✅ | Tab "Bases de datos" → "Nueva base de datos" → `CreateServerDatabaseModal` (formulario adaptado al motor; `register` como `Switch` que revela el propietario) |
| — | `GET .../{db}/users` 🔌 | ✅ | `ServerDatabaseDetailPage` (`/servers/:serverId/databases/:database`) → pestaña "Usuarios con permisos" → `DatabaseGranteesPanel` (consulta inversa; oculta `host` si `supports_hosts=false`) |
| — | `POST .../{db}/drop-preview` 🔌 | ✅ | `DropDatabaseDialog`, paso 1: conexiones activas, cruce con inventario y `confirm_token` con cuenta atrás contra `expires_at` |
| — | `DELETE .../{db}` 🔌 ⚠️ | ✅ | «Eliminar del motor 🔌» → `DropDatabaseDialog`, paso 2: exige transcribir el nombre exacto + token vigente; `force_disconnect` como `Checkbox`. Sin reintento automático ni borrado en lote (§6.5/§6.6) |

## Usuarios del motor

### Inventario (`/server-users`, por `id`)

| # | Endpoint | Estado | Dónde |
|---|---|---|---|
| 17–21 | CRUD de `/server-users` | ✅ | `ServerUsersPage` (`/server-users`); `?provision` y `?drop_remote` como `Switch`; borrado remoto exige reescribir el username. El borrado sin `drop_remote` se llama «Quitar del inventario». La ficha del usuario (`ServerUserDetailPage`) también ofrece **editar** y **quitar del inventario**, que antes solo estaban acá; y el `DROP USER` de la tabla del servidor y de la ficha pasó a exigir `engine_users.drop`, como este |
| 22 | `GET /{id}/databases` | ✅ | "Ver BDs" → `OwnedDatabasesModal` en `ServerUsersPage`; pestaña "Bases de datos" de la ficha física (`ServerUserDetailPage`) — ambos sobre `OwnedDatabasesContent` |
| 23 | `GET /{id}/grants` 🔌 | ✅ | Ficha física de la identidad (`ServerUserDetailPage`, `/servers/:serverId/users/:username/:host?`) → pestaña "Permisos efectivos" → `EffectiveGrantsPanel`, **por el camino de la identidad adoptada**: cuando hay `server_user_id` se consulta por aquí, y solo sin adoptar se cae a v21 §1 (el contrato dice explícitamente que el endpoint nuevo **no** reemplaza a este). En PostgreSQL espera que se indique la BD antes de consultar, ahora elegida con `ServerDatabaseCombobox` en vez de tecleada. `ServerUserGrantsPage` (`/server-users/:userId/grants`) queda como redirect de compatibilidad hacia `?tab=grants` de la ficha |
| 24 | `POST /{id}/grants` 🔌 | ✅ | Ficha física → pestaña "Otorgar / revocar" (`?tab=manage`) → `GrantPanel`, operación "otorgar privilegios". Con N bases seleccionadas son **N llamadas**, no una: v21 §12 dice que no existe bulk para privilegios sueltos. Se mandan **en serie**, sin abortar en el primer fallo, y cada base aparece como una fila del resultado |
| 25 | `DELETE /{id}/grants` 🔌 | ✅ | `GrantPanel`, operación "revocar privilegios": mismo fan-out de una llamada por base y mismo resultado por base. `cascade` solo PostgreSQL, con confirmación del grantee |
| 26 | `POST /{id}/apply-profile/{profile_id}` 🔌 | ✅ | `GrantPanel`, operación "aplicar perfil", pero **solo para perfiles 100 % globales**: si ningún item cuelga de una base no hay nada que multiseleccionar y una sola llamada basta. En cuanto el perfil tiene un item por base va por el bulk (v21 §11). Errores parciales enumerados |
| v21 §11 | `POST /{id}/apply-profile/{profile_id}/bulk` 🔌 | ✅ | `GrantPanel`, operación "aplicar perfil" sobre las bases elegidas (1–100) en **una** llamada por tanda. **Siempre responde 200, aunque hayan fallado TODAS las bases**: el éxito se lee de `results[].ok`, nunca del status HTTP — de ahí `outcomeRowsFromBulk` en `grant-logic.ts`. La selección se parte en tandas de 20 y se envían **en serie**: el rate limit es 5/min y con `NullPool` cada base abre su propia conexión remota. Los campos de objeto del formulario viajan como **plantilla** (el `database` del `object_ref` lo pone el backend por base) y cada fila muestra `grants_applied`, `skipped_levels` y `errors[]` |
| 27 | `POST /server-users/provision` 🔌 | ✅ | `ServerUserForm` → sección "Permisos iniciales" al crear con aprovisionamiento (informa `grant_results[]`) |
| 61 | `POST /server-users/adopt` 🔌 | ✅ | `AdoptUserModal`, desde `EngineUsersPanel`, `ServerReconcilePanel` y la ficha física (`ServerUserDetailPage`, pestaña "Identidad" y CTA de las pestañas de permisos sin adoptar) |

> **Ya son 3 pestañas de permisos/BDs, no 4**: "Otorgar / revocar" y "Aplicar perfil" se
> unificaron en `?tab=manage` → `GrantPanel`, y `?tab=profile` redirige ahí. Aplicar un perfil
> dejó de ser una pestaña aparte para ser una de las tres operaciones del mismo panel, porque
> las tres comparten lo que de verdad cuesta elegir: sobre qué bases se aplica.
>
> **Consultar funciona por identidad; otorgar no.** "Permisos efectivos" (#23) **ya no exige
> adopción**: sin `server_user_id` consulta por `(username, host)` con v21 §1. Todo lo que
> **escribe** (#24, #25, #26, v21 §11) y "Bases de datos" (#22) sí siguen exigiendo un
> `server_user_id` numérico, así que sin adoptar (`status !== 'adopted'`) se reemplazan por un
> único `EmptyState` con CTA "Adoptar esta identidad para gestionar sus permisos" en vez de
> ocultarse sin explicación. La asimetría es del contrato, no una decisión de la UI.

### Identidad física y batch (`/servers/{id}/users/*`)

Endpoints por `(server_id, username, host)`. `EngineUsersPanel` (tabla, `/servers/:serverId?tab=users`)
y la ficha física de una identidad (`ServerUserDetailPage`, `/servers/:serverId/users/:username/:host?`)
comparten la misma query agrupada y los mismos modales; la ficha es el destino recomendado para
gestionar permisos (enlazada desde el username/host de cada fila y desde "Ver grants").

| # | Endpoint | Estado | Dónde |
|---|---|---|---|
| 64 | `GET /{id}/users/grouped` 🔌 | ✅ | `EngineUsersPanel` (pantalla principal; respeta `supports_hosts`) y `ServerUserDetailPage` (resuelve la identidad de la ficha por username+host) |
| 65 | `POST /{id}/users` 🔌 | ✅ | "Crear usuario" y "Recrear en el motor" (drift `orphan`), desde `EngineUsersPanel` y desde la pestaña "Identidad" de la ficha física |
| 66 | `PATCH /{id}/users/password` 🔌 | ✅ | "Rotar contraseña" por identidad, desde `EngineUsersPanel` y la ficha física |
| 67 | `DELETE /{id}/users` 🔌 | ✅ | `DeleteEngineUserDialog` (doble confirmación), desde `EngineUsersPanel` y la ficha física |
| 68 | `POST /{id}/users/add-host` 🔌 | ✅ | Solo MySQL/MariaDB; advierte del sobre-aprovisionamiento de `copy_grants` |
| 69 | `POST /{id}/users/reveal-password` 🔌 | ✅ | "Revelar" (solo si `has_password`); secreto efímero, sin caché |
| 70 | `POST /{id}/users/adopt-all-hosts` 🔌 | ✅ | `AdoptAllHostsModal` (acción por *username*); resultado por host |
| 71 | `POST /{id}/users/define-password` | ✅ | `DefineKnownPasswordModal`; alcance explícito, aviso de que el gateway **no verifica** la contraseña, reenvío con `overwrite` |
| 72 | `PATCH /{id}/users/password-all-hosts` 🔌 | ✅ | `RotatePasswordAllHostsModal`; resultado por host (un host con error conserva la contraseña anterior) |
| v21 §1 | `GET /{id}/users/grants` 🔌 | ✅ | Pestaña "Permisos efectivos" de la ficha física → `EffectiveGrantsPanel` **cuando la identidad no está adoptada**: consulta por `(username, host)` sin exigir inventario, y devuelve `status` (`adopted`/`unmanaged`) más el `server_user_id` cuando existe. **No reemplaza a #23**, que sigue siendo la vía con `server_user_id` — el propio contrato lo dice. Asimetría por motor: PostgreSQL **exige** `database` y acota la respuesta a esa base; MySQL/MariaDB **ignoran** el parámetro y devuelven los grants de todo el servidor, así que el recorte lo hace el cliente (`filterGrantsByDatabase`, que conserva los `global` a propósito). El **404 es deliberado**: significa "esta identidad no existe en el motor", que no es lo mismo que existir sin privilegios (eso llega como 200 con `grants: []`) |

> **Definir ≠ rotar.** `define-password` (#71) solo cifra y guarda una contraseña que el
> admin ya conoce, sin tocar el motor; `password`/`password-all-hosts` (#66/#72) cambian
> la contraseña real. Son modales separados a propósito: no los unifiques.

> **Cuentas protegidas (409, las dos tablas de esta sección).** Toda escritura sobre una
> identidad —alta con provisión, cambio o rotación de contraseña, agregar host, `DROP`,
> otorgar, revocar, aplicar perfil y aprovisionar con permisos iniciales— puede responder
> `engine_user.protected_account` con `public_context.reason` ∈ `gateway_credential` (la propia
> credencial pseudo-root del gateway), `reserved_account` (cuenta reservada del motor o de la
> nube administrada) o `privileged_role` (rol de administración, hoy solo PostgreSQL). Y
> `engine_user.protection_unverifiable` cuando PostgreSQL no dejó comprobar los atributos del
> rol: es fail-closed, e invita a **reintentar**, no a desistir. Los dos se traducen en
> `features/servers/engine-user-messages.ts` (`engineUserErrorDescription`), que usan todos los
> hooks de escritura de `servers` y `server-users`, incluido el resultado por base del fan-out
> de privilegios. La UI no intenta adivinar de antemano qué cuenta está protegida: lo decide el
> backend, y el mensaje sale del error.

## Blueprints y sus migraciones

| # | Endpoint | Estado | Dónde |
|---|---|---|---|
| 28–33 | CRUD de `/database-models` + `/databases` | ✅ | `DatabaseModelsPage` (`/database-models`). El `PATCH` tiene **dos entradas**: el ✏️ de la pestaña «Blueprints» y el ✏️ de la tabla de `ProjectDetailPage` — ambas abren el mismo `DatabaseModelFormModal`. La segunda existe porque el nombre se lee en contexto ahí (junto a los demás blueprints del proyecto), que es donde se nota que está mal escrito. Al guardar se invalidan los dos troncos de caché (`['database-models']` y `['projects', id, 'blueprints']`): sin lo segundo la tabla del proyecto se quedaba con el nombre viejo, porque el QueryClient usa `staleTime: 30_000` y `refetchOnWindowFocus: false`. `GET .../databases` trae además el **estado de despliegue** por BD y lo consumen las DOS pestañas de `BlueprintMigrationsPage`: «Estado en las BDs» (`?tab=estado`) con la tabla por BD, y «Versiones» a través de `VersionFactsCard`, que muestra «aplicada en N de M» leyendo `applied_database_count` del listado de versiones (ver fila 48–50) sobre todas las filas de este endpoint, y cae a «pendiente en N de M» sobre las activas (`pending_versions`, lectura directa) cuando ese campo no llega. **Nunca** deriva «aplicada» de `model_version`: ver el JSDoc de `version-adoption.ts`. El refresco 🔌 es `POST .../databases/refresh` |
| v25 §1 | `PATCH /database-models/{id}` — **el slug deja de cambiarse acá** | ✅ | Mismo `DatabaseModelFormModal`, pero el formulario ahora separa la **identificación humana** (`name`, `description`: libres siempre, no tocan ningún motor) del **identificador para el motor** (`slug`). Con bases gestionadas el campo va **deshabilitado**, con el porqué bajo el campo —el slug nombra la tabla `_gw_v_<slug>` DENTRO de cada base, así que cambiarlo acá las dejaría huérfanas— y el asistente de renombrado como salida. **Sin bases sigue siendo editable**: ahí el cambio es local. El 409 `database_model.slug_in_use` se pinta inline con sus tres datos (`current_slug` → `requested_slug`, `managed_database_count`) y su CTA al asistente; no debería ser alcanzable con el campo deshabilitado, pero se maneja igual porque el conteo sale de caché y puede estar rancio |
| v25 §3.4 | `GET /database-models/{id}/version-tables` 🔌 | ✅ | `VersionTablesReportPanel`, pestaña «Contabilidad de versiones» de `BlueprintMigrationsPage` (`?tab=contabilidad`). Compara, base por base, lo que el gateway **espera** contra lo que hay en el motor, y devuelve la versión que guarda cada tabla huérfana — el dato con el que se decide el `stamp` de recuperación. **Carga bajo demanda** (botón «Comprobar ahora»), nunca al montar: abre una conexión por base y es 10/min. No pagina. `needs_attention` es el semáforo, pero **no cuenta `unreachable`**: un informe con `needs_attention: false` y 3 ilegibles no es un informe verde, y el banner lo dice. `summary` es un dict **abierto** y se renderiza tolerante a claves ausentes o desconocidas. Un motor caído **no** rompe el informe: llega como fila `unreachable` dentro de un 200. El enum de 5 vive una sola vez en `version-table-badges.ts`, con `none` neutro (es el estado normal de una base sin posicionar) y `unreachable` indeterminado, nunca «está bien» |
| v25 §3.2 | `POST .../rename-slug/plan` 🔌 | ✅ | Paso 1 de `RenameSlugDialog`. Desde la actualización de v25 (§Δ), `action` tiene **cinco** valores: `already` (la base ya tiene el destino, no bloquea) partió en dos el viejo `conflict`, que ahora significa que **conviven las dos tablas** y bloquea. Cada fila trae `source_table`, porque el origen varía por base —conviven los prefijos `_gw_v_` y `_datum_version_`— y la UI nunca asume uno. Preflight que abre **una conexión por base** para preguntar si tiene la tabla vieja y si el nombre nuevo está libre; no escribe nada, pero es 10/min, así que se pide **por clic explícito** y nunca al montar ni por pulsación de tecla (misma regla que `delete-plan`). Emite el `confirm_token` con `expires_at` solo si hay bases que renombrar y nada bloquea. El enum `action` de 4 vive una sola vez en `rename-slug-badges.ts` |
| v25 §3.3 | `POST .../rename-slug` 🔌 | ✅ | Paso 2 del mismo diálogo. Renombra `_gw_v_{viejo}` → `_gw_v_{nuevo}` en **cada** BD gestionada y actualiza el slug del blueprint **al final**: si algo falla a mitad se compensa y el slug NO se modifica. Rate limit **3/min**, así que el diálogo se bloquea entero mientras está en vuelo — un doble envío se come el presupuesto de reintento justo cuando hace falta. Los cinco 409/422 se clasifican por `public_context.code` (nunca por número: `slug_rename_plan_stale` hereda el status del servicio de token), con sus listas renderizadas como tabla y no como texto del `msg`. La respuesta trae `mirror` (`created`, `failed`, `skipped_disabled`, o `null` en un backend que todavía no lo reporta), que se muestra en un paso de resultado. `slug_rename_failed` **no es un toast**: es una pantalla de incidente con las tres listas separadas —`renamed` (se deshicieron), `failed` (dónde rompió) y 🔴 `not_compensated` (quedaron con el nombre nuevo, reparación **manual**)— y sin botón de reintentar |
| v25 §2.3 | `POST .../migrate-version-table/plan` y `POST .../migrate-version-table` 🔌 | ✅ | Botón «Actualizar al formato Datum…» en la cabecera de `VersionTablesReportPanel` (pestaña «Contabilidad de versiones»), que abre `RenameSlugDialog` en modo `migrate-format`: el mismo asistente de dos pasos, porque el backend devuelve exactamente los mismos schemas que el renombrado, con `prefix_only: true`. Moderniza cada base al formato `_datum_` **sin cambiar el slug**: renombra la tabla de versión donde haga falta y crea el espejo `_datum_migrations` donde falte. Es **opcional** y la UI no lo presenta como deuda: el prefijo histórico `_gw_` sigue funcionando para siempre, y cada apply, rollback o stamp moderniza sola la base que toca. `already` es el caso normal —una segunda corrida sale entera así— y con `rename_count: 0` pero bases sin espejo se ejecuta **sin token**, porque el backend no lo emite. El plan es 10/min y va por clic; la ejecución, 3/min. El resultado muestra `mirror.failed`: no aborta la operación, pero sin verlo el operador creería que el parque quedó uniforme |
| 63 | `POST /database-models/from-snapshot` 🔌 | ✅ | Asistente `/database-models/from-snapshot` y CTA del panel de reconciliación. El 409 `engine_database.scope_not_allowed` se distingue del 409 de nombre/slug en uso (no marca esos campos) y ofrece «Cambiar origen» |
| 48–50 | Listar/crear/detallar migraciones | ✅ | `BlueprintMigrationsPage` (`/database-models/:modelId/migrations`); al crear, `version` va vacía = autoasignada. El listado alimenta tres piezas: el desplegable de `VersionNavigator`, la `VersionAlertsBar` (avisos del catálogo: versiones sin revisar, sin rollback, con el SQL editado tras aplicarse o congelado, cada uno con su lista y su consecuencia) y la ficha `VersionFactsCard`. **Ya no hay tabla de versiones**: era el tercer sitio que repetía las mismas insignias con vocabulario propio, y el vocabulario único vive ahora en `migration-badges.ts`. Cada ítem trae `applied_database_count` (cuántas BDs la tienen aplicada HOY: historial `applied` **y** versión cacheada que la alcanza), que la ficha pinta como «aplicada en N de M»; es opcional en el Zod para tolerar un backend anterior durante el despliegue, y ausente **no** es cero: la ficha vuelve a «pendiente en N de M». Es un dato para mostrar; editar y borrar siguen gobernados por `sql_frozen`/`deletable`. Resumen y detalle traen además el **autor** de la versión (`created_by_admin_id`, `created_by_username`, `created_by_actor_type` con el vocabulario de `audit_log`: `admin` o `api_token`), que la ficha pinta como «Creada por» leyéndolo del resumen, con la pista «token de agente» cuando no la creó un admin humano; los tres son `nullish` en el Zod por el mismo motivo de despliegue, y `null` es «desconocido» (versión anterior al registro, no recuperable de la auditoría), escrito como texto visible. El detalle solo aporta `updated_at` y el tamaño del SQL base a la ficha — comparte clave de caché con el panel de SQL, así que no añade petición. **El listado se pagina de verdad** (v22): el navegador lo pide con `order=desc` para que la punta venga en la primera página y muestra un `Pagination` cuyas flechas cruzan de página, en lugar del aviso «se cargaron N de M» que no llevaba a ninguna parte. La insignia «más reciente» sale de `is_latest`, resuelto por el backend sobre todo el catálogo, y ya no de la posición en la lista. Quien necesita el catálogo COMPLETO (`ApplyMigrationsDialog`, el selector de stamp y `AdoptDatabaseModal`) usa `useAllModelMigrations`, que agota `has_next`: ahí quedarse con una página no era ver menos, era calcular mal |
| addendum v25 | `GET .../migrations/search` | ✅ | Pestaña «Buscar en el SQL» de `BlueprintMigrationsPage` (`?tab=buscar`) → `MigrationSearchPanel`. Solo lee la BD del gateway (sin 🔌, sin rate limit propio), así que busca **mientras se escribe** con debounce de 300 ms, y no pide nada hasta que `q` tiene **4 caracteres sin los espacios de los extremos** — el mínimo se muestra como ayuda, no como error. Los opcionales se **omiten** (`last` «Todas» = sin parámetro); la lógica de parámetros y del resaltado vive en `migration-search.ts`. `last` y las fechas se combinan como **intersección** (primero las últimas N, después el rango dentro de esa ventana), y la UI lo dice cuando están los dos activos. `desde > hasta` se valida en el cliente y no dispara la request; los dos 422 con código (`search_query_too_short`, `search_invalid_date_range`) quedan como red de seguridad. Cambiar cualquier filtro vuelve a la página 1, derivado de una clave de filtros **con el término amortiguado** (sin `useEffect`). El fragmento se resalta con `match_start`/`match_end` **tal cual**, acotados si vinieran fuera de rango. Un resultado abre un **visor propio** que pide la versión exacta con `useModelMigration`, y **no** el navegador del catálogo: ese pagina y su `?version=` cae a la punta si la versión no está en la página cargada, que es lo normal para una búsqueda. El visor muestra el **`up_sql` base** con la línea resaltada (`CodeBlock highlightLine`), no las traducciones por motor: los números de línea de la búsqueda se refieren al SQL base. La query key cuelga de `migrations(modelId)`, así que crear, editar o borrar una versión la invalida |
| 51 | `PATCH .../migrations/{version}` | ✅ | Confirmar `down_sql` sugerido, overrides por motor, y **aprobar el baseline** (`reviewed`, gate R1, desde `VersionFactsCard` — antes vivía en el «card delgado» del panel de detalle). Con `sql_frozen` se deshabilitan `up_sql` y los overrides pero **`down_sql` sigue editable** (v15 §4.bis): bloquearlo cerraría la única salida del 409 de rollback y dejaría la versión sin forma de revertirse. El 409 se clasifica por `public_context.code` —ya no por la prosa— y `sql_frozen` ofrece las dos salidas de `MigrationFreezePanel`. `partial_application` se pinta con `MigrationPartialProgressPanel`, que usa `incomplete_progress` para nombrar la base y la sentencia en la que quedó (**sin** ofrecer «Editar igual»: ese 409 no tiene override), y `stale_overrides` señala los campos concretos |
| v15 §3 | `POST .../migrations/{version}/edit-preview` 🔌 | ✅ | `MigrationEditOverrideDialog`, paso 1 de la vía de excepción para editar una versión **ya aplicada**. Lee la versión de cada BD del motor en vivo (de ahí el rate limit 20/min) y emite el `confirm_token`. Se llega desde la salida «Editar igual…» de `MigrationFreezePanel`, que solo se renderiza si el 409 trae `override_available: true` |
| v18 §3 | `GET .../migrations/{version}/delete-plan` 🔌 | ✅ | `MigrationDeletePlanDialog`, paso 1 del borrado. Es el **veredicto autoritativo**: abre conexión a cada BD del blueprint para leer su versión en vivo, así que manda sobre `deletable` y `delete_requires_stamps` del listado, que salen de caché. Trae `renumber[]` (la re-etiquetación), `stamp_plan[]` (una escritura remota por fila), `blockers[]`, `unstampable[]`, `partial_applications[]` y los `warnings[]`, que el diálogo muestra **tal cual y sin resumir**. Emite el `confirm_token` (TTL 2 min). Se pide desde el clic, nunca al montar el diálogo |
| 52 | `DELETE .../migrations/{version}` | ✅ | Desde el pie de `VersionFactsCard`, ahora sobre **cualquier** versión y no solo la punta (v18): las posteriores bajan un escalón y a las BDs que están adelante se les **mueve el puntero**, que es un `UPDATE` dentro de cada motor — de ahí el `confirm_token` en query, obligatorio solo si el plan mueve punteros, y el 🔌. La respuesta **dejó de ser vacía**: trae `renumbered[]` y `stamped[]`, y el diálogo los lista para que se vea en qué bases se escribió. Habilitado según `deletable`, con el motivo del `block_reason` **como texto visible** y no como `title` de un `<span>` —que no llega por teclado ni en táctil—, y con doble confirmación (hay que reescribir el número de versión) más reconocimiento explícito cuando hay escrituras remotas. Se deshabilita también si el detalle de la versión no cargó: puede haberse borrado por debajo. Los siete errores se clasifican por `public_context.code`; el 422/410 del token significa que el parque cambió y hay que volver a planificar, nunca que el operador se equivocó |
| 52b | `POST .../migrations/validate` | ✅ | `MigrationValidationPanel` dentro de `ModelMigrationForm`: sintaxis, traducción a PostgreSQL, siembra, COLLATE forzado y sentencias destructivas. Con una BD elegida (🔌) comprueba además que las tablas referenciadas existan |
| 53 | `POST .../migrations/apply-all` 🔌 | ✅ | `ApplyMigrationsDialog`: selector de destinos (todas / los que elija, vía `database_ids`), **filtro por entorno** (`environment_id`, que el backend aplica antes del tope), dry-run, `force`, `on_failure`, y resultado por BD con enlace a sus resultados capturados. El resultado distingue **tres** estados (aplicada / bloqueada por política, en ámbar / con error) usando `error_code`, ordena errores primero, y usa `matched_databases` en la cabecera. **Sin consentimiento por corrida** (el backend lo retiró, v13 §1): en su lugar se avisa qué versiones van a capturar y cuáles frenarían el lote por no estar aprobadas. El rechazo por captura sin revisar llega **por ítem dentro de un 200** y se clasifica con `error_code: migration.capture_unreviewed`; el enlace a lo capturado usa `captured_versions` y ya no adivina con la última versión aplicada . El aviso de qué versiones capturan se calcula sobre el catálogo COMPLETO: con una sola página, un blueprint largo lo dejaba incompleto sin decirlo |

## Proyectos (agrupadores de blueprints)

Relación **N:M** contra `database_models`. No tocan ningún motor: ninguna fila lleva 🔌.

| # | Endpoint | Estado | Dónde |
|---|---|---|---|
| v16 §3.1 | `GET /projects` | ✅ | Pestaña «Proyectos» de `DatabaseModelsPage` (`/database-models`, pestaña **por defecto**) → `ProjectsPanel`. La columna «Blueprints» usa el `blueprint_count` que ya viene calculado; **0 no se pinta como advertencia** — es el estado normal del alta recomendada |
| v16 §3.2 | `POST /projects` | ✅ | `ProjectFormModal`. Se envía **sin `model_ids`** a propósito: con ids inválidos el 422 deja el proyecto YA creado y reintentar el alta daría 409 por el nombre. El 409 `project.name_taken` se muestra **inline en Nombre**, sin CTA de reintentar |
| v16 §3.3 | `GET /projects/{id}` | ✅ | `ProjectDetailPage` (`/projects/:projectId`), cabecera |
| v16 §3.4 | `PATCH /projects/{id}` | ✅ | `ProjectFormModal` en modo edición. `description: null` **vacía** la descripción (botón «Vaciar la descripción»); `""` guardaría una cadena vacía |
| v16 §3.5 | `DELETE /projects/{id}` | ✅ | `DeleteProjectDialog`: confirmación **simple**, sin re-tipear el nombre — no es destructivo. El `message` del backend se muestra **tal cual** porque es lo que reafirma que los blueprints no se borraron; el 404 se trata como éxito idempotente |
| v16 §3.6 | `GET /projects/{id}/blueprints` | ✅ | Tabla de `ProjectDetailPage`. **Sin paginador**: el endpoint no acepta `page`/`size`. Se reordena por nombre en cliente. Cada fila ofrece además ✏️ (edita el blueprint vía `PATCH /database-models/{id}`, no el vínculo con el proyecto) |
| v16 §3.7 | `POST /projects/{id}/blueprints` | ✅ | `LinkBlueprintsModal`. Se manda la selección completa sin calcular el delta (es idempotente); `already_linked` se comunica como **éxito**. El 422 marca las filas de `missing_model_ids` y ofrece «Reintentar solo con los válidos»; el 409 `project.link_conflict` ofrece **reintentar** (transitorio), a diferencia del 409 de nombre |
| v16 §3.8 | `DELETE /projects/{id}/blueprints/{model_id}` | ✅ | «Quitar del proyecto» en la tabla del detalle y en la vista inversa. **Sin confirmación, con deshacer** (barra inline); el 404 `project.blueprint_not_linked` es éxito idempotente |
| v16 §3.9 | `GET /database-models/{model_id}/projects` | ✅ | `BlueprintProjectsSection`, dentro de `BlueprintMigrationsPage`. Sin paginador; lista vacía es un estado normal, no un dato faltante |

## Bases de datos gestionadas y migraciones por BD

| # | Endpoint | Estado | Dónde |
|---|---|---|---|
| 34–39 | CRUD + `reassign-owner` | ✅ | `ManagedDatabasesPage` (`/managed-databases`); filtros por servidor, propietario, blueprint, estado y **entorno** (`environment_id` / `only_unassigned`, en un solo control para que la combinación ilegal sea inexpresable); borrado remoto exige reescribir el nombre. El nombre de cada fila enlaza a la ficha unificada `ServerDatabaseDetailPage` (`/servers/:serverId/databases/:database`). **Las acciones de fila salen de `DatabaseRowActions`**, el mismo componente que usa la pestaña «Bases de datos» del servidor, así que una base gestionada ofrece lo mismo en las dos listas: editar, reasignar, migraciones, comparar, clonar y exportar; la ficha tiene además todas ellas en su cabecera (ver «Una entidad, varias vistas» en `maintenance.md`). El `DELETE` sin `drop_remote` se llama **«Quitar del inventario»**, con su propio icono: compartía etiqueta, icono y color con el `DROP` físico de la otra lista, que hace lo contrario |
| — | `PUT /managed-databases/{id}/agent-access` | ✅ | `AgentAccessModal` (acción «Acceso de agentes», con texto, en `DatabaseRowActions` y en la cabecera de la ficha, R1): dos `Switch`, «Permitir agentes» y «Bloqueo de emergencia» (este gana y no tiene override). Body con los **dos** campos obligatorios; `environments.write` (global, solo `security_officer`) + step-up. El estado (`agent_access_allowed` / `agent_access_blocked`, default `false` = falla cerrado) vuelve en `ManagedDatabaseOut` y se pinta en `AgentAccessBadge`, dentro de la celda del nombre (no columna ocultable) del inventario y en la ficha. **Un solo paso:** al habilitar, el modal consulta el servidor de la base (`useServer`, sin endpoint nuevo) y, si su credencial de solo lectura no está verificada (`readonlyCredentialState`: sin credencial / sin verificar / vencida) y hay `servers.admin`, muestra una sección con la casilla «Generar también la credencial de solo lectura del servidor 🔌» (marcada por defecto) junto al consentimiento: el MCP no lee tablas ni columnas sin ella, se usa la cuenta de administrador del servidor, la contraseña no se muestra, grants fijos de solo lectura y la credencial es POR SERVIDOR (todas las bases no internas; las creadas después no entran hasta regenerar). Con la casilla marcada el botón dice «Permitir y generar credencial 🔌» y encadena `PUT agent-access` → `POST /servers/{id}/readonly-credential/provision`, en ese orden y sin reintentos; si el permiso falla no se genera nada, y si falla la credencial el permiso se conserva y el modal explica el motivo (422 con `violations`, 409 y 429 con el copy de `readonly-credential.ts`) con enlace al panel del servidor. Sin `servers.admin` no hay casilla: un `Callout` avisa y enlaza a la ficha del servidor. Con la credencial verificada no se muestra nada extra |
| 62 | `POST /managed-databases/adopt` 🔌 | ✅ | `AdoptDatabaseModal`: incluye *stamp-on-adopt* (blueprint + versión de partida). Se abre tanto desde `ServerReconcilePanel` como desde el CTA "Adoptar" de `ServerDatabaseDetailPage` cuando la BD física todavía no está en el inventario |
| 63 | `POST /managed-databases/{id}/provision` 🔌 | ✅ | `ProvisionDatabaseDialog`, desde el botón "Aprovisionar 🔌" que `ManagedDatabasesPage` muestra solo en filas `pending`/`error`, y desde el aviso "La base de datos no existe en el motor" de `ManagedDatabaseMigrationsContent`. Ejecuta el `CREATE DATABASE` que faltaba sobre una fila ya registrada — sin él la única salida era borrar el registro y rehacerlo, perdiendo notas, entorno, blueprint e historial. `allow_recreate` solo se manda desde `active` (base borrada por fuera del gateway) |
| 54 | `GET .../migrations/status` 🔌 | ✅ | `ManagedDatabaseMigrationsContent`, compartido por la ruta de compatibilidad `ManagedDatabaseMigrationsPage` (`/managed-databases/:databaseId/migrations`) y por la pestaña "Migraciones" de `ServerDatabaseDetailPage` (`/servers/:serverId/databases/:database?tab=migrations`, solo si la BD está adoptada) (versión actual, pendientes y **banner de aplicación parcial**). Con `database_exists: false` la vista deja de pintar contadores que mienten —`pending_count` lista todo el blueprint porque no hay base— y muestra el CTA de aprovisionamiento, deshabilitando lo que toca el motor. **v25** suma `cached_version`, `orphan_version_tables[]` y `has_orphan_accounting`: con el flag en `true` la versión real vive en una tabla que el gateway no lee, así que `pending_versions` **no es de fiar** y la vista deja de pintar el contador — dice «Pendientes: no se puede determinar» y deja la lista colapsada tras un «no fiable», porque un número tachado se sigue leyendo como número, y el incidente empezó con alguien creyéndole a ese contador. «Aplicar» y «Revertir» quedan **deshabilitados** con el motivo como **texto visible** (un `title` no llega por teclado ni en táctil), y el `stamp` sigue habilitado porque es la vía de salida. Precedencia de un solo banner dominante: `database_exists:false` → huérfana → parcial. `false` **no** es «no se pudo comprobar»: la sonda del backend solo se dispara ante la firma exacta, así que una base nueva devuelve `[]` sin pagar una consulta |
| 55 | `POST .../migrations/apply` 🔌 | ✅ | Previsualizar (dry-run) + aplicar; selector `on_failure`; resultado por versión con retomas y sentencia de fallo; mensaje de auto-reconciliación. **Sin consentimiento por corrida** (v13 §1): un aviso informativo, acotado a las versiones PENDIENTES de esa base, dice cuáles van a capturar; el dry-run lo confirma con `will_capture_versions`. El 409 que queda es el de captura **sin revisar**, con CTA al blueprint |
| 56 | `POST .../migrations/rollback` 🔌 | ✅ | Doble confirmación de la versión actual; el 409 por `down_sql` faltante enlaza al blueprint. **Sin consentimiento por corrida** (v13 §1); el aviso de captura cubre el camino a revertir, porque el `down_sql` captura igual que el `up_sql` |
| 57 | `POST .../migrations/stamp` 🔌 | ✅ | Con `force` y la advertencia del anti-patrón (no arregla un apply a medias). El selector de versión carga el catálogo completo: con una sola página ascendente no ofrecía la punta, o sea que no se podía marcar la versión actual. El `force` se deshabilita solo cuando la parcial **sí** es reconciliable (ahí la vía es el endpoint 81); cuando no lo es, `force` es la salida prevista por el backend y tiene que estar disponible. **v25 suma `purge`**, que vacía la tabla de versión antes de escribir en vez de pedirle a Alembic que resuelva el puntero actual: resuelve el único callejón sin salida —un puntero que nombra una revisión que ya no está en la cadena, donde la base queda sin apply, sin rollback y sin stamp—. Va **detrás de `force`** (el backend responde 422 si llega solo) y en una **zona de excepción colapsada** rotulada con el fallo concreto que lo justifica (`Can't locate revision`), no como un checkbox más: descarta el puntero **sin leerlo**. El diálogo acepta `?stamp=<version>` para llegar precargado desde el informe de `/version-tables`, contrastando contra `cached_version`. La respuesta es el `MigrationStatusOut` recalculado, que se siembra en la caché para apagar el banner de contabilidad huérfana sin esperar al refetch |
| 81 | `POST .../migrations/reconcile-partial` 🔌 | ✅ | `ReconcilePartialSection` (sección de ese mismo contenido, vía `?reconcile=`): previsualiza los reversos, avisa de los no demostrablemente seguros y exige confirmar la versión. La entrada se ofrece con `reconcilable` **o** `reconcilable_with_force` (regla en `features/managed-databases/partial-application.ts`): con el segundo el botón avisa que exigirá `force`. Con ambos en `false` no hay vía automática y la UI manda al `stamp force` del endpoint 57 en vez de a esta sección |
| 58 | `GET .../migrations/history` 🔌 | ✅ | Tab «Historial» (paginado), en `MigrationHistoryPanel` — extraído a su propio archivo y pasado de `<ul>` a `DataTable`, con el badge de estado derivado en vez del ternario inline con el valor crudo en inglés. **v25** suma `direction`, `applied_checksum`, `actor_*` y `request_id`, y vuelve **nullables** `model_migration_id` (la FK pasó a `ON DELETE SET NULL`) y `version`. `direction: null` se pinta «Sin registrar» y **nunca se infiere `up`**: ese null significa literalmente que no se sabe si la versión sigue vigente, y antes de v25 apply y rollback eran indistinguibles. Una fila con `model_migration_id: null` lleva la insignia «Versión borrada del blueprint» y **no se oculta ni se atenúa** — es lo único que queda del evento; solo se omite el enlace al detalle, porque no hay a dónde ir. El `request_id` se copia desde la fila expandible bajo el rótulo «ID de solicitud», el mismo que usa `ErrorState` |
| 58b | `GET .../migrations/{version}/select-results` | ✅ | `SelectResultsPage` (`/managed-databases/:databaseId/migrations/:version/select-results`). Faltaba en esta tabla pese a estar implementada. `rows` es POSICIONAL (`rows[i][j]` ↔ `columns[j]`) y solo guarda la corrida más reciente |
| 58c | `DELETE .../migrations/{version}/select-results` | ✅ | Botón "Purgar ahora" de esa misma pantalla, con confirmación |

## Comparación de esquemas

| # | Endpoint | Estado | Dónde |
|---|---|---|---|
| 73 | `POST /schema-comparisons` 🔌 | ✅ | Asistente `/schema-comparisons`, paso selector (acepta BDs del inventario o crudas). También se llega con `?targetDatabaseId=` prellenado desde `ManagedDatabasesPage` y desde la acción "Comparar esquema" de `ServerDatabaseDetailPage` (habilitada solo si la BD está adoptada) |
| 74 | `GET /{id}` | ✅ | Paso resumen (410 → banner "Recalcular") |
| 75 | `GET /{id}/items` | ✅ | Paso detalle, filtrable; orden del servidor (`seq`), nunca reordenado por `phase` |
| 76 | `GET /{id}/export` | ✅ | Descarga `.sql`; respeta filtros activos o la selección, con rollback comentado opcional |
| 77 | `POST /{id}/resolve-selection` | ✅ | `DependencyClosureNotice` en los pasos de confirmación; sus `resolved_item_ids` son la selección final |
| 78 | `POST /{id}/adopt` 🔌 | ✅ | Opción A (oculta si el target no está en el inventario) |
| 79 | `POST /{id}/execute-preview` | ✅ | Preview obligatorio: `confirm_token`, `excluded_by_dependency` y `plan_warnings` |
| 80 | `POST /{id}/execute` 🔌 | ✅ | Opción B, con confirmación del nombre del target |

> **La unidad de selección es el `op_group`, no la fila.** Un objeto redefinido rinde dos
> sentencias (DROP + CREATE) que viajan juntas; enviar media parte se rechaza con 422.

> **Bases fuera de alcance (409 `engine_database.scope_not_allowed`).** Crear (#73), el preview
> (#79), adoptar (#78) y ejecutar (#80) rechazan una base de sistema del motor
> (`reason: system_database`) o la propia base de metadatos del gateway (`gateway_metadata`), en
> cualquiera de los dos lados (`side: source | target`). El copy vive en
> `features/server-databases/scope-messages.ts`: nombra la base (el nombre del lado que indica
> `side`, porque `public_context` no lo trae) y dice qué lado revisar. Sin CTA de recuperación
> ni «Reintentar» al crear: la misma selección falla igual, la salida es cambiar la base.

## Catálogos y administración

| # | Endpoint | Estado | Dónde |
|---|---|---|---|
| 40–41 | `/privileges` (listar, activar/desactivar) | ✅ | `PrivilegesPage` (`/privileges`) |
| 42–46 | CRUD de `/permission-profiles` | ✅ | `PermissionProfilesPage` (`/permission-profiles`) |
| 44 | `GET /permission-profiles/{id}` | 🧩 | El modal de edición reutiliza los datos de la fila; el hook queda disponible por si hace falta una vista de detalle. |
| 47 | `POST /admin/crypto/rotate` | ✅ | `AdminPage` (`/admin`), con confirmación |

## Entornos de despliegue

Clasifican cada BD gestionada y llevan la política que el backend hace cumplir
(`blocks_destructive_migrations` y `allows_agent_access`). Contrato del backend:
`docs/features/environments.md`.

`allows_agent_access` dice si un token de agente puede leer las bases de ese entorno. Se muestra
en `EnvironmentsPanel` **siempre**, encendido o apagado: es una superficie de lectura sobre bases
de terceros, y una fila que no dice nada se lee igual que una cerrada. Y se describe como
condición **parcial**: es una de las cinco del gate de agentes, así que cada base necesita además
su propio opt-in, que se lee y se escribe desde la base (`agent_access_allowed` /
`agent_access_blocked`, `AgentAccessModal` y su badge). `EnvironmentsPanel` ofrece «Permitir
agentes» / «Cerrar a agentes» con `environments.write` + step-up; encender pide reescribir el slug.
**Habilitar un entorno no abre ninguna base.**

**Los entornos son un conjunto FIJO de cuatro** (`local`, `development`, `staging`, `production`)
y la administración es **por API a propósito**: no hay pantalla de CRUD, y no es un olvido. La
política se cambia editando una fila por API sin desplegar, cosa que sigue siendo posible; lo que
no existe es la superficie de UI para mutarla, salvo la puerta de agentes. Ver las filas de abajo.

⚠️ No confundir con el campo `environment` de `GET /health`: ese es el `APP_ENV` del **proceso**
del gateway, no la clasificación de una base de datos.

| # | Endpoint | Estado | Dónde |
|---|---|---|---|
| — | `GET /environments` | ✅ | `useEnvironmentOptions` / `useEnvironmentMap` (catálogo compartido por 5 consumidores, `staleTime` infinito): badge de entorno en `ManagedDatabasesPage`, selector en `ManagedDatabaseForm`, filtro «Entorno» del inventario y filtro del `ApplyMigrationsDialog`. Se pide **completo** (sin `only_active`): el selector filtra los activos en cliente, pero el badge tiene que poder resolver un entorno desactivado |
| — | `POST /environments` | ⛔ | Los cuatro entornos son un conjunto fijo; crear uno nuevo es una decisión de política, no de operación diaria. Por API. |
| — | `GET /environments/{id}` | ⛔ | El listado ya trae todos los campos (son 4 filas), así que un detalle no aportaría nada. |
| — | `PATCH /environments/{id}` | ✅ parcial | **Solo `allows_agent_access`**: botón «Permitir agentes» / «Cerrar a agentes» en `EnvironmentsPanel` (`useUpdateEnvironment`, que invalida `queryKeys.environments.all`); `environments.write` + step-up. **Encender** abre `ConfirmDialog` con `confirmWord={slug}` y manda `?confirm_slug=` (query, no body); **apagar** no confirma. El 422 `environment.confirmation_required` se muestra con `expected_slug` y `weakened[]` (`ApiError.environmentConfirmation`). El resto de la política (nombre, color, migraciones destructivas) sigue siendo **por API a propósito**. Antecedente, ya vigente para lo demás: cambiar la política —y sobre todo **debilitarla**— exige repetir el slug (`confirm_slug`) y queda auditado con `record_intent`. Se hace por API a propósito: darlo por UI abarataría un gesto que el backend encareció deliberadamente. **`allows_agent_access` es la segunda palanca que cuenta como debilitamiento** y también exige `?confirm_slug=`; su 422 trae `expected_slug` (para prellenar el diálogo) y `weakened[]` (qué debilita esta llamada, que puede ser más de una cosa). Cuando se construya la UI, el diálogo debe enumerarlas todas. |
| — | `DELETE /environments/{id}` | ⛔ | Exige cero BDs asignadas (409 con el conteo) y no tiene `force`. Por API. |

## Catálogo de charset/collation

Módulo de `api-reference-v7.md`: catálogo global (no por servidor) de combinaciones
charset/collation habilitadas para crear bases de datos. No aparece en el apéndice
numerado del contrato original; su contrato está modelado en
`lib/contracts/charset-collation-options.ts`. Reemplaza el texto libre que tenían
`CreateServerDatabaseModal` (`POST /servers/{id}/databases`) y `ManagedDatabaseForm` en
modo alta (`POST /managed-databases`) — los dos ahora validan contra este catálogo y
repueblan el selector con `public_context.allowed` si llega un 422 de combinación no
habilitada, sin pedirlo de nuevo.

| Endpoint | Estado | Dónde |
|---|---|---|
| `GET /charset-collation-options` | ✅ | `CharsetCollationOptionsPage` (`/charset-collation-options`, sin filtros) para administrar; `CharsetCollationSelector` (`?engine_family=&only_enabled=true`) para el selector de creación |
| `POST /charset-collation-options` | ✅ | `AddCharsetCollationOptionModal`; el 409 de duplicada ofrece habilitar la fila existente en vez de un error genérico |
| `PATCH /charset-collation-options/{id}` | ✅ | `CharsetCollationOptionsPage`: `Switch` de habilitada, botón "Marcar sugerida", y `DisableDefaultOptionDialog` para el invariante "la sugerida debe estar habilitada" |

> **No hay `DELETE`, y no es un olvido** (§5.4 del doc): deshabilitar ya saca la
> combinación del selector; conservar la fila mantiene legible el histórico de las bases
> creadas con ella. La pantalla de administración no tiene botón de eliminar a propósito.

## Clonado de bases de datos

> **Direccionabilidad (2026-09-01).** `/database-clones` es ahora el **historial**; el asistente vive en `/database-clones/nuevo` y cada operación tiene dirección propia (`/database-clones/:jobId`, `/database-clones/lotes/:batchId`). Los links viejos `?jobId=` / `?batchId=` / `?sourceDatabaseId=` se redirigen. Antes el id vivía solo en el estado de React y la URL nunca lo recibía: salirse de la vista dejaba la operación inalcanzable.

El asistente `/database-clones` consume un módulo que **no aparece en el apéndice de
endpoints del contrato**; su contrato está modelado en `lib/contracts/database-clones.ts`
a partir de `backend/docs/features/database-clone.md`.

| Endpoint | Estado | Dónde |
|---|---|---|
| `GET /database-clones` | ✅ | **Historial** (`/database-clones`), pestaña «Individuales». Filtros de estado, servidor destino, búsqueda por los dos nombres de base y `include_batch_children`. Es el punto de reentrada: sin él, un clon cuyo id se perdió del estado del navegador quedaba inalcanzable |
| `POST /database-clones` | ✅ | Paso de plan. Se llega con `?sourceDatabaseId=` prellenado desde `ManagedDatabasesPage` y desde la acción "Clonar" de `ServerDatabaseDetailPage` (habilitada solo si la BD está adoptada) |
| `GET /database-clones/{id}` | ✅ | Estado del trabajo (poll 2 s hasta estado terminal) |
| `GET /database-clones/{id}/objects` | ✅ | Inventario con portabilidad y grafo de dependencias |
| `POST /database-clones/{id}/resolve-selection` | ✅ | Cierre de dependencias de una selección parcial |
| `POST /database-clones/{id}/preview` | ✅ | Plan resuelto + `confirm_token` |
| `POST /database-clones/{id}/execute` | ✅ | Encola la ejecución (aquí `force` va en el cuerpo, no en la query) |
| `GET /database-clones/{id}/items` | ✅ | Monitor de pasos ejecutados |
| `POST /database-clones/{id}/cancel` | ✅ | Cancelación cooperativa |

### Lote de clonación (`/database-clones/lotes`)

Contrato en `backend/docs/api-reference-v19.md`, modelado en `lib/contracts/clone-batches.ts`.
Es la capa de **orquestación** del mismo módulo: cada fila del lote termina siendo un
`CloneJob` real y el monitor enlaza a su pantalla de detalle (`?jobId=`).

**No hay `preview`**: el plan de cada base se resuelve cuando le toca el turno, así que lo que
se confirma es el conjunto de pares origen→destino, no el DDL.

| Endpoint | Estado | Dónde |
|---|---|---|
| `POST /database-clone-batches` | ✅ | Paso «Bases» → crea el plan del lote |
| `GET /database-clone-batches` | ✅ | **Historial**, pestaña «Lotes». Estaba implementado y sin consumir: era el caso más grave de la inalcanzabilidad, porque un lote corre en serie durante mucho tiempo |
| `GET /database-clone-batches/{id}` | ✅ | Cabecera + `counts` (poll 5 s por el límite de 30/min) |
| `GET /database-clone-batches/{id}/items` | ✅ | Una fila por base, con link al clon hijo |
| `POST /database-clone-batches/{id}/execute` | ✅ | Confirmación agregada: re-tipear el nombre del **servidor** destino |
| `POST /database-clone-batches/{id}/cancel` | ✅ | Cancela el lote y la base en curso |
| `GET /database-clone-batches/{id}/retry-candidates` | ✅ | Dos grupos: reintentables y las que requieren atención |
| `POST /database-clone-batches/{id}/retry-failed` | ✅ | Crea un lote nuevo, que vuelve a pedir confirmación |

## Conversión de collation de una base de datos

Módulo de `api-reference-v8.md`: re-alinea el charset/collation de una BD completa —tablas,
columnas y (en MySQL/MariaDB) los 5 tipos de objeto que el motor congela con la collation de la
sesión que los creó (PROCEDURE, FUNCTION, TRIGGER, EVENT, VIEW)— con `DROP`+`CREATE` y
reaplicación de privilegios de rutina. En PostgreSQL es otra operación (columna por columna: el
`ENCODING`/`LC_COLLATE` de la base es inmutable). El modo (`universal`/`columns`) lo decide el
motor, nunca el operador. Pantalla propia, no un tab embebido (un job puede tardar horas y debe
sobrevivir a la navegación): se entra desde el botón "Convertir collation" de la pestaña
"Collation" de `ServerDatabaseDetailPage` (`/servers/:serverId/databases/:database?tab=collation`),
sin entrada de sidebar propia — mismo criterio que el borrado de una base. Contrato en
`lib/contracts/collation-conversions.ts`.

| Endpoint | Estado | Dónde |
|---|---|---|
| `POST /servers/{id}/databases/{database}/collation-conversions` 🔌 | ✅ | `PlanStep` — objetivo (charset+collation en MySQL/MariaDB, solo collation en PostgreSQL, con el mecanismo de "plan sonda" para poblar el catálogo de collations del servidor, ver nota) |
| `GET /collation-conversions/{id}` | ✅ | `SummaryStep`/`MonitorStep` — polling cada 2 s hasta estado terminal |
| `GET /collation-conversions/{id}/objects` 🔌 | ✅ | `InventoryStep` — inventario en vivo por tabla (universal) o por columna (columns), sin polling propio |
| `POST /collation-conversions/{id}/preview` 🔌 | ✅ | `PreviewStep` — plan resuelto + `confirm_token`, modelado como `useQuery` con `useDeferredValue` (cambiar la selección invalida el token solo, sin lógica manual) |
| `POST /collation-conversions/{id}/execute` 🔌 | ✅ | `PreviewStep` — `ConfirmDialog` con el nombre exacto de la base; rate limit `3/minute`, el más restrictivo del módulo |
| `GET /collation-conversions/{id}/items` | ✅ | `MonitorStep` — paginado, con polling mientras el job no sea terminal |
| `POST /collation-conversions/{id}/cancel` | ✅ | `MonitorStep` — cooperativa, no revierte lo ya aplicado |

### Lote por blueprint, versión de contabilidad y deriva (v17)

Contratos en `lib/contracts/collation-conversions.ts`; códigos y tonos en
`features/collation-conversions/messages.ts`. Se llega desde el botón **Collation** de cada fila
de `BlueprintsPanel`, en `/database-models`.

| Endpoint | Estado | Dónde |
|---|---|---|
| `POST /database-models/{id}/collation-conversions` 🔌 | ✅ | `BatchPlanStep` — planifica un job por BD activa (toca el motor una vez por base: 10/min) |
| `POST /database-models/{id}/collation-conversions/{batchId}/execute` 🔌 | ✅ | `BatchConfirmStep` — pide las tres confirmaciones (slug, conjunto echado de vuelta, re-tipeo por BD de entorno protegido). 3/min |
| `GET /database-models/{id}/collation-conversions/{batchId}` | ✅ | `BatchMonitorStep` — polling cada 5 s (no 2 s: el endpoint es 30/min y el lote dura horas) |
| `POST /database-models/{id}/collation-conversions/{batchId}/cancel` | ✅ | `BatchMonitorStep` — las bases en cola no llegan a tocar el motor; la que convierte corta en el próximo punto seguro |
| `POST /database-models/{id}/collation-conversions/{batchId}/blueprint-version` | ✅ | `BlueprintVersionCard` — se **stampea, no se aplica**; el `note` del backend se muestra textual |
| `GET /database-models/{id}/collation-drift` | ✅ | `CollationDriftPanel` — pestaña "Deriva". Sin 🔌 ni rate limit: lee la caché del gateway, no el motor |

> **`unknown` no comparte tono con `ok` en el panel de deriva.** Pintarlos igual afirmaría que
> todo está bien sobre bases de las que el inventario no tiene registrada la collation, que es una
> afirmación distinta de "coincide" — y la diferencia importa justo cuando se decide si convertir.
> Por el mismo motivo `source_note` se muestra **textual**: esa pantalla es una caché, no el motor.

> **Los cuatro campos nuevos del summary de un job** (`batch_id`, `batch_seq`, `tables_total`,
> `objects_total`) permitieron **borrar** el `savedTotals` de `use-collation-conversion-wizard.ts`.
> Ese estado existía porque `progress` solo cuenta lo hecho y nunca el total, y se perdía al
> recargar justo en una operación que dura horas: al volver, el monitor pasaba de "3 de 40" a
> "3 procesadas". Ahora el total viene del servidor.

> **PostgreSQL — huevo y gallina del catálogo de collations (`[SUPUESTO F1]` del addendum v8).**
> `available_collations` sale del inventario de un plan ya creado, pero crear un plan ya exige una
> collation válida. `PlanStep` resuelve esto con la opción que el propio addendum asume del
> frontend: crea automáticamente un plan **sonda** con `target_collation: "C"` (case-sensitive,
> existe en prácticamente todo PostgreSQL), lee su inventario para poblar el selector real, y el
> sonda se abandona solo (expira en 24 h). Es una solución transitoria — falta pedirle al backend
> un endpoint de catálogo de collations por servidor.

## Consola SQL

Módulo de `api-reference-v6.md`: ejecutar SQL ad-hoc eligiendo **con qué usuario del motor**
se conecta, para verificar en la práctica que un permiso quedó como se esperaba. Vive en
`/sql-console` (`?server=<id>&tab=console|history`), no en el detalle del servidor, porque
opera sobre cualquier base de cualquier servidor del inventario. Numeración propia del
contrato v6.

| Endpoint | Estado | Dónde |
|---|---|---|
| `POST /servers/{id}/query/preview` 🔌 | ✅ | Botón "Analizar y ejecutar" / "Solo analizar" → `ClassificationPanel`. Emite el `confirm_token` y estima el impacto. Nunca se dispara por pulsación: el rate limit es 30/min y el preview abre conexión al motor para los `COUNT`. |
| `POST /servers/{id}/query/execute` 🔌 ⚠️ | ✅ | Directo si el nivel es `read`; con `ConfirmExecutionDialog` (tipeo del nombre de la base + token) si es `write`/`ddl`. Resultado en `ResultsPanel`. |
| `GET /servers/{id}/query/history` | ✅ | Pestaña "Historial" → `QueryHistoryPanel`, con filtro por base y "Cargar en el editor". Las filas con `sql_masked: true` (sin `sql_console.execute` donde corrieron) muestran «Valores ocultos» y no se pueden cargar en el editor; `error_message` llega saneado |

Tres cosas que no se leen en la tabla y condicionan el código:

- **`success: false` no es un error.** Un rechazo del motor llega con **HTTP 200** y es el
  resultado que el admin fue a buscar: se pinta en tono neutro. El rojo queda para
  `ddl_persisted`, `policy_miss` y los 5xx.
- **`blocked` manda sobre `requires_confirmation`.** Un lote prohibido vuelve con los dos en
  `true` y el token en `null`; `decidePath` los evalúa en el orden correcto.
- **El historial guarda metadatos, no filas.** No hay forma de volver a ver un resultado: se
  recarga el SQL en el editor y se ejecuta de nuevo.

## Exportación de bases de datos

Módulo de `api-reference-v10.md`: volcado configurable de la estructura y/o los datos de una base a
`sql`/`csv`/`json`/`ndjson`, con confirmación de doble factor, TTL corto sobre el archivo, descarga
de un solo uso y auditoría de cada entrega. Resuelve tres cosas que un `mysqldump` a mano no da:
consistencia de punto único en el tiempo sobre los datos, determinismo byte a byte (dos volcados del
mismo esquema son idénticos, así que se pueden diffear y versionar) y un manifiesto que permite
auditar qué salió sin abrir el archivo. Pantalla nueva en `/database-exports`
(`?serverId=&database=`, reentrada al monitor por `?jobId=`), sin entrada de sidebar: el formulario
entero se deriva de las capacidades de una base concreta, así que sin contexto no habría ni un
control que pintar. Se entra desde la acción "Exportar" de cada fila de `ServerDatabasesPanel` y
desde la pestaña "Resumen" de `ServerDatabaseDetailPage`. Contrato en
`lib/contracts/database-exports.ts`; flujo del frontend en [`database-export.md`](database-export.md).

| Endpoint | Estado | Dónde |
|---|---|---|
| `GET /servers/{id}/databases/{db}/export-capabilities` 🔌 | ✅ | `OriginStep` — **se llama primero y de aquí sale el formulario entero** (controles, valores válidos, defaults, matriz de combinaciones prohibidas, dialecto csv, empaquetado y límites). 30/min |
| `POST /servers/{id}/databases/{db}/database-exports` 🔌 | ✅ | `WizardNav` en `origin` → crea el plan al salir del paso 1, no al final: el catálogo de objetos cuelga del job. Manda `idempotency_key` para que un doble clic no genere dos planes. 10/min |
| `GET /database-exports/{id}/objects` 🔌 | ✅ | `ObjectsStep` — árbol del catálogo con las dos columnas de casillas (estructura / datos), buscador, filtro por tipo y `counts_by_type`. **No usa el envelope paginado estándar**: la paginación viaja dentro del objeto. 10/min |
| `POST /database-exports/{id}/resolve-selection` 🔌 | ✅ | `ObjectsStep` — cierre de dependencias sin congelar nada, como `useQuery` + `useDeferredValue` con flag `isStale`. 10/min |
| `POST /database-exports/{id}/preview` 🔌 | ✅ | Dos usos distintos: `useExportDryRunPreview` (query, `dry_run_only: true` forzado) alimenta el panel vivo de `OptionsStep`/`ConfirmStep`; `useExportPreview` (mutación) es el autoritativo que congela la selección y emite el `confirm_token`. 10/min |
| `POST /database-exports/{id}/execute` 🔌 | ✅ | `ConfirmStep` — encadenado al preview autoritativo para que el token viaje recién emitido; exige el nombre de la base re-tecleado. **3/min**, el más restrictivo |
| `GET /database-exports/{id}` | ✅ | `MonitorStep` — polling cada 2,5 s hasta estado terminal. Sin rate limit a propósito |
| `GET /database-exports/{id}/items` | ✅ | `MonitorStep`, **solo cuando el job ya es terminal**: el backend escribe los ítems de una sola vez al terminar, así que pedirlos antes mostraría «0 incidencias» durante toda la corrida |
| `POST /database-exports/{id}/cancel` | ✅ | `MonitorStep` — cooperativa; descarta el artefacto parcial. Sin rate limit para que un freno nunca quede bloqueado por una cuota |
| `GET /database-exports/{id}/manifest` | ✅ | `MonitorStep` — checksum, tamaño, objetos y TTL del artefacto. **Sobrevive a `consumed` y a `purged`**: «¿qué me llevé?» se sigue pudiendo responder cuando el archivo ya no está |
| `POST /database-exports/{id}/download-ticket` | ✅ | Primer paso de la descarga (v23 §7.2). Lo encadena `useDownloadExportArtifact` **dentro de la misma mutación**: el ticket vive 60 s, así que pedirlo en cualquier otro momento garantiza que esté vencido al hacer click. Corre los mismos guards que la descarga, o sea que los 403/409/410 llegan acá, antes de consumir nada. **10/min** |
| `GET /database-exports/{id}/download?ticket=` | ✅ | `MonitorStep` — `fetchBlob`; **NO pasa por el envelope `ApiResponse`** y los metadatos (`X-Export-Sha256`, `X-Export-Complete`) viajan en cabeceras. Un solo uso. **3/min**. ⚠️ Sus dos fallos propios NO traen código: `410` = ticket vencido (60 s, **no** el artefacto) y `422` = ticket malformado o de otra sesión (está atado a `(job_id, user_id)`). Los separa `downloadErrorCopy` |
| `GET /database-exports/{id}/content` | ✅ | `MonitorStep` — `fetchText` para el portapapeles; deshabilitado desde el preview cuando `inline_delivery_viable` es `false`. Un solo uso. **3/min**. ⚠️ **Exige `X-CSRF-Token` aunque sea un GET** (`csrf: true`): consume el artefacto, y una navegación GET lleva la cookie sola — sin el header, un `<img>` ajeno lo destruía |

Cinco cosas que no se leen en la tabla y condicionan el código:

- **El cliente no duplica ni una regla de negocio.** No hay un solo `if (format === 'csv')` en la
  feature: el evaluador de `compatibility` de `logic.ts` aplica la misma matriz que el servidor hace
  cumplir. Un 422 `export.incompatible_option` que llegue igual es un bug de ese evaluador, no del
  usuario, y `messages.ts` lo loguea como tal.
- **La consistencia es asimétrica por motor.** En MySQL/MariaDB el punto único en el tiempo cubre los
  datos pero **no** la estructura. El backend lo avisa en `preview.warnings`; ocultar ese aviso sería
  el peor bug de la pantalla, así que se muestran **todos** los warnings, no el primero.
- **No hay enmascarado de datos.** Riesgo aceptado explícito: los controles compensatorios son la
  confirmación de doble factor, el TTL corto, la descarga de un solo uso y la auditoría de cada
  descarga. De ahí la banda permanente (`PlainDataNotice`), no un tooltip.
- **Hay dos vencimientos distintos** y no se mezclan: el del PLAN (24 h, afecta a
  `preview`/`execute`) y el del ARTEFACTO (30 min desde que el job termina, afecta a
  `download`/`content`).
- **El kill switch (`EXPORT_ENABLED=False`) no cubre los 12 endpoints, sino 8.** Los de observación y
  freno (leer el job, los ítems, el manifiesto y cancelar) siguen respondiendo a propósito: si se
  apaga el módulo mientras hay un job corriendo, el operador tiene que poder verlo y detenerlo. Por
  eso `MonitorStep` no se desmonta al recibir un `export.disabled` en otra llamada.

## Pendiente de verificar contra el backend real

Los contratos Zod se escriben a mano desde la documentación del backend
([ADR-0001](adr/0001-contrato-zod-manual.md)), así que un campo con nombre o forma
distinta a la documentada **falla en tiempo de ejecución** (la validación del envelope
rechaza la respuesta) y no en compilación. Los siguientes se modelaron desde el
documento y todavía no se han ejercitado contra una instancia real:

- `#70`, `#71`, `#72` — los tres endpoints batch de usuarios y sus `results[]`.
- `#81` — `reconcile-partial`, incluido el 409 con
  `public_context.unreversible_statements` que llega **incluso en `dry_run`**.
- `#54`/`#55` — `has_partial_application`/`partial_application[]` y el bloque
  `reconciliation`, más los campos de checkpoint de `results[]`.
- `#77` — `resolve-selection` y los campos `op_group`/`depends_on` de los ítems.
- **Catálogo de charset/collation** (`/charset-collation-options` completo): según el
  propio addendum v7, el backend todavía no corrió `utf8mb4_0900_ai_ci` habilitada contra
  un MariaDB real ni verificó que los locales sembrados de PostgreSQL existan en el SO del
  servidor destino. El contrato puede tener ajustes menores; el mapeo de `charsetRejected`/
  `charsetDuplicate` está concentrado en `lib/api/errors.ts`.
- **Conversión de collation** (`/collation-conversions` completo): según el propio addendum
  v8, el backend está verificado con tests de API y adapters mockeados pero **no e2e contra
  motores reales** — falta confirmar que una recreación de rutina falle/funcione como se
  documenta en MySQL/MariaDB real, y que los locales de PostgreSQL sembrados existan en el SO
  de cada servidor. El mapeo de errores está concentrado en `wizard/messages.ts` de la
  feature (`classifyConversionError`); el contrato puede tener ajustes menores.
- **Exportación de bases entera** (`/database-exports` completo): el contrato v10 documenta el
  backend como implementado (fases F1–F6) pero nada de esto se ha ejercitado contra una instancia
  real desde la UI. Puntos concretos a confirmar, todos elegidos porque el documento no los muestra
  con datos: la forma de `excluded_by_dependency` (el contrato solo la muestra como array vacío; se
  modeló como `[{object_type, name}]`), si `advisory` de `resolve-selection` comparte forma con
  `edges`, y si `when` de la matriz de compatibilidad puede traer valores booleanos además de texto
  (se aceptan las dos formas a propósito, y el comparador las normaliza). Todo el mapeo está
  concentrado en `lib/contracts/database-exports.ts`, `features/database-exports/logic.ts` y
  `features/database-exports/messages.ts`.
- **Consola SQL entera** (`query/preview`, `query/execute`, `query/history`): el propio
  contrato v6 (§2.8) avisa de que el backend todavía no se validó contra motores
  MySQL/MariaDB/PostgreSQL reales y de que puede haber ajustes menores. Por eso todo el
  mapeo de la respuesta está concentrado en `lib/contracts/sql-console.ts` y
  `features/sql-console/logic.ts`. Punto concreto a confirmar: la paginación del historial
  (§7 la documenta con la clave `meta`, el resto de la API usa `pagination`); el servicio
  acepta las dos formas a propósito.

Ver el checklist de [`deployment.md`](deployment.md#checklist-de-endurecimiento-para-producción).

### Bloqueado por backend: lo que se ve construible desde el contrato y NO lo es

Esto parece implementable leyendo el addendum de identidades y no lo es. Conviene
saberlo **antes** de planificar la pantalla, no a mitad de camino.

- 🔴 **Un snapshot o un export puede venir incompleto sin que la respuesta lo diga.** Cuando el
  gateway no tiene privilegio sobre un catálogo del motor (`42501` de PostgreSQL, `1142`/`1227` de
  MySQL) la consulta devuelve vacío, y **un vacío por falta de privilegio es indistinguible de «no
  hay objetos»**: el blueprint o el export salen sin vistas, sin rutinas o sin triggers, con **200**
  y sin ninguna marca. La señal existe del lado del servidor —cada consulta se clasifica `ok` /
  `denied` / `unsupported`— pero **solo sale a `logger.warning` y no está en ningún schema**. Lo
  mismo con `requires_manual_credentials`, que marca un DDL cuya credencial embebida el gateway
  redactó a `***` y que por lo tanto **no es re-aplicable tal cual**.
  Consecuencia para la UI, que ya está aplicada: **el copy es descriptivo y nunca afirmativo** («se
  exportaron N objetos», no «export íntegro»), y ninguna pantalla promete integridad estructural.
  El `X-Export-Complete` de la descarga cubre otra cosa: que el **job** no terminó bien, no un job
  que terminó bien sobre un catálogo que el gateway no pudo leer.

### Cambios de autorización ya aplicados en la UI

- `GET /database-exports/{id}/manifest` pasó al mismo guard de **propiedad** que `/download` y
  `/content`: expone checksum, lista de objetos y conteo de filas. Dos usuarios con `exports.read`
  sobre el mismo servidor ya **no** comparten manifiestos. El `ArtifactPanel` pinta el 403
  `export.not_owner` de forma explícita en vez de desaparecer en silencio, que era lo que hacía
  antes al no tener datos.
- `GET /managed-databases/{id}/migrations/{v}/select-results` subió a **`blueprints.captures`**
  (solo `owner`): es un endpoint de lectura que un `operator` deja de poder llamar, y es deliberado
  — devuelve datos de negocio de la base gestionada, así que pertenece al eje de **divulgación**.
  `SelectResultsPage` explica el 403 en vez de mostrar un error genérico. **Y desde v23 el enlace
  de origen SÍ se condiciona a la capacidad**: los cuatro sitios que enlazaban a los resultados
  capturados (`VersionFactsCard`, `ApplyResult` y los dos de `ManagedDatabaseMigrationsContent`)
  consultan `useCapabilities().can('blueprints.captures')`. Se oculta **solo el enlace**, no el
  conteo de filas capturadas: ese dato ya viene en el resumen de la corrida que el usuario tiene
  delante, así que taparlo no protegería nada. La rama del 403 queda como red de contención para un
  enlace pegado a mano.

### Fuera de la superficie de esta SPA

- **`POST /mcp` y sus tools** (`list_databases`, los códigos `mcp.*`). La SPA **no implementa un
  cliente MCP**: esos errores llegan como error de *tool* (`result` con `isError: true`) al agente
  que habla con el gateway, no a esta interfaz. Lo que sí toca a la SPA es lo que administra ese
  canal, y está integrado: emitir y revocar los tokens (`/api-tokens`) y administrar el
  acceso de agentes: la puerta de cada entorno (`allows_agent_access`) y el opt-in por base
  (`agent_access_allowed` / `agent_access_blocked`), ambos visibles y editables desde la SPA.

### v23 — el contrato de autorización, y lo que cambia en la superficie

Cada endpoint declara una capacidad de un vocabulario cerrado de **30** y el servidor la exige.
Antes solo hacía falta sesión válida: quien entraba podía todo. El detalle del modelo y la decisión
de fallar **abierto** ante datos ausentes están en [ADR-0007](adr/0007-capacidades-como-pista-de-ui.md).

**Los controles donde un PARÁMETRO sube el requisito (§4)**, todos deshabilitados en la UI con
`useCapabilityGuard` para que la restricción se vea antes de llenar el formulario y no después:

| Control | Dónde | Pide además |
|---|---|---|
| `data_tables` (datos-semilla del snapshot) | `DataSeedStep` | `blueprints.captures` |
| `capture_selects: true` al crear o editar una versión | `ModelMigrationForm` | `blueprints.captures` |
| `drop_remote=true` al borrar una BD gestionada | `DeleteManagedDatabaseDialog` | `databases.drop` |
| `drop_remote=true` al borrar un usuario del motor | `DeleteServerUserDialog` | `engine_users.drop` |
| `provision=true` al reasignar el dueño («Aplicar en el motor») | `ReassignOwnerModal` | `databases.drop` en la base |

El mismo `engine_users.drop` protege además el «Eliminar del motor 🔌» de la tabla de usuarios del
servidor y de la ficha del usuario (`DeleteEngineUserDialog`). Ahí no es un parámetro —ese diálogo
siempre hace `DROP USER`—, así que no entra en la tabla, pero estuvo sin guard: cuando se protegió
el `drop_remote` del listado se cubrió uno solo de los dos caminos que borran del motor.

⚠️ **Apagar la captura NO pide nada extra: solo encenderla.** Por eso el control de
`ModelMigrationForm` se deshabilita únicamente cuando está apagado — quien heredó una versión con la
captura encendida tiene que poder apagarla aunque no pueda volver a encenderla. Modelarlo al revés
dejaría a un operador sin poder desactivar algo que sí puede desactivar.

Y dos endpoints exigen **varias capacidades siempre**, porque crean una versión de blueprint desde
otro módulo: `POST /schema-comparisons/{id}/adopt` pide `blueprints.write` además de la propia, y
`POST /database-models/{id}/collation-conversions/{batch}/blueprint-version` pide
`collation.execute` + `blueprints.write` + `blueprints.apply`, porque además STAMPEA la versión en
cada base (`BlueprintCollationBatchPage`).

**`blueprints.write` es solo autoría (§4.1).** Lo que escribe en las bases de terceros pide
`blueprints.apply` (solo `owner`, otorgable suelta):

| Acción | Dónde | Pide | Pista en la UI |
|---|---|---|---|
| Ejecutar el renombrado del slug / la migración de formato | `RenameSlugDialog` | `blueprints.apply` | Sin `scope`: el backend decide en el entorno más protegido de las bases del blueprint. Los `/plan` siguen en `write`: el `operator` abre el asistente y lee el plan, y el botón de ejecutar va deshabilitado con el motivo desde el primer paso |
| Eliminar el blueprint | `DeleteDatabaseModelDialog`, cabecera de `BlueprintMigrationsPage`, filas de `BlueprintsPanel` (se esconde y lo explica un `CapabilityCallout`) | `blueprints.apply` | El 409 `database_model.in_use` se pinta en el diálogo (no en un toast) con un texto fijo que nombra las bases (`model-in-use.ts`, hasta cinco y «y N más») y deja la confirmación deshabilitada |
| Purgar los resultados capturados | `SelectResultsPage` | `blueprints.captures` en la base | — |

Las capacidades que el catálogo marca `grantable` dicen en el motivo que **se pueden otorgar
sueltas** como capacidad puntual (`grantableNote`, en `capabilityHint` y `CapabilityCallout`).

**`collation.execute` es solo `owner` y destructiva (§5).** Los guards de collation ya pedían esa
capacidad, así que la UI no cambia: es el catálogo el que la saca del `operator`. `isDestructive`
lee ahora la marca `destructive` del catálogo y solo cae a `DESTRUCTIVE_CAPABILITIES` con un backend
que no la publica; las dos coinciden en siete.

**Tres asignaciones de rol que sorprenden y son deliberadas:** `servers.admin` **no** lo tiene
`owner` —editar un servidor puede re-apuntar un `server_id` a otro host, o sea redirigir cada
operación futura de todo operador—; `catalogs.write` y los mutantes de `/environments` tampoco,
porque toda fila que un guard lee es una frontera de privilegio; y `clones.execute` está en `owner`
y no en `operator` pese a su nombre, porque un clon **copia datos** y meter la base de producción de
un cliente en un entorno de desarrollo es divulgación.

### scope-enforcement-hardening — lo que cambia para la SPA

- **`environments.write`** (la 30.ª capacidad, solo `security_officer`, sin fallback a
  `gateway.admin`): reclasificar una base en `ManagedDatabaseForm` (edición) deshabilita el selector
  de entorno sin ella y explica cómo desbloquearlo (`ENVIRONMENTS_WRITE_UNBLOCK`). La pestaña
  Entornos sigue sin CRUD: su única escritura es la puerta de agentes (`allows_agent_access`), con
  esta misma capacidad, y el opt-in por base (`AgentAccessModal`) también la exige.
- **Capa 2 derivada del catálogo** (`layer2CapabilityIds`): eje distinto de `global` y sin el rol
  `viewer`. Reemplaza la lista a mano de cuatro rutas. `useCapabilityGuard` recibe `scope` donde la
  pantalla conoce la base (migraciones, stamp, reconciliar, aprovisionar, asignar blueprint, borrar).
- **Ítems omitidos** (`error_code: access.forbidden`, sin nombre ni entorno): `apply-all` los marca
  «Sin permiso en esta base (#id)»; el plan del lote de collation los aparta del conjunto que se
  reenvía; `execute` y `retry-failed` de clones traen `skipped: [{id, ok, error_code}]`.
- **`server_resolution_inventory_only`** de `scope-readiness`: nota en el editor de accesos.

### Fuera de alcance de v23, declarado por el propio documento

- **Step-up (§1/§6).** Ya no está fuera de alcance: el servidor lo exige y la SPA lo implementa.
  Ver la fila de `POST /auth/step-up` y [`security.md`](security.md) §1.d.
