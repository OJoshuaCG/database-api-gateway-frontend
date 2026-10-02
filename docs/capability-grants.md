# Capacidades puntuales

Una **capacidad puntual** le suma a una persona del gateway UNA capacidad sobre UN entorno o
servidor, sin tocar su rol. Existe para el caso «necesita borrar bases solo en Desarrollo esta
semana» sin subirle el rol en todo el entorno.

Contrato del backend: `api-reference.md` §19 y, para la asignación y el segundo aprobador,
`api-reference-v29.md` §9 (C3) (no están copiados en `docs/`; este documento describe el **flujo
del frontend**). Cobertura endpoint → pantalla en [`api-coverage.md`](api-coverage.md).

## Quién hace qué

- **Solo `access_admin`** otorga, revoca, aprueba y rechaza: todo va detrás de `access.admin`, que
  tiene solo esa global (v29). `security_officer` no la tiene: sus pantallas no se montan ni se
  piden.
- **Nadie se toca a sí mismo**: no se otorga ni se revoca capacidades (409
  `access.self_modification_forbidden`). La sección sale deshabilitada con el motivo a la vista.
- **Asignación por función (C3, v29 §9.6)**: `access_admin` otorga cualquier capacidad otorgable,
  tenga o no esa capacidad. Si la función de quien otorga no lo permite, `409
  access.not_assignable`. Las capacidades del eje global (`servers.admin`, `access.admin`,
  `policy.admin`…) nunca se otorgan: el selector solo ofrece las filas del catálogo con
  `grantable`.
- ~~**Techo**: quien otorga o aprueba tiene que tener la capacidad en ese alcance.~~ **Obsoleto
  desde C3.** El techo por tenencia y su código `access.grant_ceiling_exceeded` se retiraron en el
  backend; el espejo del frontend (`grant-ceiling.ts`) se borró y lo reemplaza
  `assignment-policy.ts`, que no bloquea: marca lo que pide segundo aprobador.
- **Escribir/ejecutar trae la lectura** de su módulo (`implies`); la UI lo dice.

El cliente **no conoce ninguna regla**: qué es otorgable, sensible o implícito sale de
`GET /authz/catalog`, y `can_decide`/`blocked_reason` de la bandeja los calcula el servidor.

## El ciclo

```
Otorgar (POST) ──┬─ no sensible ─────────────► active ──► Revocar (DELETE) ──► revoked
                 │
                 └─ sensible ► pending ──┬─ otro access_admin aprueba ──► active
                                         ├─ otro access_admin rechaza ──► rejected
                                         ├─ quien la pidió cancela    ──► cancelled
                                         └─ 7 días sin decidir        ──► expired
```

1. **Otorgar** vive en «Capacidades puntuales» de `/gateway-users/:userId/accesos`
   (`CapabilityGrantsSection`). Es inmediato: no pasa por «Guardar accesos» y `PUT /access` no las
   toca.
2. **Sensible = segundo aprobador.** Desde C3 son las **11** exclusivas de `owner` otorgables
   (owner − operator): `databases.drop`, `engine_users.drop`, `engine_users.secrets`,
   `engine_users.credentials`, `blueprints.captures`, `clones.execute`, `exports.download`,
   `sql_console.execute` y, nuevas, `blueprints.apply`, `schema_diff.execute` y
   `collation.execute`. Nacen `pending` —igual que cualquier alta que lleve `sod_override`— y **no
   conceden nada** hasta que OTRA persona con `access_admin` (ni quien la pidió ni la persona
   destino) la apruebe. El selector las marca con «Requiere segundo aprobador»
   (`isSensitiveCapability`, espejo de `is_sensitive`: otorgable y exclusiva de owner, derivado del
   catálogo). La UI avisa antes y después de enviar; «Capacidad otorgada» sobre algo que no rige
   sería mentir.
3. **Bandeja** en `/gateway-users?tab=pending` («Solicitudes pendientes», con el recuento de las
   dos bandejas en la pestaña; solo `access_admin`). Es la sección «Capacidades puntuales» de
   `PendingRequestsInbox`; la otra sección son las elevaciones de acceso (ver abajo). Aprobar y rechazar piden confirmación con un motivo opcional.
   Con `can_decide: false` los dos botones van deshabilitados y el `blocked_reason` queda visible
   en la fila. Si otra persona decidió antes (409 `access.grant_not_pending`) o la fila desapareció
   (404), el diálogo lo dice y la bandeja se refresca sola.
4. **Vencimiento a los 7 días.** Solo las pendientes vencen; al aprobarse el backend borra
   `expires_at`. El barrido es perezoso (corre al leer), así que una vencida puede verse un instante
   más hasta el próximo refresco.
5. **Revocar / cancelar** (un solo admin, sin segundo aprobador, efecto inmediato): activa → `revoked`,
   pendiente → `cancelled`. Si quien la pidió pierde `access_admin` o se desactiva, sus pendientes
   se cancelan solas.

## Elevaciones de acceso (C3)

El mismo segundo aprobador vale para el **rol y las globales**, no solo para las puntuales
(api-reference-v29 §9). Es lo que reemplaza al techo: sin él, un administrador solo podría crearse
un títere `owner`, recibir su invitación y entrar con esa cara.

**Qué eleva** (`needsSecondApprover`, espejo de `needs_second_approver`): el rol `owner` (base o
en un alcance donde no lo tenía), **cualquier** global que se agrega y un `sod_override`.
`operator` no eleva, y **las bajas nunca**: se aplican siempre en el acto.

