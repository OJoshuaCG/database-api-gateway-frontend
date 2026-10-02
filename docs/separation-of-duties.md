# Separación de funciones

Contrato: `backend/docs/api-reference-v29.md` §8 (C2). La regla vive en
`app/core/separation_of_duties.py`; el escritor, la herencia y los reportes en
`app/services/sod_service.py`.

## La regla

**Una misma cuenta no puede ser oficial de seguridad (`security_officer`) y a la vez owner (o
administrar accesos).** Quien escribe la política del gateway no puede ser quien opera producción
ni quien reparte los accesos.

| Regla (`rule`)                  | Choca con `security_officer`                                                                                             |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `owner_security_officer`        | rol base `owner`, un rol `owner` por alcance, o una capacidad puntual **viva** (pendiente o activa) exclusiva de `owner` |
| `access_admin_security_officer` | la global `access_admin`                                                                                                 |

Se evalúa sobre el **estado resultante**, no sobre el payload. Las capacidades exclusivas de
`owner` son las que tiene `owner` y no `operator`; la UI las saca del catálogo
(`ownerOnlyCapabilityIds`), no de una lista.

## Qué hace el servidor

- **Al escribir** (`POST`/`PATCH /gateway-users`, `PUT …/access`, `POST …/capability-grants` y
  `approve`): `409 access.sod_conflict` si el resultado viola una regla que ninguna excepción viva
  cubre. El 409 trae `rules`, `conflicts[{rule, sources}]` y los límites del override.
- **Break-glass**: los cuatro escritores con payload (todos menos `approve`) aceptan
  `sod_override: {reason (20–500), expires_in_hours (1–168, por defecto 168)}`. Inválido →
  `422 access.sod_override_invalid`. Desde C3 (v29 §9) un override es una **elevación**: no se
  aplica en el acto sino que viaja con la solicitud pendiente (`202 access.elevation_pending`, o la
  capacidad puntual nace `pending`) y se escribe cuando OTRO `access_admin` la aprueba. Con
  `ACCESS_FOUR_EYES=False` se aplica en el acto y se audita `access.elevation_unapproved`.
- **Al leer**: una cuenta que viola una regla sin excepción viva pierde las capacidades de
  `security_officer` (falla cerrado). `owner` y `access_admin` se conservan.
- **Herencia**: las combinaciones que ya existían (por ejemplo, el admin sembrado por una versión
  anterior; desde C4 la siembra es `viewer` + `access_admin` y no combina nada) quedan
  `grandfathered`, sin vencimiento, y siguen funcionando.

## Qué hace la UI

| Dónde                                             | Qué                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Editor de accesos (`GatewayUserAccessEditor`)     | **Aviso previo** con el espejo puro `sodConflicts` sobre lo que quedaría al guardar (rol base, permisos con destino, globales y puntuales vivas). Si el aviso encuentra algo, se pide `GET /authz/sod-report` para saber si una excepción de esa persona la cubre: entonces el aviso pasa a «cubierta por una excepción vigente».                                                                            |
| Edición de usuario (`GatewayUserFormModal`)       | Aviso previo al cambiar el rol base. El alta no manda globales y no puede violar la regla.                                                                                                                                                                                                                                                                                                                   |
| Ante el 409                                       | `SodConflictPanel`: el rechazo fijo en el formulario (el toast se va solo), con lo recomendado a la vista —repartir las funciones— y la **«Excepción de emergencia»** detrás de un desplegable cerrado y en rojo: motivo + duración en horas. Reenvía **exactamente** el mismo cambio con `sod_override`. El rechazo queda atado al estado que se intentó guardar: si el formulario cambia, desaparece solo. |
| Capacidades puntuales (`CapabilityGrantsSection`) | El mismo panel ante el 409 del alta.                                                                                                                                                                                                                                                                                                                                                                         |
| Bandeja de pendientes                             | Las dos secciones (elevaciones y capacidades puntuales). `blocked_reason: access.sod_conflict` y el 409 de `approve` dicen que no se puede aprobar y la salida: separar, o cancelar/rechazar y volver a pedirla con la excepción. **Aprobar no acepta `sod_override`**, así que no se ofrece.                                                                                                                |
| Toda la app (`SodWarningsBanner`, en `AppShell`)  | Aviso persistente de `/auth/me.sod_warnings` para la persona de la sesión: heredada («Pedí que se separen»), override (con su vencimiento y motivo) o neutralizada (sus funciones de oficial de seguridad están desactivadas). No se puede cerrar: es un estado de la cuenta.                                                                                                                                |
| `/gateway-users?tab=sod` (`SodReportCard`)        | Solo `access.admin`. Cuentas sin excepción (ya neutralizadas) y excepciones vivas, con `still_violating` resaltado. Cada persona enlaza a sus accesos.                                                                                                                                                                                                                                                       |