```
Alta / edición / «Guardar accesos» ──┬─ sin elevación ──► 200/201 de siempre
                                     │
                                     └─ con elevación ──► 202 access.elevation_pending
                                          lo que no eleva se aplica YA; el resto ──► pending
                                            ├─ otro access_admin aprueba ──► applied
                                            ├─ cualquier access_admin rechaza ──► rejected
                                            ├─ quien la pidió cancela ──► cancelled
                                            ├─ el acceso cambió antes de aprobar ──► cancelled (stale)
                                            └─ 7 días sin decidir ──► expired
```

1. **Antes de guardar.** El formulario de usuario y el editor de accesos ofrecen TODO y marcan con
   «Requiere segundo aprobador» lo que eleva (`owner` en el selector de rol, las globales que la
   persona no tiene, un `owner` nuevo en un permiso). El editor resume junto a «Guardar accesos» qué
   va a quedar pendiente (`accessElevations`, espejo de `split`).
2. **El `202`.** `data` es la persona tal como quedó YA (no la pedida) y `data.pending_request` la
   solicitud (`pendingElevationOf`). Los hooks muestran «Se aplicó lo que no requiere aprobación;
   la elevación quedó pendiente de otro administrador de accesos» con «Ver la solicitud»
   (`accessRequestPath`) y refrescan listados y la bandeja. El alta entrega la invitación igual y
   lo repite fijo en el diálogo de entrega; «Guardar accesos» lleva directo a la solicitud.
3. **Bandeja.** Sección «Elevaciones de acceso» de la pestaña «Solicitudes pendientes»
   (`PendingAccessRequestsCard`): el cambio compacto *actual → pedido* contra el acceso de hoy
   (`accessRequestDiff`), con aviso si cambió desde el pedido; Aprobar / Rechazar con motivo
   opcional y `can_decide`/`blocked_reason` del servidor; «Cancelar» solo en las propias (sin
   step-up). Una carrera (404/409) queda en el diálogo y refresca la bandeja.
4. **`?solicitud=<id>`** destaca una solicitud con su estado actual (`GET /access-requests/{id}`),
   también si ya se decidió.

> **Un solo `access_admin`.** Con `ACCESS_FOUR_EYES=True` (el valor por defecto) nadie puede
> aprobar, incluida la elevación que crearía al segundo administrador. El camino, hasta C4, es del
> lado del servidor: arrancar con `ACCESS_FOUR_EYES=False`, crear el segundo `access_admin` y
> volver a `True`. Con `False` el backend aplica todo en el acto y la UI ve los `200` de siempre.

## Acceso efectivo

Las capacidades puntuales **suman** al rol del alcance (nunca restan). El resultado se ve en dos
lugares:

- **Admin sobre otra persona**: «Acceso efectivo» en la página de accesos, con la procedencia de
  cada capacidad («Capacidad puntual», rol, rol por alcance, global). Es la respuesta del servidor
  (`GET …/effective-access`); con cambios sin guardar muestra una vista previa del navegador,
  rotulada como tal.
- **Cada persona sobre sí misma**: «Mi cuenta», desde `/auth/me` (`capability_grants`).

Una pendiente no cuenta como acceso. Tras cualquier cambio los hooks invalidan todo
`queryKeys.capabilityGrants.all` (lista, bandeja y acceso efectivo) y `/auth/me` si la persona
afectada es la de la sesión.

## Separación de funciones

Una capacidad puntual exclusiva de `owner` (las que `operator` no tiene) sobre alguien con
`security_officer` cuenta como `owner` para la separación de deberes, **viva o pendiente**: el alta
responde `409 access.sod_conflict` y el formulario ofrece la «Excepción de emergencia», que reenvía
con `sod_override`. Una pendiente que quedó en esa situación llega a la bandeja con
`blocked_reason: access.sod_conflict`, y aprobarla no acepta override. Todo el flujo, en
[`separation-of-duties.md`](separation-of-duties.md).

## Dónde vive cada cosa

| Pieza | Ubicación |
|---|---|
| Contratos Zod | `src/lib/contracts/capability-grants.ts` |
| API y hooks | `features/gateway-users/api/capability-grants.api.ts`, `hooks/use-capability-grants.ts` |
| Copy de errores y bloqueos | `features/gateway-users/messages.ts` (`capabilityGrantErrorMessage`, `capabilityGrantBlockedMessage`, `accessRequestErrorMessage`, `accessRequestBlockedMessage`, `ELEVATION_PENDING_MESSAGE`) |
| Otorgar / revocar | `components/CapabilityGrantsSection.tsx` |
| Bandeja | `components/PendingRequestsInbox.tsx` → `PendingAccessRequestsCard.tsx` + `PendingCapabilityGrantsCard.tsx` (pestaña de `GatewayUsersPage`) |
| Elevaciones: contratos, API y hooks | `src/lib/contracts/access-requests.ts`, `api/access-requests.api.ts`, `hooks/use-access-requests.ts` |
| Espejo de la asignación | `features/gateway-users/assignment-policy.ts` (`needsSecondApprover`, `isSensitiveCapability`, `accessElevations`) y `access-request-diff.ts` |
| Distintivo | `components/SecondApproverBadge.tsx` |
| Espejo del cálculo | `features/auth/authz-model.ts` (`expandGrant`, `grantMatches`) |