El espejo es una **pista**: decide el servidor. Si el aviso y el 409 discrepan, manda el 409.

## Con el segundo aprobador (C3)

La regla se evalúa sobre el estado FINAL **antes** de partir el cambio (v29 §9.3): un `409
access.sod_conflict` no deja nada aplicado ni pendiente, así que el panel y la excepción funcionan
igual que antes. Lo que cambia es el desenlace del reenvío con `sod_override`:

1. «Guardar con excepción de emergencia» reenvía el MISMO cambio con `sod_override`.
2. El servidor responde `202 access.elevation_pending` (alta, edición o accesos) o crea la capacidad
   puntual `pending`: la excepción viaja en `pending_request.sod_override` /
   `CapabilityGrantOut.sod_override`, y el panel lo dice («No se aplica en el acto: viaja con el
   cambio y lo aprueba otra persona con access_admin»).
3. En la bandeja, la elevación muestra «Incluye una excepción de emergencia…» con su motivo y
   duración. Al aprobar, el servidor vuelve a chequear la regla sobre el estado final: si ya no la
   cubre nada, `409 access.sod_conflict` (la solicitud sigue `pending`) con el copy de
   `accessRequestErrorMessage`, que manda a rechazar, separar y volver a pedirla.

## Primer arranque: la ventana de arranque (C4)

Con C3, toda elevación espera a un **segundo** `access_admin`, y una instalación nueva tiene uno
solo: el sembrado, que desde C4 es `viewer` + `access_admin` (no opera ni fija política). Por eso el
primer arranque abre una **ventana de arranque** (v29 §10.3): mientras está abierta y quien pide es
el **único** `access_admin` activo con credencial, sus elevaciones se aplican en el acto —`201` /
`200` en vez de `202`, una capacidad sensible nace `active`— y cada una se audita
`access.bootstrap_assignment`.

Se cierra **para siempre** cuando un segundo `access_admin` **acepta su invitación** (con la
invitación pendiente no cuenta) o al vencer `closes_at` (`ACCESS_BOOTSTRAP_WINDOW_HOURS`, 72 h por
defecto). El procedimiento esperado: crear un `security_officer`, un `owner` y el segundo
`access_admin`, y entregarle su invitación.

En la SPA:

- `/auth/me.bootstrap_window` (`{open, closes_at} | null`, declarado `.nullish()`) solo llega a
  quien tiene `access.admin`. `BootstrapWindowBanner`, montado en `AppShell` debajo de
  `SodWarningsBanner`, pinta un aviso persistente con el vencimiento en hora local (`closes_at` es
  UTC sin zona y se lee con `parseUtcInstant`), el procedimiento y el enlace a «Usuarios del
  gateway». Cerrada, `null` o sin el campo, no pinta nada. El cierre lo decide el servidor (lo
  evalúa en cada `/auth/me`); la SPA no compara `closes_at` con el reloj.
- Con la ventana abierta, «Requiere segundo aprobador» suma la nota «(se aplica directo durante la
  ventana de arranque)» en los editores y formularios. En la bandeja de solicitudes no: lo que ya
  está pendiente no se aplica solo.
- Ninguna pantalla cambia de flujo: el alta o el cambio de acceso ya manejan el `201`/`200` como
  el caso normal, y si igual llega un `202` (otro administrador con credencial), manda el `202`.

## Dónde vive cada cosa

| Pieza                     | Ubicación                                                                                                                                                                     |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contratos Zod             | `src/lib/contracts/separation-of-duties.ts` (`sod_warnings` y `bootstrap_window` en `auth.ts`, `sod_override` en `gateway-users.ts` y `capability-grants.ts`)                 |
| Contexto del 409/422      | `src/lib/api/errors.ts` → `gatewayUserContext.sodConflicts`, `sodReasonMinLength`, `sodMaxHours`                                                                              |
| Espejo de la regla y copy | `features/auth/separation-of-duties.ts` (`sodConflicts`, `uncoveredSodConflicts`, `sodWarningCopy`…), `features/auth/bootstrap-window.ts`                                     |
| API y hook del reporte    | `features/auth/api/auth.api.ts` (`getSodReport`), `hooks/use-capabilities.ts` (`useSodReport`)                                                                                |
| Copy de errores           | `features/gateway-users/messages.ts`                                                                                                                                          |
| UI                        | `features/gateway-users/components/{SodConflictPanel,SodReportCard}.tsx`, `features/auth/components/{SodWarningsBanner,BootstrapWindowBanner}.tsx`, `SecondApproverBadge.tsx` |
